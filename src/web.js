import WebWorker from 'web-worker:./worker.js';

class WorkerAPI {
  onReady;
  readyResolve;
  constructor(path) {
    this.nextResponseId = 0;
    this.responseCBs = new Map();
    this.worker = new WebWorker();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);

    const remotePort = channel.port2;
    this.worker.postMessage(
      {
        id: 'constructor',
        payload: {
          port: remotePort,
          path,
        },
      },
      [remotePort],
    );
    this.onReady = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Collect mode state
    this.isCollecting = false;
    this.collectedOutput = '';
    this.collectResolve = null;
    this.collectReject = null;
  }

  setShowTiming(value) {
    this.port.postMessage({ id: 'setShowTiming', payload: value });
  }

  terminate() {
    this.worker.terminate();
  }

  async runAsync(id, options) {
    const responseId = this.nextResponseId++;
    const responsePromise = new Promise((resolve, reject) => {
      this.responseCBs.set(responseId, { resolve, reject });
    });
    this.port.postMessage({ id, responseId, payload: options });
    return await responsePromise;
  }

  compile(code, options) {
    this.port.postMessage({ id: 'compile', payload: { code, options } });
  }

  link(obj, out, options) {
    this.port.postMessage({
      id: 'link',
      data: {
        obj,
        out,
        options,
      },
    });
  }

  execute(out, params) {
    this.port.postMessage({ id: 'execute', payload: { out, params } });
  }

  run(code, params, options) {
    this.port.postMessage({ id: 'run', payload: { code, params, options } });
  }

  onmessage(event) {
    switch (event.data.id) {
      case 'ready':
        this.readyResolve();
        break;
      case 'write':
        if (this.isCollecting) {
          // Accumulate instead of streaming
          this.collectedOutput += event.data.data;
        } else {
          console.log(event.data.data);
        }
        break;
      case 'runComplete':
        if (this.isCollecting && this.collectResolve) {
          const payload = event.data.data || {};
          const output = payload.output != null ? payload.output : this.collectedOutput;
          this.collectResolve({ output, success: true });
        }
        this.isCollecting = false;
        this.collectedOutput = '';
        this.collectResolve = null;
        this.collectReject = null;
        break;
      case 'runError':
        if (this.isCollecting && this.collectReject) {
          const payload = event.data.data || {};
          const output = payload.output != null ? payload.output : this.collectedOutput;
          const error = payload.error;
          this.collectReject({ output, error, success: false });
        }
        this.isCollecting = false;
        this.collectedOutput = '';
        this.collectResolve = null;
        this.collectReject = null;
        break;
      case 'runAsync': {
        const responseId = event.data.responseId;
        const promise = this.responseCBs.get(responseId);
        if (promise) {
          this.responseCBs.delete(responseId);
          promise.resolve(event.data.data);
        }
        break;
      }
    }
  }
}

export let isInitialed = false;

let api;

export async function init({ path }) {
  if (isInitialed) {
    return;
  }
  api = new WorkerAPI(path || location.origin);
  await api.onReady;
  isInitialed = true;
}

// TODO
export async function compile(code, options) {}

// TODO
export async function link(obj, out, options) {}

// TODO
export async function execute(out, params, options) {}

/**
 * compile + link + execute
 */
export async function run(code) {
  // TODO: params, options
  return await api.run(code);
}

// New helper: run once and collect final output without streaming
export async function runAndCollect(code, options = {}) {
  // Always enable quiet + collect for this path
  const mergedOptions = { ...(options || {}), quiet: true, collect: true };
  return await new Promise((resolve, reject) => {
    api.isCollecting = true;
    api.collectedOutput = '';
    api.collectResolve = resolve;
    api.collectReject = reject;
    api.port.postMessage({ id: 'run', payload: { code, params: undefined, options: mergedOptions } });
  });
}
