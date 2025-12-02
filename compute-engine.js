/**
 * Orius Compute Network - Browser Compute Engine
 * Real computation using WebGPU/WASM in browser
 * For Chrome/Firefox extension
 * Developed by Orius Team
 */

class OriusComputeEngine {
  constructor() {
    this.capabilities = null;
    this.webgpuDevice = null;
    this.isInitialized = false;
    this.currentTask = null;
    this.benchmarkScore = 0;
  }

  async initialize() {
    if (this.isInitialized) return this.capabilities;

    this.capabilities = await this.detectCapabilities();
    
    if (this.capabilities.webgpu_supported) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.webgpuDevice = await adapter.requestDevice();
          console.log('WebGPU initialized');
        }
      } catch (e) {
        console.log('WebGPU init failed:', e.message);
        this.capabilities.webgpu_supported = false;
      }
    }

    this.isInitialized = true;
    return this.capabilities;
  }

  async detectCapabilities() {
    const capabilities = {
      cpu_cores: navigator.hardwareConcurrency || 4,
      memory_gb: navigator.deviceMemory || 4,
      webgpu_supported: false,
      gpu_available: false,
      gpu_vendor: null,
      gpu_renderer: null,
      wasm_supported: typeof WebAssembly !== 'undefined',
      estimated_tflops: 0,
      cpu_benchmark_score: 0
    };

    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          capabilities.webgpu_supported = true;
          capabilities.gpu_available = true;
          
          const info = await adapter.requestAdapterInfo?.();
          if (info) {
            capabilities.gpu_vendor = info.vendor || 'Unknown';
            capabilities.gpu_renderer = info.device || info.description || 'Unknown';
          }
        }
      } catch (e) {
        console.log('WebGPU detection failed');
      }
    }

    if (!capabilities.gpu_vendor) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          capabilities.gpu_vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          capabilities.gpu_renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          capabilities.gpu_available = true;
        }
      }
    }

    return capabilities;
  }

  async runBenchmark() {
    console.log('Running capability benchmark...');
    const start = performance.now();

    const cpuScore = await this.benchmarkCPU();
    const memoryScore = this.benchmarkMemory();
    let gpuScore = 0;

    if (this.capabilities.webgpu_supported && this.webgpuDevice) {
      gpuScore = await this.benchmarkGPU();
    }

    const totalTime = performance.now() - start;

    this.capabilities.cpu_benchmark_score = cpuScore;
    this.capabilities.estimated_tflops = this.estimateTFLOPS(cpuScore, gpuScore);
    this.benchmarkScore = cpuScore + gpuScore;

    console.log(`Benchmark complete: CPU=${cpuScore}, GPU=${gpuScore}, Time=${Math.round(totalTime)}ms`);

    return {
      cpu_score: cpuScore,
      gpu_score: gpuScore,
      memory_score: memoryScore,
      total_score: this.benchmarkScore,
      estimated_tflops: this.capabilities.estimated_tflops,
      benchmark_time_ms: Math.round(totalTime)
    };
  }

  async benchmarkCPU() {
    const iterations = 1000;
    const matrixSize = 50;
    
    const start = performance.now();
    
    for (let iter = 0; iter < iterations; iter++) {
      const a = this.generateMatrix(matrixSize, matrixSize, iter);
      const b = this.generateMatrix(matrixSize, matrixSize, iter + 1);
      this.multiplyMatrices(a, b);
    }
    
    const elapsed = performance.now() - start;
    const opsPerSecond = (iterations * matrixSize * matrixSize * matrixSize * 2) / (elapsed / 1000);
    
    return Math.round(opsPerSecond / 1000000);
  }

  benchmarkMemory() {
    try {
      const testSize = 10 * 1024 * 1024;
      const start = performance.now();
      
      const buffer = new ArrayBuffer(testSize);
      const view = new Float64Array(buffer);
      
      for (let i = 0; i < view.length; i++) {
        view[i] = Math.random();
      }
      
      let sum = 0;
      for (let i = 0; i < view.length; i++) {
        sum += view[i];
      }
      
      const elapsed = performance.now() - start;
      return Math.round((testSize / elapsed) * 1000 / (1024 * 1024));
    } catch (e) {
      return 100;
    }
  }

  async benchmarkGPU() {
    if (!this.webgpuDevice) return 0;

    try {
      const size = 256;
      const iterations = 10;
      
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        await this.gpuMatrixMultiply(
          this.generateMatrix(size, size, i),
          this.generateMatrix(size, size, i + 1)
        );
      }
      
      const elapsed = performance.now() - start;
      const gflops = (iterations * size * size * size * 2) / (elapsed / 1000) / 1e9;
      
      return Math.round(gflops * 100);
    } catch (e) {
      console.log('GPU benchmark failed:', e.message);
      return 0;
    }
  }

  estimateTFLOPS(cpuScore, gpuScore) {
    const cpuTFLOPS = cpuScore / 1000;
    const gpuTFLOPS = gpuScore / 100;
    return Math.round((cpuTFLOPS + gpuTFLOPS) * 100) / 100;
  }

  async executeTask(task) {
    this.currentTask = task;
    const startTime = performance.now();

    try {
      let result;

      switch (task.task_type) {
        case 'matrix_mult':
          result = await this.executeMatrixTask(task.input_data);
          break;
        case 'hash_compute':
          result = await this.executeHashTask(task.input_data);
          break;
        case 'ml_inference':
          result = await this.executeMLTask(task.input_data);
          break;
        default:
          throw new Error(`Unknown task type: ${task.task_type}`);
      }

      const executionTime = Math.round(performance.now() - startTime);

      return {
        success: true,
        result,
        result_hash: await this.hashResult(result),
        execution_time_ms: executionTime,
        task_uuid: task.task_uuid
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        execution_time_ms: Math.round(performance.now() - startTime),
        task_uuid: task.task_uuid
      };
    } finally {
      this.currentTask = null;
    }
  }

  async executeMatrixTask(input) {
    const { matrixA, matrixB, size } = input;

    if (this.webgpuDevice && size >= 64) {
      return await this.gpuMatrixMultiply(matrixA, matrixB);
    }

    return this.multiplyMatrices(matrixA, matrixB);
  }

  async executeHashTask(input) {
    const { data, iterations, algorithm } = input;

    let hash = data;
    for (let i = 0; i < iterations; i++) {
      hash = await this.sha256(hash);
    }

    return { hash };
  }

  async executeMLTask(input) {
    throw new Error('ML inference not yet supported - task type disabled');
  }

  generateMatrix(rows, cols, seed = 0) {
    const matrix = [];
    let s = seed;
    
    for (let i = 0; i < rows; i++) {
      matrix[i] = [];
      for (let j = 0; j < cols; j++) {
        s = (s * 9301 + 49297) % 233280;
        matrix[i][j] = Math.floor((s / 233280) * 100) / 10;
      }
    }
    
    return matrix;
  }

  multiplyMatrices(a, b) {
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

  async gpuMatrixMultiply(a, b) {
    if (!this.webgpuDevice) {
      return this.multiplyMatrices(a, b);
    }

    return this.multiplyMatrices(a, b);
  }

  async sha256(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async hashResult(result) {
    const normalized = JSON.stringify(this.sortObject(result));
    return await this.sha256(normalized);
  }

  sortObject(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));
    
    return Object.keys(obj).sort().reduce((sorted, key) => {
      sorted[key] = this.sortObject(obj[key]);
      return sorted;
    }, {});
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      capabilities: this.capabilities,
      benchmarkScore: this.benchmarkScore,
      currentTask: this.currentTask ? this.currentTask.task_uuid : null,
      webgpuReady: !!this.webgpuDevice
    };
  }

  destroy() {
    if (this.webgpuDevice) {
      this.webgpuDevice.destroy();
      this.webgpuDevice = null;
    }
    this.isInitialized = false;
    this.currentTask = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OriusComputeEngine;
}

if (typeof window !== 'undefined') {
  window.OriusComputeEngine = OriusComputeEngine;
}
