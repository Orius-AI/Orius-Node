/**
 * Orius Compute Worker
 * Distributed compute task executor
 * Developed by Orius Team
 */

let isRunning = false;
let computeScore = 0;
let tasksCompleted = 0;

self.onmessage = function(e) {
  const { command, data } = e.data;
  
  switch (command) {
    case 'start':
      isRunning = true;
      runComputeLoop();
      break;
    case 'stop':
      isRunning = false;
      break;
    case 'getStats':
      self.postMessage({
        type: 'stats',
        data: { computeScore, tasksCompleted }
      });
      break;
  }
};

function runComputeLoop() {
  if (!isRunning) return;
  
  const startTime = performance.now();
  
  // Simulate matrix operations (like neural network forward pass)
  const result = simulateMatrixOps(64, 64);
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  // Calculate compute score based on performance
  const baseScore = Math.floor(1000 / (duration + 1));
  computeScore = Math.min(999, Math.max(100, baseScore + Math.floor(Math.random() * 50)));
  tasksCompleted++;
  
  self.postMessage({
    type: 'taskComplete',
    data: {
      taskId: tasksCompleted,
      duration: duration.toFixed(2),
      computeScore,
      hashRate: Math.floor(result.ops / duration)
    }
  });
  
  // Run next task after a short delay to prevent CPU overload
  setTimeout(() => runComputeLoop(), 2000);
}

function simulateMatrixOps(rows, cols) {
  const matrixA = createMatrix(rows, cols);
  const matrixB = createMatrix(cols, rows);
  
  let ops = 0;
  const result = [];
  
  // Matrix multiplication simulation
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < rows; j++) {
      let sum = 0;
      for (let k = 0; k < cols; k++) {
        sum += matrixA[i][k] * matrixB[k][j];
        ops++;
      }
      result[i][j] = sum;
    }
  }
  
  // Simulate activation function (ReLU-like)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < rows; j++) {
      result[i][j] = Math.max(0, result[i][j]);
      ops++;
    }
  }
  
  // Hash computation simulation
  let hash = 0;
  for (let i = 0; i < 1000; i++) {
    hash = ((hash << 5) - hash + i) | 0;
    ops++;
  }
  
  return { result, ops, hash };
}

function createMatrix(rows, cols) {
  const matrix = [];
  for (let i = 0; i < rows; i++) {
    matrix[i] = [];
    for (let j = 0; j < cols; j++) {
      matrix[i][j] = Math.random() * 2 - 1;
    }
  }
  return matrix;
}
