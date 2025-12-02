/**
 * Orius Compute Network - Task Generator
 * Creates compute tasks for distribution to nodes
 * Developed by Orius Team
 */

const crypto = require('../utils/crypto');
const config = require('../utils/config');
const db = require('../utils/database');

const TASK_TYPES = {
  MATRIX_MULT: 'matrix_mult',
  HASH_COMPUTE: 'hash_compute',
  ML_INFERENCE: 'ml_inference'
};

async function generateMatrixTask(difficulty = 1) {
  const size = 8 + (difficulty * 4); // 12x12 for diff 1, 16x16 for diff 2, etc
  const seed = Date.now();
  
  const matrixA = crypto.generateDeterministicMatrix(seed, size, size);
  const matrixB = crypto.generateDeterministicMatrix(seed + 1, size, size);
  
  const inputData = {
    type: TASK_TYPES.MATRIX_MULT,
    matrixA,
    matrixB,
    size,
    seed
  };
  
  const inputHash = crypto.sha256(inputData);
  const expectedResult = multiplyMatrices(matrixA, matrixB);
  const expectedHash = crypto.hashResult(expectedResult);
  
  return {
    task_uuid: crypto.generateTaskUUID(),
    task_type: TASK_TYPES.MATRIX_MULT,
    difficulty,
    input_hash: inputHash,
    expected_output_hash: expectedHash,
    input_data: inputData,
    reward_credits: config.CREDITS_PER_MATRIX_TASK * difficulty,
    max_execution_time_ms: 5000 * difficulty,
    requires_gpu: difficulty > 3
  };
}

async function generateHashTask(difficulty = 1) {
  const iterations = 1000 * difficulty;
  const dataSize = 64 * difficulty;
  const data = require('crypto').randomBytes(dataSize).toString('hex');
  
  const inputData = {
    type: TASK_TYPES.HASH_COMPUTE,
    data,
    iterations,
    algorithm: 'sha256'
  };
  
  const inputHash = crypto.sha256(inputData);
  const expectedResult = computeIterativeHash(data, iterations);
  const expectedHash = crypto.hashResult({ hash: expectedResult });
  
  return {
    task_uuid: crypto.generateTaskUUID(),
    task_type: TASK_TYPES.HASH_COMPUTE,
    difficulty,
    input_hash: inputHash,
    expected_output_hash: expectedHash,
    input_data: inputData,
    reward_credits: config.CREDITS_PER_HASH_TASK * difficulty,
    max_execution_time_ms: 3000 * difficulty,
    requires_gpu: false
  };
}

async function generateMLInferenceTask(difficulty = 1) {
  const inputSize = 224;
  const seed = Date.now();
  
  const inputData = {
    type: TASK_TYPES.ML_INFERENCE,
    model: 'mobilenet_v2_quantized',
    model_url: '/models/mobilenet_v2_quant.onnx',
    model_hash: 'placeholder_hash',
    input_shape: [1, 3, inputSize, inputSize],
    input_data: generateRandomTensor(seed, [1, 3, inputSize, inputSize]),
    seed
  };
  
  const inputHash = crypto.sha256({ seed, model: inputData.model });
  
  return {
    task_uuid: crypto.generateTaskUUID(),
    task_type: TASK_TYPES.ML_INFERENCE,
    difficulty,
    input_hash: inputHash,
    expected_output_hash: null,
    input_data: inputData,
    model_url: inputData.model_url,
    model_hash: inputData.model_hash,
    reward_credits: config.CREDITS_PER_ML_TASK * difficulty,
    max_execution_time_ms: 15000 * difficulty,
    requires_gpu: true
  };
}

