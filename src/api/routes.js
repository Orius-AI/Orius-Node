/**
 * Orius Compute Network - API Routes
 * REST API for ai.orius.io
 * Developed by Orius Team
 */

const express = require('express');
const router = express.Router();
const db = require('../utils/database');
const config = require('../utils/config');
const crypto = require('../utils/crypto');
const taskQueue = require('../queue/taskQueue');
const taskGenerator = require('../compute/taskGenerator');
const verifier = require('../verification/verifier');

// ============================================
// USER & DEVICE MANAGEMENT
// ============================================

router.post('/register', async (req, res) => {
  try {
    const { walletAddress, deviceId } = req.body;
    
    if (!walletAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    
    if (!deviceId || deviceId.length < 16) {
      return res.status(400).json({ success: false, error: 'Device ID required' });
    }

    const existingByDevice = await db.query(
      'SELECT * FROM users WHERE device_id = $1',
      [deviceId]
    );

    if (existingByDevice.rows.length > 0) {
      const existingUser = existingByDevice.rows[0];
      
      if (existingUser.wallet_address !== walletAddress) {
        return res.status(409).json({ 
          success: false, 
          error: 'Device already bound to another wallet',
          boundWallet: existingUser.wallet_address.slice(0, 4) + '...' + existingUser.wallet_address.slice(-4)
        });
      }
      
      return res.json({
        success: true,
        message: 'Device already registered',
        balance: {
          claimableBalance: parseFloat(existingUser.claimable_balance) || 0,
          totalEarned: parseFloat(existingUser.total_earned) || 0,
          computeCredits: parseFloat(existingUser.total_compute_credits) || 0
        }
      });
    }

    const existingByWallet = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1',
      [walletAddress]
    );

    if (existingByWallet.rows.length > 0) {
      const existingUser = existingByWallet.rows[0];
      
      if (existingUser.device_id && existingUser.device_id !== deviceId) {
        return res.status(409).json({
          success: false,
          error: 'Wallet already bound to another device'
        });
      }
      
      await db.query(
        'UPDATE users SET device_id = $1, device_bound_at = NOW() WHERE wallet_address = $2',
        [deviceId, walletAddress]
      );
      
      return res.json({
        success: true,
        message: 'Device bound to existing wallet',
        balance: {
          claimableBalance: parseFloat(existingUser.claimable_balance) || 0,
          totalEarned: parseFloat(existingUser.total_earned) || 0,
          computeCredits: parseFloat(existingUser.total_compute_credits) || 0
        }
      });
    }

    await db.query(`
      INSERT INTO users (wallet_address, device_id, device_bound_at, created_at)
      VALUES ($1, $2, NOW(), NOW())
    `, [walletAddress, deviceId]);

    await db.query(`
      INSERT INTO node_trust (device_id, trust_score)
      VALUES ($1, 100)
      ON CONFLICT (device_id) DO NOTHING
    `, [deviceId]);

    res.json({
      success: true,
      message: 'Registered successfully',
      balance: { claimableBalance: 0, totalEarned: 0, computeCredits: 0 }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

router.get('/device/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const { rows } = await db.query(
      'SELECT wallet_address, claimable_balance, total_earned, total_compute_credits FROM users WHERE device_id = $1',
      [deviceId]
    );
    
    if (rows.length === 0) {
      return res.json({ success: true, bound: false, wallet: null });
    }
    
    res.json({
      success: true,
      bound: true,
      wallet: rows[0].wallet_address,
      balance: {
        claimableBalance: parseFloat(rows[0].claimable_balance) || 0,
        totalEarned: parseFloat(rows[0].total_earned) || 0,
        computeCredits: parseFloat(rows[0].total_compute_credits) || 0
      }
    });
  } catch (error) {
    console.error('Device check error:', error);
    res.status(500).json({ success: false, error: 'Check failed' });
  }
});

// ============================================
// COMPUTE TASK ENDPOINTS
// ============================================

router.post('/compute/capabilities', async (req, res) => {
  try {
    const { deviceId, capabilities } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID required' });
    }

    const result = await taskQueue.registerNodeCapabilities(deviceId, capabilities);
    
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, message: 'Capabilities registered' });
  } catch (error) {
    console.error('Capabilities error:', error);
    res.status(500).json({ success: false, error: 'Failed to register capabilities' });
  }
});

