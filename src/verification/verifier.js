/**
 * Orius Compute Network - Result Verification
 * Anti-cheat and consensus verification
 * Developed by Orius Team
 */

const db = require('../utils/database');
const crypto = require('../utils/crypto');
const config = require('../utils/config');

class ResultVerifier {
  constructor() {
    this.verificationCache = new Map();
  }

  async verifyResult(taskId, submissions) {
    if (submissions.length < 2) {
      return { verified: false, reason: 'Insufficient submissions' };
    }

    const hashCounts = {};
    submissions.forEach(sub => {
      hashCounts[sub.result_hash] = (hashCounts[sub.result_hash] || 0) + 1;
    });

    const sortedHashes = Object.entries(hashCounts)
      .sort((a, b) => b[1] - a[1]);

    const [topHash, topCount] = sortedHashes[0];
    const totalSubmissions = submissions.length;
    const consensusThreshold = Math.ceil(totalSubmissions * 0.5);

    if (topCount >= consensusThreshold) {
      return {
        verified: true,
        consensus_hash: topHash,
        confidence: topCount / totalSubmissions,
        matching_count: topCount,
        total_count: totalSubmissions
      };
    }

    return {
      verified: false,
      reason: 'No consensus reached',
      top_hash: topHash,
      top_count: topCount,
      threshold: consensusThreshold
    };
  }

  async verifyWithExpectedHash(resultHash, expectedHash) {
    if (!expectedHash) {
      return { verified: false, reason: 'No expected hash available' };
    }

    const matches = resultHash === expectedHash;
    return {
      verified: matches,
      method: 'deterministic',
      confidence: matches ? 1.0 : 0.0
    };
  }

  async checkCanaryResult(deviceId, taskUuid, submittedHash) {
    const { rows } = await db.query(
      'SELECT known_output_hash FROM canary_tasks WHERE task_uuid = $1',
      [taskUuid]
    );

    if (rows.length === 0) {
      return { error: 'Canary task not found' };
    }

    const expected = rows[0].known_output_hash;
    const passed = submittedHash === expected;

    await this.recordCanaryResult(deviceId, passed);

    return {
      passed,
      expected_hash: expected.substring(0, 8) + '...',
      submitted_hash: submittedHash.substring(0, 8) + '...'
    };
  }

  async recordCanaryResult(deviceId, passed) {
    if (passed) {
      await db.query(`
        UPDATE node_trust 
        SET trust_score = LEAST(100, trust_score + 2),
            updated_at = NOW()
        WHERE device_id = $1
      `, [deviceId]);
    } else {
      await db.query(`
        UPDATE node_trust 
        SET trust_score = GREATEST(0, trust_score - 15),
            canary_failures = canary_failures + 1,
            last_failure_at = NOW(),
            updated_at = NOW()
        WHERE device_id = $1
      `, [deviceId]);

      const { rows } = await db.query(
        'SELECT canary_failures FROM node_trust WHERE device_id = $1',
        [deviceId]
      );

      if (rows.length > 0 && rows[0].canary_failures >= 3) {
        await this.banNode(deviceId, 'Multiple canary verification failures');
      }
    }
  }

  async banNode(deviceId, reason) {
    await db.query(`
      UPDATE node_trust 
      SET banned = true, 
          banned_at = NOW(), 
          ban_reason = $2,
          trust_score = 0
      WHERE device_id = $1
    `, [deviceId, reason]);

    console.log(`Node banned: ${deviceId} - ${reason}`);
  }

  async isNodeBanned(deviceId) {
    const { rows } = await db.query(
      'SELECT banned FROM node_trust WHERE device_id = $1',
      [deviceId]
    );

    return rows.length > 0 && rows[0].banned;
  }

