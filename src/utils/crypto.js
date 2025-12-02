/**
 * Orius Compute Network - Cryptographic Utilities
 * Hashing, signing, and verification
 * Developed by Orius Team
 */

const crypto = require('crypto');

function sha256(data) {
  if (typeof data === 'object') {
    data = JSON.stringify(data);
  }
  return crypto.createHash('sha256').update(data).digest('hex');
}

function blake3(data) {
  if (typeof data === 'object') {
    data = JSON.stringify(data);
  }
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateTaskUUID() {
  return `task_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateSessionId() {
  return `sess_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function hashResult(result) {
  const normalized = typeof result === 'object' 
    ? JSON.stringify(sortObject(result))
    : String(result);
  return sha256(normalized);
}

function sortObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  
  return Object.keys(obj).sort().reduce((sorted, key) => {
    sorted[key] = sortObject(obj[key]);
    return sorted;
  }, {});
}

function verifyResultHash(result, expectedHash) {
  const actualHash = hashResult(result);
  return actualHash === expectedHash;
}

function generateCanaryInput(taskType) {
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  
  switch (taskType) {
    case 'matrix_mult':
      return {
        matrixA: generateDeterministicMatrix(seed, 4, 4),
        matrixB: generateDeterministicMatrix(seed + 1, 4, 4),
        seed
      };
    case 'hash_compute':
      return {
        data: crypto.randomBytes(32).toString('hex'),
        iterations: 100 + (seed % 100),
        seed
      };
    default:
      return { seed };
  }
}

function generateDeterministicMatrix(seed, rows, cols) {
  const rng = seedRandom(seed);
  const matrix = [];
  for (let i = 0; i < rows; i++) {
    matrix[i] = [];
    for (let j = 0; j < cols; j++) {
      matrix[i][j] = Math.floor(rng() * 100) / 10;
    }
  }
  return matrix;
}

function seedRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function signTaskManifest(task, secret) {
  const payload = JSON.stringify({
    uuid: task.task_uuid,
    type: task.task_type,
    input_hash: task.input_hash,
    expires: task.expires_at
  });
  
  const hmac = crypto.createHmac('sha256', secret || 'orius-secret');
  hmac.update(payload);
  return hmac.digest('hex');
}

function verifyTaskSignature(task, signature, secret) {
  const expected = signTaskManifest(task, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = {
  sha256,
  blake3,
  generateTaskUUID,
  generateSessionId,
  hashResult,
  verifyResultHash,
  generateCanaryInput,
  generateDeterministicMatrix,
  signTaskManifest,
  verifyTaskSignature
};