router.post('/compute/task/request', async (req, res) => {
  try {
    const { deviceId, capabilities } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID required' });
    }

    const banned = await verifier.isNodeBanned(deviceId);
    if (banned) {
      return res.status(403).json({ success: false, error: 'Node is banned' });
    }

    const task = await taskQueue.getNextTask(deviceId, capabilities);
    
    if (!task) {
      return res.json({ success: true, task: null, message: 'No tasks available' });
    }
    
    if (task.error) {
      return res.status(400).json({ success: false, error: task.error });
    }

    res.json({ success: true, task });
  } catch (error) {
    console.error('Task request error:', error);
    res.status(500).json({ success: false, error: 'Failed to get task' });
  }
});

router.post('/compute/task/submit', async (req, res) => {
  try {
    const { deviceId, taskUuid, result, executionTimeMs } = req.body;
    
    if (!deviceId || !taskUuid || result === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const timeCheck = await verifier.verifyExecutionTime(
      result.task_type || 'unknown',
      executionTimeMs,
      result.difficulty || 1
    );
    
    if (!timeCheck.valid) {
      return res.status(400).json({ success: false, error: timeCheck.reason });
    }

    const submission = await taskQueue.submitResult(deviceId, taskUuid, result, executionTimeMs);
    
    res.json(submission);
  } catch (error) {
    console.error('Task submit error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit result' });
  }
});

