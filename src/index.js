/**
 * Orius Compute Network - Main Server
 * Distributed Compute Platform Backend
 * Developed by Orius Team
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

const config = require('./utils/config');
const db = require('./utils/database');
const apiRoutes = require('./api/routes');
const taskGenerator = require('./compute/taskGenerator');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID']
}));

app.use(express.json({ limit: '10mb' }));

app.use(express.static(path.join(__dirname, '..'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

let connection = null;
let treasuryKeypair = null;

function initSolana() {
  try {
    if (!config.TREASURY_PRIVATE_KEY) {
      console.log('Warning: TREASURY_PRIVATE_KEY not set - claim feature disabled');
      return false;
    }
    
    connection = new Connection(config.RPC_URL, 'confirmed');
    const secretKey = bs58.decode(config.TREASURY_PRIVATE_KEY);
    treasuryKeypair = Keypair.fromSecretKey(secretKey);
    
    console.log('Solana initialized successfully');
    console.log('Treasury:', treasuryKeypair.publicKey.toString());
    console.log('Token Mint:', config.TOKEN_MINT);
    console.log('RPC:', config.HELIUS_API_KEY ? 'Helius Mainnet' : 'Public Mainnet');
    
    return true;
  } catch (error) {
    console.error('Solana init error:', error.message);
    return false;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'popup.html'));
});

app.use('/api', apiRoutes);

app.post('/api/claim/process', async (req, res) => {
  try {
    const { claimId } = req.body;
    
    if (!treasuryKeypair || !connection) {
      return res.status(503).json({ success: false, error: 'Solana not configured' });
    }

    const { rows: claims } = await db.query(`
      SELECT c.*, u.wallet_address
      FROM claims c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = $1 AND c.status = 'processing'
    `, [claimId]);

    if (claims.length === 0) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const claim = claims[0];

    try {
      const tokenMint = new PublicKey(config.TOKEN_MINT);
      const recipientPubkey = new PublicKey(claim.wallet_address);
      
      const treasuryATA = await getOrCreateAssociatedTokenAccount(
        connection,
        treasuryKeypair,
        tokenMint,
        treasuryKeypair.publicKey,
        false,
        'confirmed',
        {},
        TOKEN_2022_PROGRAM_ID
      );

      const recipientATA = await getOrCreateAssociatedTokenAccount(
        connection,
        treasuryKeypair,
        tokenMint,
        recipientPubkey,
        false,
        'confirmed',
        {},
        TOKEN_2022_PROGRAM_ID
      );

      const amount = Math.floor(parseFloat(claim.amount) * Math.pow(10, config.TOKEN_DECIMALS));

      const transferIx = createTransferInstruction(
        treasuryATA.address,
        recipientATA.address,
        treasuryKeypair.publicKey,
        amount,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction().add(transferIx);
      tx.recentBlockhash = blockhash;
      tx.feePayer = treasuryKeypair.publicKey;
      tx.sign(treasuryKeypair);

      const signature = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(signature, 'confirmed');

      await db.query(`
        UPDATE claims 
        SET status = 'completed', tx_signature = $1, completed_at = NOW()
        WHERE id = $2
      `, [signature, claimId]);

      res.json({
        success: true,
        signature,
        explorer: `https://solscan.io/tx/${signature}`
      });

    } catch (txError) {
      console.error('Transaction error:', txError);
      
      await db.query(`
        UPDATE claims SET status = 'failed', error_message = $1 WHERE id = $2
      `, [txError.message, claimId]);
      
      await db.query(`
        UPDATE users SET claimable_balance = claimable_balance + $1 WHERE id = $2
      `, [claim.amount, claim.user_id]);

      res.status(500).json({ success: false, error: 'Transaction failed' });
    }

  } catch (error) {
    console.error('Claim process error:', error);
    res.status(500).json({ success: false, error: 'Processing failed' });
  }
});

app.get('/api/data/export', async (req, res) => {
  try {
    const { rows: networkStats } = await db.query(`
      SELECT 
        COUNT(DISTINCT u.id) as total_nodes,
        COUNT(DISTINCT CASE WHEN u.is_active AND u.last_seen_at > NOW() - INTERVAL '5 minutes' THEN u.id END) as active_nodes,
        COALESCE(SUM(u.total_earned), 0) as total_tokens,
        COALESCE(SUM(u.total_compute_credits), 0) as total_compute,
        COALESCE(SUM(u.total_online_seconds), 0) / 3600 as total_hours
      FROM users u
    `);

    const { rows: taskStats } = await db.query(`
      SELECT 
        task_type,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COALESCE(AVG(reward_credits), 0) as avg_reward
      FROM compute_tasks
      GROUP BY task_type
    `);

    const { rows: hourlyData } = await db.query(`
      SELECT 
        date_trunc('hour', created_at) as timestamp,
        COUNT(*) as earnings_count,
        SUM(earned_amount) as tokens_earned,
        SUM(CASE WHEN earning_type = 'compute' THEN earned_amount ELSE 0 END) as compute_earnings,
        SUM(CASE WHEN earning_type = 'online_time' THEN earned_amount ELSE 0 END) as online_earnings
      FROM earnings
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY timestamp DESC
    `);

    const { rows: nodeDistribution } = await db.query(`
      SELECT 
        CASE 
          WHEN nc.webgpu_supported THEN 'GPU-Enabled'
          ELSE 'CPU-Only'
        END as node_type,
        COUNT(*) as count,
        AVG(nc.cpu_cores) as avg_cores,
        AVG(nc.memory_gb) as avg_memory
      FROM node_capabilities nc
      GROUP BY nc.webgpu_supported
    `);

    const { rows: trustDistribution } = await db.query(`
      SELECT 
        CASE 
          WHEN trust_score >= 90 THEN 'Excellent (90-100)'
          WHEN trust_score >= 70 THEN 'Good (70-89)'
          WHEN trust_score >= 50 THEN 'Fair (50-69)'
          ELSE 'Low (<50)'
        END as trust_tier,
        COUNT(*) as count
      FROM node_trust
      WHERE banned = false
      GROUP BY 
        CASE 
          WHEN trust_score >= 90 THEN 'Excellent (90-100)'
          WHEN trust_score >= 70 THEN 'Good (70-89)'
          WHEN trust_score >= 50 THEN 'Fair (50-69)'
          ELSE 'Low (<50)'
        END
    `);

    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      network: {
        summary: networkStats[0],
        tasksByType: taskStats,
        nodeTypes: nodeDistribution,
        trustDistribution
      },
      timeSeries: {
        hourly: hourlyData
      },
      meta: {
        version: '2.0.0',
        dataRetention: '7 days for hourly data'
      }
    });

  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

app.get('/api/feed/realtime', async (req, res) => {
  try {
    const { rows: recentActivity } = await db.query(`
      SELECT 
        'task_completed' as event_type,
        ta.completed_at as timestamp,
        ct.task_type,
        ta.credits_awarded as amount,
        LEFT(u.wallet_address, 4) || '...' || RIGHT(u.wallet_address, 4) as wallet
      FROM task_assignments ta
      JOIN compute_tasks ct ON ta.task_id = ct.id
      JOIN users u ON ta.user_id = u.id
      WHERE ta.completed_at IS NOT NULL AND ta.verified = true
        AND ta.completed_at > NOW() - INTERVAL '10 minutes'
      
      UNION ALL
      
      SELECT 
        'claim_completed' as event_type,
        c.completed_at as timestamp,
        'claim' as task_type,
        c.amount,
        LEFT(u.wallet_address, 4) || '...' || RIGHT(u.wallet_address, 4) as wallet
      FROM claims c
      JOIN users u ON c.user_id = u.id
      WHERE c.status = 'completed'
        AND c.completed_at > NOW() - INTERVAL '10 minutes'
      
      ORDER BY timestamp DESC
      LIMIT 50
    `);

    const { rows: liveStats } = await db.query(`
      SELECT 
        COUNT(CASE WHEN is_active AND last_seen_at > NOW() - INTERVAL '2 minutes' THEN 1 END) as active_nodes,
        (SELECT COUNT(*) FROM compute_tasks WHERE status = 'pending') as pending_tasks,
        (SELECT COUNT(*) FROM task_assignments WHERE completed_at > NOW() - INTERVAL '5 minutes') as recent_completions
      FROM users
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      live: liveStats[0],
      feed: recentActivity.map(a => ({
        type: a.event_type,
        timestamp: a.timestamp,
        taskType: a.task_type,
        amount: parseFloat(a.amount),
        wallet: a.wallet
      }))
    });

  } catch (error) {
    console.error('Realtime feed error:', error);
    res.status(500).json({ success: false, error: 'Feed failed' });
  }
});

async function startTaskGenerator() {
  console.log('Starting task generator...');
  
  async function generateTasks() {
    try {
      await taskGenerator.ensureTaskPool(50);
    } catch (error) {
      console.error('Task generation error:', error);
    }
  }
  
  await generateTasks();
  setInterval(generateTasks, 60000);
}

async function recordHourlyStats() {
  try {
    const { rows: stats } = await db.query(`
      SELECT 
        COUNT(CASE WHEN is_active AND last_seen_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as active_nodes,
        (SELECT COUNT(*) FROM task_assignments WHERE completed_at > NOW() - INTERVAL '1 hour') as tasks_completed,
        (SELECT COALESCE(SUM(earned_amount), 0) FROM earnings WHERE created_at > NOW() - INTERVAL '1 hour') as credits_earned,
        (SELECT AVG(execution_time_ms) FROM task_assignments WHERE completed_at > NOW() - INTERVAL '1 hour') as avg_time
      FROM users
    `);

    await db.query(`
      INSERT INTO network_stats (hour_timestamp, active_nodes, total_tasks_completed, total_compute_credits, avg_task_time_ms)
      VALUES (date_trunc('hour', NOW()), $1, $2, $3, $4)
      ON CONFLICT (hour_timestamp) DO UPDATE SET
        active_nodes = EXCLUDED.active_nodes,
        total_tasks_completed = EXCLUDED.total_tasks_completed,
        total_compute_credits = EXCLUDED.total_compute_credits,
        avg_task_time_ms = EXCLUDED.avg_task_time_ms
    `, [
      parseInt(stats[0].active_nodes) || 0,
      parseInt(stats[0].tasks_completed) || 0,
      parseFloat(stats[0].credits_earned) || 0,
      parseInt(stats[0].avg_time) || 0
    ]);
  } catch (error) {
    console.log('Stats recording note:', error.message);
  }
}

async function startServer() {
  try {
    await db.initializeSchema();
    console.log('Database connected');
    
    initSolana();
    
    await startTaskGenerator();
    
    setInterval(recordHourlyStats, 3600000);
    
    app.listen(config.PORT, '0.0.0.0', () => {
      console.log('\n=== Orius Compute Network ===');
      console.log(`Server: http://0.0.0.0:${config.PORT}`);
      console.log('Mode:', config.NODE_ENV);
      console.log('\nAPI Endpoints:');
      console.log('  POST /api/register         - Register wallet');
      console.log('  POST /api/heartbeat        - Report activity');
      console.log('  GET  /api/balance/:wallet  - Get balance');
      console.log('  POST /api/claim            - Claim tokens');
      console.log('  \nCompute Endpoints:');
      console.log('  POST /api/compute/capabilities  - Register node');
      console.log('  POST /api/compute/task/request  - Get task');
      console.log('  POST /api/compute/task/submit   - Submit result');
      console.log('  \nAnalytics (for ai.orius.io):');
      console.log('  GET  /api/analytics/network     - Network stats');
      console.log('  GET  /api/analytics/live        - Live activity');
      console.log('  GET  /api/data/export           - Full data export');
      console.log('  GET  /api/feed/realtime         - Activity feed');
      console.log('=============================\n');
    });
    
  } catch (error) {
    console.error('Server start error:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