  async getNodeTrustInfo(deviceId) {
    const { rows } = await db.query(`
      SELECT 
        trust_score,
        total_tasks_completed,
        successful_tasks,
        failed_tasks,
        canary_failures,
        banned,
        ban_reason,
        last_failure_at,
        created_at
      FROM node_trust 
      WHERE device_id = $1
    `, [deviceId]);

    if (rows.length === 0) {
      return {
        trust_score: 100,
        total_tasks_completed: 0,
        successful_tasks: 0,
        failed_tasks: 0,
        canary_failures: 0,
        banned: false,
        is_new: true
      };
    }

    return rows[0];
  }

  async verifyExecutionTime(taskType, executionTimeMs, difficulty) {
    const expectedRanges = {
      'matrix_mult': { min: 10, max: 5000 * difficulty },
      'hash_compute': { min: 5, max: 3000 * difficulty },
      'ml_inference': { min: 100, max: 15000 * difficulty }
    };

    const range = expectedRanges[taskType] || { min: 10, max: 30000 };

    if (executionTimeMs < range.min) {
      return { valid: false, reason: 'Execution too fast - possible pre-computation' };
    }

    if (executionTimeMs > range.max) {
      return { valid: false, reason: 'Execution too slow - timeout risk' };
    }

    return { valid: true };
  }

  async detectAnomalies(deviceId) {
    const { rows } = await db.query(`
      SELECT 
        AVG(execution_time_ms) as avg_time,
        STDDEV(execution_time_ms) as stddev_time,
        COUNT(*) as total_tasks,
        SUM(CASE WHEN verified THEN 1 ELSE 0 END) as verified_tasks
      FROM task_assignments
      WHERE device_id = $1 
        AND completed_at > NOW() - INTERVAL '24 hours'
    `, [deviceId]);

    if (rows.length === 0 || rows[0].total_tasks < 10) {
      return { anomalies: [], confidence: 'low' };
    }

    const stats = rows[0];
    const anomalies = [];

    const successRate = stats.verified_tasks / stats.total_tasks;
    if (successRate < 0.5 && stats.total_tasks > 20) {
      anomalies.push({
        type: 'low_success_rate',
        value: successRate,
        threshold: 0.5
      });
    }

    if (stats.stddev_time && stats.stddev_time < 10) {
      anomalies.push({
        type: 'suspiciously_consistent_timing',
        stddev: stats.stddev_time
      });
    }

    return {
      anomalies,
      confidence: stats.total_tasks > 50 ? 'high' : 'medium',
      stats: {
        avg_execution_time: Math.round(stats.avg_time),
        success_rate: Math.round(successRate * 100) / 100,
        total_tasks: parseInt(stats.total_tasks)
      }
    };
  }

  async runIntegrityCheck() {
    const { rows: suspiciousNodes } = await db.query(`
      SELECT 
        nt.device_id,
        nt.trust_score,
        nt.canary_failures,
        COUNT(ta.id) as total_assignments,
        SUM(CASE WHEN ta.verified THEN 1 ELSE 0 END) as verified_count
      FROM node_trust nt
      LEFT JOIN task_assignments ta ON nt.device_id = ta.device_id
      WHERE nt.trust_score < 70 AND nt.banned = false
      GROUP BY nt.device_id, nt.trust_score, nt.canary_failures
      HAVING COUNT(ta.id) > 10
    `);

    const flagged = [];

    for (const node of suspiciousNodes) {
      const successRate = node.verified_count / node.total_assignments;
      
      if (successRate < 0.3 || node.canary_failures >= 2) {
        flagged.push({
          device_id: node.device_id,
          trust_score: parseFloat(node.trust_score),
          success_rate: Math.round(successRate * 100) / 100,
          canary_failures: node.canary_failures,
          recommendation: successRate < 0.2 ? 'ban' : 'monitor'
        });
      }
    }

    return {
      checked_nodes: suspiciousNodes.length,
      flagged_nodes: flagged.length,
      flagged
    };
  }
}

module.exports = new ResultVerifier();