router.get('/compute/queue/stats', async (req, res) => {
  try {
    const stats = await taskQueue.getQueueStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Queue stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// ============================================
// HEARTBEAT & ONLINE REWARDS
// ============================================

router.post('/heartbeat', async (req, res) => {
  try {
    const { walletAddress, deviceId, sessionId } = req.body;
    
    if (!walletAddress || !deviceId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const { rows } = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1 FOR UPDATE',
      [walletAddress]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = rows[0];
    
    if (user.device_id !== deviceId) {
      return res.status(403).json({ success: false, error: 'Device mismatch' });
    }
    
    const now = new Date();
    const lastHeartbeat = user.last_heartbeat_at ? new Date(user.last_heartbeat_at) : null;
    const timeSinceLastHeartbeat = lastHeartbeat ? (now - lastHeartbeat) / 1000 : null;
    
    if (timeSinceLastHeartbeat !== null && timeSinceLastHeartbeat < 8) {
      return res.status(429).json({ success: false, error: 'Rate limited' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const { rows: todayEarnings } = await db.query(`
      SELECT COALESCE(SUM(earned_amount), 0) as total
      FROM earnings
      WHERE user_id = $1 AND created_at >= $2
    `, [user.id, todayStart]);
    
    const earnedToday = parseFloat(todayEarnings[0].total) || 0;
    
    if (earnedToday >= config.DAILY_CAP) {
      await db.query(`
        UPDATE users SET last_heartbeat_at = NOW(), last_active = NOW(), is_active = true
        WHERE id = $1
      `, [user.id]);
      
      return res.json({
        success: true,
        earned: 0,
        balance: {
          claimableBalance: parseFloat(user.claimable_balance),
          totalEarned: parseFloat(user.total_earned),
          earnedToday,
          dailyCap: config.DAILY_CAP
        },
        message: 'Daily cap reached'
      });
    }

    const { min, max } = config.ONLINE_REWARD_PER_HEARTBEAT;
    let earned = min + Math.random() * (max - min);
    earned = Math.round(earned * 100) / 100;
    
    if (earnedToday + earned > config.DAILY_CAP) {
      earned = config.DAILY_CAP - earnedToday;
    }

    await db.transaction(async (client) => {
      await client.query(`
        UPDATE users 
        SET claimable_balance = claimable_balance + $1,
            total_earned = total_earned + $1,
            total_online_seconds = total_online_seconds + 10,
            last_heartbeat_at = NOW(),
            last_active = NOW(),
            last_seen_at = NOW(),
            is_active = true
        WHERE id = $2
      `, [earned, user.id]);
      
      await client.query(`
        INSERT INTO earnings (user_id, session_id, earned_amount, earning_type, online_seconds)
        VALUES ($1, $2, $3, 'online_time', 10)
      `, [user.id, sessionId || crypto.generateSessionId(), earned]);
    });

    const { rows: updated } = await db.query(
      'SELECT claimable_balance, total_earned FROM users WHERE id = $1',
      [user.id]
    );

    res.json({
      success: true,
      earned,
      balance: {
        claimableBalance: parseFloat(updated[0].claimable_balance),
        totalEarned: parseFloat(updated[0].total_earned),
        earnedToday: earnedToday + earned,
        dailyCap: config.DAILY_CAP
      }
    });

  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ success: false, error: 'Heartbeat failed' });
  }
});

// ============================================
// BALANCE & CLAIMS
// ============================================

router.get('/balance/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { deviceId } = req.query;
    
    const { rows } = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1',
      [wallet]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = rows[0];
    
    if (deviceId && user.device_id !== deviceId) {
      return res.status(403).json({ success: false, error: 'Device mismatch' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const { rows: todayEarnings } = await db.query(`
      SELECT COALESCE(SUM(earned_amount), 0) as total
      FROM earnings
      WHERE user_id = $1 AND created_at >= $2
    `, [user.id, todayStart]);

    res.json({
      success: true,
      balance: {
        claimableBalance: parseFloat(user.claimable_balance) || 0,
        totalEarned: parseFloat(user.total_earned) || 0,
        computeCredits: parseFloat(user.total_compute_credits) || 0,
        earnedToday: parseFloat(todayEarnings[0].total) || 0,
        totalOnlineSeconds: user.total_online_seconds || 0,
        dailyCap: config.DAILY_CAP
      }
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ success: false, error: 'Failed to get balance' });
  }
});

router.post('/claim', async (req, res) => {
  try {
    const { walletAddress, amount, deviceId } = req.body;
    
    if (!walletAddress || !deviceId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const claimAmount = parseFloat(amount);
    if (isNaN(claimAmount) || claimAmount < config.MIN_CLAIM_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Minimum claim is ${config.MIN_CLAIM_AMOUNT} $Orius` 
      });
    }
    
    if (claimAmount > config.MAX_CLAIM_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Maximum claim is ${config.MAX_CLAIM_AMOUNT} $Orius` 
      });
    }

    const { rows } = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1 FOR UPDATE',
      [walletAddress]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = rows[0];
    
    if (user.device_id !== deviceId) {
      return res.status(403).json({ success: false, error: 'Device mismatch' });
    }
    
    if (parseFloat(user.claimable_balance) < claimAmount) {
      return res.status(400).json({ success: false, error: 'Insufficient balance' });
    }

    const { rows: recentClaims } = await db.query(`
      SELECT * FROM claims 
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour' AND status = 'completed'
    `, [user.id]);
    
    if (recentClaims.length > 0) {
      return res.status(429).json({ 
        success: false, 
        error: 'Please wait 1 hour between claims' 
      });
    }

    const { rows: claim } = await db.query(`
      INSERT INTO claims (user_id, amount, status)
      VALUES ($1, $2, 'processing')
      RETURNING id
    `, [user.id, claimAmount]);

    await db.query(`
      UPDATE users SET claimable_balance = claimable_balance - $1 WHERE id = $2
    `, [claimAmount, user.id]);

    res.json({
      success: true,
      claimId: claim[0].id,
      amount: claimAmount,
      status: 'processing',
      message: 'Claim submitted for processing'
    });

  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ success: false, error: 'Claim failed' });
  }
});

router.get('/claims/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    
    const { rows: user } = await db.query(
      'SELECT id FROM users WHERE wallet_address = $1',
      [wallet]
    );
    
    if (user.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const { rows: claims } = await db.query(`
      SELECT id, amount, tx_signature, status, created_at, completed_at
      FROM claims
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [user[0].id]);
    
    res.json({ success: true, claims });
  } catch (error) {
    console.error('Claims history error:', error);
    res.status(500).json({ success: false, error: 'Failed to get claims' });
  }
});

// ============================================
// NETWORK ANALYTICS (for ai.orius.io)
// ============================================

router.get('/analytics/network', async (req, res) => {
  try {
    const { rows: overview } = await db.query(`
      SELECT 
        COUNT(*) as total_nodes,
        COUNT(CASE WHEN is_active AND last_seen_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as active_nodes,
        COALESCE(SUM(total_earned), 0) as total_tokens_distributed,
        COALESCE(SUM(total_compute_credits), 0) as total_compute_credits,
        COALESCE(SUM(total_online_seconds), 0) as total_compute_seconds
      FROM users
    `);

    const { rows: taskStats } = await db.query(`
      SELECT 
        task_type,
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
        AVG(CASE WHEN status = 'completed' THEN reward_credits END) as avg_reward
      FROM compute_tasks
      GROUP BY task_type
    `);

    const { rows: hourlyStats } = await db.query(`
      SELECT 
        date_trunc('hour', created_at) as hour,
        COUNT(*) as tasks_completed,
        SUM(earned_amount) as tokens_earned
      FROM earnings
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY hour DESC
    `);

    const { rows: topNodes } = await db.query(`
      SELECT 
        u.wallet_address,
        u.total_compute_credits,
        u.total_earned,
        u.total_online_seconds,
        nt.trust_score
      FROM users u
      LEFT JOIN node_trust nt ON u.device_id = nt.device_id
      ORDER BY u.total_compute_credits DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      network: {
        totalNodes: parseInt(overview[0].total_nodes),
        activeNodes: parseInt(overview[0].active_nodes),
        totalTokensDistributed: parseFloat(overview[0].total_tokens_distributed) || 0,
        totalComputeCredits: parseFloat(overview[0].total_compute_credits) || 0,
        totalComputeHours: Math.round((parseInt(overview[0].total_compute_seconds) || 0) / 3600)
      },
      tasks: taskStats.map(t => ({
        type: t.task_type,
        total: parseInt(t.total_tasks),
        completed: parseInt(t.completed_tasks),
        avgReward: parseFloat(t.avg_reward) || 0
      })),
      hourlyActivity: hourlyStats.map(h => ({
        hour: h.hour,
        tasksCompleted: parseInt(h.tasks_completed),
        tokensEarned: parseFloat(h.tokens_earned) || 0
      })),
      leaderboard: topNodes.map((n, i) => ({
        rank: i + 1,
        wallet: n.wallet_address.slice(0, 4) + '...' + n.wallet_address.slice(-4),
        computeCredits: parseFloat(n.total_compute_credits) || 0,
        trustScore: parseFloat(n.trust_score) || 100
      }))
    });

  } catch (error) {
    console.error('Network analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get analytics' });
  }
});

router.get('/analytics/live', async (req, res) => {
  try {
    const { rows: liveNodes } = await db.query(`
      SELECT 
        COUNT(*) as active_nodes,
        COALESCE(SUM(total_compute_credits), 0) as total_credits
      FROM users
      WHERE is_active = true AND last_seen_at > NOW() - INTERVAL '2 minutes'
    `);

    const { rows: recentTasks } = await db.query(`
      SELECT 
        ct.task_type,
        COUNT(*) as count
      FROM task_assignments ta
      JOIN compute_tasks ct ON ta.task_id = ct.id
      WHERE ta.completed_at > NOW() - INTERVAL '5 minutes' AND ta.verified = true
      GROUP BY ct.task_type
    `);

    const { rows: pendingTasks } = await db.query(`
      SELECT COUNT(*) as count FROM compute_tasks WHERE status = 'pending'
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      live: {
        activeNodes: parseInt(liveNodes[0].active_nodes) || 0,
        pendingTasks: parseInt(pendingTasks[0].count) || 0,
        recentCompletions: recentTasks.reduce((sum, t) => sum + parseInt(t.count), 0),
        networkTFLOPS: (parseInt(liveNodes[0].active_nodes) || 0) * 0.5
      }
    });

  } catch (error) {
    console.error('Live analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get live stats' });
  }
});

router.get('/analytics/node/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const { rows: user } = await db.query(`
      SELECT u.*, nt.trust_score, nt.total_tasks_completed, nt.successful_tasks
      FROM users u
      LEFT JOIN node_trust nt ON u.device_id = nt.device_id
      WHERE u.device_id = $1
    `, [deviceId]);

    if (user.length === 0) {
      return res.status(404).json({ success: false, error: 'Node not found' });
    }

    const { rows: capabilities } = await db.query(
      'SELECT * FROM node_capabilities WHERE device_id = $1',
      [deviceId]
    );

    const { rows: recentEarnings } = await db.query(`
      SELECT 
        date_trunc('day', created_at) as day,
        SUM(earned_amount) as earned,
        COUNT(*) as tasks
      FROM earnings
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY date_trunc('day', created_at)
      ORDER BY day DESC
    `, [user[0].id]);

    res.json({
      success: true,
      node: {
        wallet: user[0].wallet_address,
        trustScore: parseFloat(user[0].trust_score) || 100,
        totalEarned: parseFloat(user[0].total_earned) || 0,
        computeCredits: parseFloat(user[0].total_compute_credits) || 0,
        onlineHours: Math.round((user[0].total_online_seconds || 0) / 3600),
        tasksCompleted: parseInt(user[0].total_tasks_completed) || 0,
        successRate: user[0].total_tasks_completed > 0 
          ? Math.round((user[0].successful_tasks / user[0].total_tasks_completed) * 100)
          : 100
      },
      capabilities: capabilities[0] || null,
      weeklyEarnings: recentEarnings.map(e => ({
        day: e.day,
        earned: parseFloat(e.earned),
        tasks: parseInt(e.tasks)
      }))
    });

  } catch (error) {
    console.error('Node analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get node stats' });
  }
});

router.get('/status', async (req, res) => {
  try {
    await db.query('SELECT 1');
    
    res.json({
      success: true,
      status: 'operational',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        taskQueue: 'active',
        solana: process.env.TREASURY_PRIVATE_KEY ? 'connected' : 'disabled'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'degraded',
      error: error.message
    });
  }
});

module.exports = router;
