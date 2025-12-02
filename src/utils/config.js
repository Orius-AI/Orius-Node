/**
 * Orius Compute Network - Configuration
 * Central configuration for the distributed compute network
 * Developed by Orius Team
 */

module.exports = {
  // Server
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Solana
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  TREASURY_PRIVATE_KEY: process.env.TREASURY_PRIVATE_KEY,
  TOKEN_MINT: process.env.TOKEN_MINT || '',
  TREASURY_PUBLIC_KEY: process.env.TREASURY_PUBLIC_KEY || '',
  TOKEN_DECIMALS: 6,
  
  // Token Economics
  MIN_CLAIM_AMOUNT: 100,
  MAX_CLAIM_AMOUNT: 10000,
  CLAIM_COOLDOWN_HOURS: 1,
  DAILY_CAP: 8000,
  
  // Compute Rewards
  CREDITS_PER_MATRIX_TASK: 0.5,
  CREDITS_PER_HASH_TASK: 0.3,
  CREDITS_PER_ML_TASK: 2.0,
  CREDITS_TO_TOKEN_RATIO: 1.0, // 1 credit = 1 token
  
  // Heartbeat Settings
  HEARTBEAT_INTERVAL_MS: 10000,
  HEARTBEAT_RATE_LIMIT_MS: 8000,
  ONLINE_REWARD_PER_HEARTBEAT: { min: 0.1, max: 0.3 }, // Reduced since compute pays more
  
  // Task Settings
  TASK_TIMEOUT_MS: 30000,
  TASK_REDUNDANCY: 3, // How many nodes verify same task
  MIN_TRUST_SCORE: 50, // Minimum trust to receive tasks
  CANARY_TASK_FREQUENCY: 0.05, // 5% of tasks are canary (verification)
  
  // Node Requirements
  MIN_CPU_CORES: 2,
  MIN_MEMORY_GB: 2,
  
  // API Rate Limits
  API_RATE_LIMIT_WINDOW_MS: 60000,
  API_RATE_LIMIT_MAX_REQUESTS: 100,
  
  // WebSocket
  WS_HEARTBEAT_INTERVAL: 30000,
  WS_PING_TIMEOUT: 10000,
  
  // RPC URL
  get RPC_URL() {
    return this.HELIUS_API_KEY 
      ? `https://mainnet.helius-rpc.com/?api-key=${this.HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com';
  }
};
