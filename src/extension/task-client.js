/**
 * Orius Compute Network - Task Client
 * Handles task fetching, submission, and server communication
 * For Chrome/Firefox extension
 */

class OriusTaskClient {
  constructor(apiUrl, deviceId) {
    this.apiUrl = apiUrl;
    this.deviceId = deviceId;
    this.computeEngine = null;
    this.isRunning = false;
    this.taskLoop = null;
    this.stats = {
      tasksCompleted: 0,
      totalCredits: 0,
      successRate: 100,
      lastTaskTime: null
    };
    this.callbacks = {
      onTaskStart: null,
      onTaskComplete: null,
      onCreditsEarned: null,
      onError: null,
      onStatusChange: null
    };
  }

  async initialize(computeEngine) {
    this.computeEngine = computeEngine;
    
    if (!this.computeEngine.isInitialized) {
      await this.computeEngine.initialize();
    }

    const benchmark = await this.computeEngine.runBenchmark();
    
    await this.registerCapabilities(benchmark);

    console.log('Task client initialized');
    return { success: true, benchmark };
  }

  async registerCapabilities(benchmark) {
    try {
      const capabilities = {
        ...this.computeEngine.capabilities,
        cpu_benchmark_score: benchmark.cpu_score,
        estimated_tflops: benchmark.estimated_tflops
      };

      const response = await fetch(`${this.apiUrl}/api/compute/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          capabilities
        })
      });

      const result = await response.json();
      console.log('Capabilities registered:', result);
      return result;

    } catch (error) {
      console.error('Failed to register capabilities:', error);
      return { error: error.message };
    }
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.notifyStatus('running');
    console.log('Task client started');

    this.runTaskLoop();
  }

  stop() {
    this.isRunning = false;
    if (this.taskLoop) {
      clearTimeout(this.taskLoop);
      this.taskLoop = null;
    }
    this.notifyStatus('stopped');
    console.log('Task client stopped');
  }

  async runTaskLoop() {
    if (!this.isRunning) return;

    try {
      const task = await this.requestTask();

      if (task && !task.error) {
        await this.processTask(task);
      } else {
        await this.delay(5000);
      }

    } catch (error) {
      console.error('Task loop error:', error);
      this.notifyError(error);
      await this.delay(10000);
    }

    if (this.isRunning) {
      this.taskLoop = setTimeout(() => this.runTaskLoop(), 1000);
    }
  }

  async requestTask() {
    try {
      const response = await fetch(`${this.apiUrl}/api/compute/task/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          capabilities: this.computeEngine.capabilities
        })
      });

      if (response.status === 403) {
        console.log('Node banned or trust too low');
        this.stop();
        return { error: 'Node banned' };
      }

      const result = await response.json();
      
      if (result.success && result.task) {
        return result.task;
      }

      return null;

    } catch (error) {
      console.error('Task request failed:', error);
      return { error: error.message };
    }
  }

  async processTask(task) {
    console.log(`Processing task: ${task.task_uuid} (${task.task_type})`);
    this.notifyTaskStart(task);

    const result = await this.computeEngine.executeTask(task);

    if (result.success) {
      const submission = await this.submitResult(task, result);
      
      if (submission.success) {
        this.stats.tasksCompleted++;
        this.stats.lastTaskTime = Date.now();
        
        if (submission.verified && submission.credits_awarded > 0) {
          this.stats.totalCredits += submission.credits_awarded;
          this.notifyCreditsEarned(submission.credits_awarded, task);
        }
        
        this.notifyTaskComplete(task, submission);
      }
    } else {
      console.error('Task execution failed:', result.error);
      this.notifyError(new Error(result.error));
    }
  }

  async submitResult(task, result) {
    try {
      const response = await fetch(`${this.apiUrl}/api/compute/task/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          taskUuid: task.task_uuid,
          result: result.result,
          executionTimeMs: result.execution_time_ms
        })
      });

      return await response.json();

    } catch (error) {
      console.error('Result submission failed:', error);
      return { success: false, error: error.message };
    }
  }

  on(event, callback) {
    if (this.callbacks.hasOwnProperty(`on${this.capitalize(event)}`)) {
      this.callbacks[`on${this.capitalize(event)}`] = callback;
    }
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  notifyTaskStart(task) {
    if (this.callbacks.onTaskStart) {
      this.callbacks.onTaskStart(task);
    }
  }

  notifyTaskComplete(task, result) {
    if (this.callbacks.onTaskComplete) {
      this.callbacks.onTaskComplete(task, result);
    }
  }

  notifyCreditsEarned(credits, task) {
    if (this.callbacks.onCreditsEarned) {
      this.callbacks.onCreditsEarned(credits, task);
    }
  }

  notifyError(error) {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  notifyStatus(status) {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(status);
    }
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      capabilities: this.computeEngine?.capabilities || null
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OriusTaskClient;
}

if (typeof window !== 'undefined') {
  window.OriusTaskClient = OriusTaskClient;
}