async function createAndStoreTask(type, difficulty = 1) {
  let task;
  
  switch (type) {
    case TASK_TYPES.MATRIX_MULT:
      task = await generateMatrixTask(difficulty);
      break;
    case TASK_TYPES.HASH_COMPUTE:
      task = await generateHashTask(difficulty);
      break;
    case TASK_TYPES.ML_INFERENCE:
      task = await generateMLInferenceTask(difficulty);
      break;
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
  
  const expiresAt = new Date(Date.now() + 3600000); // 1 hour
  
  const result = await db.query(`
    INSERT INTO compute_tasks 
    (task_uuid, task_type, difficulty, input_hash, expected_output_hash, 
     input_data, model_url, model_hash, reward_credits, max_execution_time_ms, 
     requires_gpu, redundancy_count, status, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13)
    RETURNING *
  `, [
    task.task_uuid,
    task.task_type,
    task.difficulty,
    task.input_hash,
    task.expected_output_hash,
    JSON.stringify(task.input_data),
    task.model_url || null,
    task.model_hash || null,
    task.reward_credits,
    task.max_execution_time_ms,
    task.requires_gpu,
    config.TASK_REDUNDANCY,
    expiresAt
  ]);
  
  return result.rows[0];
}

async function createCanaryTask(type) {
  const canaryInput = crypto.generateCanaryInput(type);
  let knownResult;
  
  switch (type) {
    case TASK_TYPES.MATRIX_MULT:
      const { matrixA, matrixB } = canaryInput;
      knownResult = multiplyMatrices(matrixA, matrixB);
      break;
    case TASK_TYPES.HASH_COMPUTE:
      knownResult = { hash: computeIterativeHash(canaryInput.data, canaryInput.iterations) };
      break;
    default:
      throw new Error(`Canary not supported for: ${type}`);
  }
  
  const taskUuid = `canary_${crypto.generateTaskUUID()}`;
  const knownHash = crypto.hashResult(knownResult);
  
  await db.query(`
    INSERT INTO canary_tasks (task_uuid, task_type, input_data, known_output_hash, known_result)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (task_uuid) DO NOTHING
  `, [taskUuid, type, JSON.stringify(canaryInput), knownHash, JSON.stringify(knownResult)]);
  
  return { taskUuid, type, input: canaryInput, knownHash, knownResult };
}

function multiplyMatrices(a, b) {
  const rowsA = a.length;
  const colsA = a[0].length;
  const colsB = b[0].length;
  
  const result = [];
  for (let i = 0; i < rowsA; i++) {
    result[i] = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = Math.round(sum * 1000) / 1000;
    }
  }
  return result;
}

function computeIterativeHash(data, iterations) {
  let hash = data;
  for (let i = 0; i < iterations; i++) {
    hash = crypto.sha256(hash);
  }
  return hash;
}

function generateRandomTensor(seed, shape) {
  const rng = seedRandom(seed);
  const total = shape.reduce((a, b) => a * b, 1);
  const flat = [];
  for (let i = 0; i < Math.min(total, 1000); i++) {
    flat.push(Math.floor(rng() * 256));
  }
  return flat;
}

function seedRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

async function ensureTaskPool(minTasks = 100) {
  const { rows } = await db.query(`
    SELECT task_type, COUNT(*) as count 
    FROM compute_tasks 
    WHERE status = 'pending' AND expires_at > NOW()
    GROUP BY task_type
  `);
  
  const counts = {};
  rows.forEach(r => counts[r.task_type] = parseInt(r.count));
  
  const tasks = [];
  
  for (const type of [TASK_TYPES.MATRIX_MULT, TASK_TYPES.HASH_COMPUTE]) {
    const current = counts[type] || 0;
    const needed = Math.max(0, minTasks - current);
    
    for (let i = 0; i < needed; i++) {
      const difficulty = 1 + Math.floor(Math.random() * 3);
      tasks.push(createAndStoreTask(type, difficulty));
    }
  }
  
  if (tasks.length > 0) {
    await Promise.all(tasks);
    console.log(`Generated ${tasks.length} new tasks`);
  }
  
  return tasks.length;
}

module.exports = {
  TASK_TYPES,
  generateMatrixTask,
  generateHashTask,
  generateMLInferenceTask,
  createAndStoreTask,
  createCanaryTask,
  ensureTaskPool,
  multiplyMatrices,
  computeIterativeHash
};
