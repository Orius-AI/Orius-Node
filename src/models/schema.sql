-- Orius Compute Network Database Schema
-- Distributed Compute Platform
-- Developed by Orius Team

-- Users table with device binding
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(44) UNIQUE NOT NULL,
  device_id VARCHAR(64) UNIQUE,
  device_bound_at TIMESTAMP,
  total_earned DECIMAL(18,6) DEFAULT 0,
  claimable_balance DECIMAL(18,6) DEFAULT 0,
  total_online_seconds INTEGER DEFAULT 0,
  total_compute_credits DECIMAL(18,6) DEFAULT 0,
  last_heartbeat_at TIMESTAMP,
  last_active TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Node capabilities and benchmarks
CREATE TABLE IF NOT EXISTS node_capabilities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  cpu_cores INTEGER DEFAULT 1,
  cpu_benchmark_score DECIMAL(12,2) DEFAULT 0,
  gpu_available BOOLEAN DEFAULT FALSE,
  gpu_vendor VARCHAR(100),
  gpu_renderer VARCHAR(200),
  webgpu_supported BOOLEAN DEFAULT FALSE,
  wasm_supported BOOLEAN DEFAULT TRUE,
  memory_gb DECIMAL(6,2) DEFAULT 0,
  estimated_tflops DECIMAL(10,4) DEFAULT 0,
  last_benchmark_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Compute tasks pool
CREATE TABLE IF NOT EXISTS compute_tasks (
  id SERIAL PRIMARY KEY,
  task_uuid VARCHAR(64) UNIQUE NOT NULL,
  task_type VARCHAR(50) NOT NULL, -- 'matrix_mult', 'hash_compute', 'ml_inference'
  difficulty INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 5,
  input_hash VARCHAR(128) NOT NULL,
  expected_output_hash VARCHAR(128), -- For verification
  input_data JSONB NOT NULL,
  model_url VARCHAR(500), -- For ML tasks
  model_hash VARCHAR(128), -- For integrity check
  reward_credits DECIMAL(12,6) NOT NULL,
  max_execution_time_ms INTEGER DEFAULT 30000,
  requires_gpu BOOLEAN DEFAULT FALSE,
  redundancy_count INTEGER DEFAULT 3, -- How many nodes should verify
  status VARCHAR(20) DEFAULT 'pending', -- pending, assigned, completed, failed
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Task assignments to nodes
CREATE TABLE IF NOT EXISTS task_assignments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES compute_tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  assigned_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  result_hash VARCHAR(128),
  result_data JSONB,
  execution_time_ms INTEGER,
  status VARCHAR(20) DEFAULT 'assigned', -- assigned, processing, completed, failed, timeout
  verified BOOLEAN DEFAULT FALSE,
  credits_awarded DECIMAL(12,6) DEFAULT 0,
  error_message TEXT
);

-- Verified results and consensus
CREATE TABLE IF NOT EXISTS task_results (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES compute_tasks(id) ON DELETE CASCADE,
  consensus_hash VARCHAR(128),
  total_submissions INTEGER DEFAULT 0,
  matching_submissions INTEGER DEFAULT 0,
  consensus_reached BOOLEAN DEFAULT FALSE,
  final_result JSONB,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Earnings history
CREATE TABLE IF NOT EXISTS earnings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(50),
  earned_amount DECIMAL(18,6) NOT NULL,
  earning_type VARCHAR(30) DEFAULT 'compute', -- 'compute', 'online_time', 'bonus'
  task_id INTEGER REFERENCES compute_tasks(id),
  online_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Claims/Withdrawals
CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(18,6) NOT NULL,
  tx_signature VARCHAR(128),
  status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Network statistics (hourly aggregates)
CREATE TABLE IF NOT EXISTS network_stats (
  id SERIAL PRIMARY KEY,
  hour_timestamp TIMESTAMP NOT NULL,
  active_nodes INTEGER DEFAULT 0,
  total_tasks_completed INTEGER DEFAULT 0,
  total_compute_credits DECIMAL(18,6) DEFAULT 0,
  avg_task_time_ms INTEGER DEFAULT 0,
  total_tflops DECIMAL(14,4) DEFAULT 0,
  unique_countries INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Canary tasks for anti-cheat
CREATE TABLE IF NOT EXISTS canary_tasks (
  id SERIAL PRIMARY KEY,
  task_uuid VARCHAR(64) UNIQUE NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  input_data JSONB NOT NULL,
  known_output_hash VARCHAR(128) NOT NULL,
  known_result JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Node trust scores
CREATE TABLE IF NOT EXISTS node_trust (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(64) UNIQUE NOT NULL,
  trust_score DECIMAL(5,2) DEFAULT 100.00, -- 0-100
  total_tasks_completed INTEGER DEFAULT 0,
  successful_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  canary_failures INTEGER DEFAULT 0,
  last_failure_at TIMESTAMP,
  banned BOOLEAN DEFAULT FALSE,
  banned_at TIMESTAMP,
  ban_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON compute_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON compute_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_assignments_device ON task_assignments(device_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON task_assignments(status);
CREATE INDEX IF NOT EXISTS idx_earnings_user ON earnings(user_id);
CREATE INDEX IF NOT EXISTS idx_network_stats_hour ON network_stats(hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_node_trust_device ON node_trust(device_id);
