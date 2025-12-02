/**
 * Orius Compute Network - Task Queue
 * Manages task distribution to nodes
 * Developed by Orius Team
 */

const db = require('../utils/database');
const config = require('../utils/config');
const crypto = require('../utils/crypto');

class TaskQueue {
  constructor() {
    this.pendingAssignments = new Map();
    this.activeNodes = new Map();
  }

  async getNextTask(deviceId, capabilities) {
    const trustScore = await this.getNodeTrustScore(deviceId);
    
    if (trustScore < config.MIN_TRUST_SCORE) {
      return { error: 'Trust score too low', trustScore };
    }

    const isCanary = Math.random() < config.CANARY_TASK_FREQUENCY;
    
    if (isCanary) {
      return await this.getCanaryTask(capabilities);
    }

    return await this.getRegularTask(deviceId, capabilities);
  }

  async getRegularTask(deviceId, capabilities) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const requiresGpu = capabilities?.webgpu_supported ? null : false;
      
      const { rows } = await client.query(`
        SELECT ct.* FROM compute_tasks ct
        WHERE ct.status = 'pending'
          AND ct.expires_at > NOW()
          AND ($1::boolean IS NULL OR ct.requires_gpu = $1)
          AND ct.id NOT IN (
            SELECT task_id FROM task_assignments 
            WHERE device_id = $2 AND status IN ('assigned', 'processing')
          )
          AND (
            SELECT COUNT(*) FROM task_assignments 
            WHERE task_id = ct.id AND status IN ('assigned', 'processing', 'completed')
          ) < ct.redundancy_count
        ORDER BY ct.priority DESC, ct.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, [requiresGpu, deviceId]);
      
      if (rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }
      
      const task = rows[0];
      
      const user = await client.query(
        'SELECT id FROM users WHERE device_id = $1',
        [deviceId]
      );
      
      if (user.rows.length === 0) {
        await client.query('COMMIT');
        return { error: 'Device not registered' };
      }
      
      await client.query(`
        INSERT INTO task_assignments 
        (task_id, user_id, device_id, status)
        VALUES ($1, $2, $3, 'assigned')
      `, [task.id, user.rows[0].id, deviceId]);
      
      await client.query(`
        UPDATE compute_tasks SET status = 'assigned' WHERE id = $1
      `, [task.id]);
      
      await client.query('COMMIT');
      
      const signature = crypto.signTaskManifest(task, process.env.SESSION_SECRET);
      
      return {
        task_uuid: task.task_uuid,
        task_type: task.task_type,
        difficulty: task.difficulty,
        input_data: task.input_data,
        input_hash: task.input_hash,
        model_url: task.model_url,
        model_hash: task.model_hash,
        max_execution_time_ms: task.max_execution_time_ms,
        reward_credits: parseFloat(task.reward_credits),
        signature,
        is_canary: false
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Task fetch error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCanaryTask(capabilities) {
    const taskType = capabilities?.webgpu_supported 
      ? (Math.random() > 0.5 ? 'matrix_mult' : 'hash_compute')
      : 'hash_compute';
    
    const { rows } = await db.query(`
      SELECT * FROM canary_tasks 
      WHERE task_type = $1 
      ORDER BY RANDOM() 
      LIMIT 1
    `, [taskType]);
    
    if (rows.length === 0) {
      return await this.getRegularTask(capabilities);
    }
    
    const canary = rows[0];
    
    return {
      task_uuid: canary.task_uuid,
      task_type: canary.task_type,
      difficulty: 1,
      input_data: canary.input_data,
      input_hash: crypto.sha256(canary.input_data),
      max_execution_time_ms: 10000,
      reward_credits: 0.5,
      is_canary: true,
      _known_hash: canary.known_output_hash
    };
  }

  async submitResult(deviceId, taskUuid, result, executionTimeMs) {
    const resultHash = crypto.hashResult(result);
    
    const isCanary = taskUuid.startsWith('canary_');
    
    if (isCanary) {
      return await this.verifyCanaryResult(deviceId, taskUuid, resultHash);
    }
    
    return await this.processRegularResult(deviceId, taskUuid, result, resultHash, executionTimeMs);
  }

  async processRegularResult(deviceId, taskUuid, result, resultHash, executionTimeMs) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const { rows: assignments } = await client.query(`
        SELECT ta.*, ct.expected_output_hash, ct.reward_credits, ct.redundancy_count,
               u.id as user_id, u.wallet_address
        FROM task_assignments ta
        JOIN compute_tasks ct ON ta.task_id = ct.id
        JOIN users u ON ta.user_id = u.id
        WHERE ct.task_uuid = $1 AND ta.device_id = $2
        FOR UPDATE
      `, [taskUuid, deviceId]);
      
      if (assignments.length === 0) {
        await client.query('COMMIT');
        return { success: false, error: 'Assignment not found' };
      }
      
      const assignment = assignments[0];
      
      await client.query(`
        UPDATE task_assignments 
        SET status = 'completed', 
            result_hash = $1, 
            result_data = $2,
            execution_time_ms = $3,
            completed_at = NOW()
        WHERE id = $4
      `, [resultHash, JSON.stringify(result), executionTimeMs, assignment.id]);
      
      const { rows: allResults } = await client.query(`
        SELECT result_hash, COUNT(*) as count
        FROM task_assignments
        WHERE task_id = $1 AND status = 'completed'
        GROUP BY result_hash
        ORDER BY count DESC
      `, [assignment.task_id]);
      
      let verified = false;
      let creditsAwarded = 0;
      
      if (allResults.length > 0) {
        const topResult = allResults[0];
        const totalSubmissions = allResults.reduce((sum, r) => sum + parseInt(r.count), 0);
        
        if (topResult.result_hash === resultHash) {
          if (assignment.expected_output_hash) {
            verified = resultHash === assignment.expected_output_hash;
          } else {
            verified = parseInt(topResult.count) >= Math.ceil(assignment.redundancy_count / 2);
          }
        }
        
        if (verified) {
          creditsAwarded = parseFloat(assignment.reward_credits);
          
          await client.query(`
            UPDATE task_assignments SET verified = true, credits_awarded = $1 WHERE id = $2
          `, [creditsAwarded, assignment.id]);
          
          await client.query(`
            UPDATE users 
            SET total_compute_credits = total_compute_credits + $1,
                claimable_balance = claimable_balance + $1,
                total_earned = total_earned + $1
            WHERE id = $2
          `, [creditsAwarded, assignment.user_id]);
          
          await client.query(`
            INSERT INTO earnings (user_id, earned_amount, earning_type, task_id)
            VALUES ($1, $2, 'compute', $3)
          `, [assignment.user_id, creditsAwarded, assignment.task_id]);
          
          await this.updateTrustScore(client, deviceId, true);
        }
        
        if (totalSubmissions >= assignment.redundancy_count) {
          await client.query(`
            UPDATE compute_tasks SET status = 'completed' WHERE id = $1
          `, [assignment.task_id]);
          
          await client.query(`
            INSERT INTO task_results (task_id, consensus_hash, total_submissions, matching_submissions, consensus_reached, verified_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
          `, [assignment.task_id, topResult.result_hash, totalSubmissions, parseInt(topResult.count), verified]);
        }
      }
      
      await client.query('COMMIT');
      
      return {
        success: true,
        verified,
        credits_awarded: creditsAwarded,
        result_hash: resultHash
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Result processing error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyCanaryResult(deviceId, taskUuid, resultHash) {
    const { rows } = await db.query(
      'SELECT * FROM canary_tasks WHERE task_uuid = $1',
      [taskUuid]
    );
    
    if (rows.length === 0) {
      return { success: false, error: 'Canary task not found' };
    }
    
    const canary = rows[0];
    const passed = resultHash === canary.known_output_hash;
    
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      if (!passed) {
        await client.query(`
          UPDATE node_trust 
          SET canary_failures = canary_failures + 1,
              trust_score = GREATEST(0, trust_score - 10),
              last_failure_at = NOW(),
              updated_at = NOW()
          WHERE device_id = $1
        `, [deviceId]);
        
        const { rows: trust } = await client.query(
          'SELECT canary_failures, trust_score FROM node_trust WHERE device_id = $1',
          [deviceId]
        );
        
        if (trust.length > 0 && trust[0].canary_failures >= 3) {
          await client.query(`
            UPDATE node_trust 
            SET banned = true, banned_at = NOW(), ban_reason = 'Multiple canary failures'
            WHERE device_id = $1
          `, [deviceId]);
        }
      } else {
        await client.query(`
          UPDATE node_trust 
          SET successful_tasks = successful_tasks + 1,
              trust_score = LEAST(100, trust_score + 1),
              updated_at = NOW()
          WHERE device_id = $1
        `, [deviceId]);
      }
      
      await client.query('COMMIT');
      
      return {
        success: true,
        verified: passed,
        is_canary: true,
        credits_awarded: passed ? 0.5 : 0
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateTrustScore(client, deviceId, success) {
    if (success) {
      await client.query(`
        UPDATE node_trust 
        SET successful_tasks = successful_tasks + 1,
            total_tasks_completed = total_tasks_completed + 1,
            trust_score = LEAST(100, trust_score + 0.5),
            updated_at = NOW()
        WHERE device_id = $1
      `, [deviceId]);
    } else {
      await client.query(`
        UPDATE node_trust 
        SET failed_tasks = failed_tasks + 1,
            total_tasks_completed = total_tasks_completed + 1,
            trust_score = GREATEST(0, trust_score - 5),
            last_failure_at = NOW(),
            updated_at = NOW()
        WHERE device_id = $1
      `, [deviceId]);
    }
  }

  async getNodeTrustScore(deviceId) {
    const { rows } = await db.query(
      'SELECT trust_score, banned FROM node_trust WHERE device_id = $1',
      [deviceId]
    );
    
    if (rows.length === 0) {
      await db.query(`
        INSERT INTO node_trust (device_id, trust_score)
        VALUES ($1, 100)
        ON CONFLICT (device_id) DO NOTHING
      `, [deviceId]);
      return 100;
    }
    
    if (rows[0].banned) {
      return 0;
    }
    
    return parseFloat(rows[0].trust_score);
  }

  async registerNodeCapabilities(deviceId, capabilities) {
    const { rows: users } = await db.query(
      'SELECT id FROM users WHERE device_id = $1',
      [deviceId]
    );
    
    if (users.length === 0) {
      return { error: 'Device not registered' };
    }
    
    await db.query(`
      INSERT INTO node_capabilities 
      (user_id, device_id, cpu_cores, cpu_benchmark_score, gpu_available, gpu_vendor, 
       gpu_renderer, webgpu_supported, wasm_supported, memory_gb, estimated_tflops, last_benchmark_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (device_id) 
      DO UPDATE SET
        cpu_cores = EXCLUDED.cpu_cores,
        cpu_benchmark_score = EXCLUDED.cpu_benchmark_score,
        gpu_available = EXCLUDED.gpu_available,
        gpu_vendor = EXCLUDED.gpu_vendor,
        gpu_renderer = EXCLUDED.gpu_renderer,
        webgpu_supported = EXCLUDED.webgpu_supported,
        wasm_supported = EXCLUDED.wasm_supported,
        memory_gb = EXCLUDED.memory_gb,
        estimated_tflops = EXCLUDED.estimated_tflops,
        last_benchmark_at = NOW(),
        updated_at = NOW()
    `, [
      users[0].id,
      deviceId,
      capabilities.cpu_cores || 1,
      capabilities.cpu_benchmark_score || 0,
      capabilities.gpu_available || false,
      capabilities.gpu_vendor || null,
      capabilities.gpu_renderer || null,
      capabilities.webgpu_supported || false,
      capabilities.wasm_supported !== false,
      capabilities.memory_gb || 0,
      capabilities.estimated_tflops || 0
    ]);
    
    await db.query(`
      INSERT INTO node_trust (device_id, trust_score)
      VALUES ($1, 100)
      ON CONFLICT (device_id) DO NOTHING
    `, [deviceId]);
    
    return { success: true };
  }

  async getQueueStats() {
    const { rows } = await db.query(`
      SELECT 
        task_type,
        status,
        COUNT(*) as count,
        AVG(difficulty) as avg_difficulty
      FROM compute_tasks
      WHERE expires_at > NOW()
      GROUP BY task_type, status
    `);
    
    return rows;
  }
}

module.exports = new TaskQueue();
