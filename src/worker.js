/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { API } from './common';

let api;
let port;

const genApiOptions = (path) => ({
  async readBuffer(filename) {
    const response = await fetch(`${path}/${filename}`);
    return response.arrayBuffer();
  },

  async compileStreaming(filename) {
    if (WebAssembly.compileStreaming) {
      return WebAssembly.compileStreaming(fetch(`${path}/${filename}`));
    } else {
      const response = await fetch(filename);
      return WebAssembly.compile(await response.arrayBuffer());
    }
  },

  hostWrite(s) {
    // In collect mode, buffer output instead of streaming
    if (collectMode) {
      bufferWrite(s);
    } else {
      port.postMessage({ id: 'write', data: s });
    }
  },
});

let currentApp = null;
let collectMode = false;
let quietMode = false;
let outputBuffer = '';

// Strip ANSI escape codes
function stripAnsi(input) {
  return input.replace(/\x1B\[[0-9;]*m/g, '');
}

// Buffer write with optional filtering of progress logs
function bufferWrite(s) {
  const text = stripAnsi(s);
  // When quiet, drop progress lines like "> Untarring ...", "done." etc.
  if (quietMode) {
    const lines = text.split(/\r?\n/);
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false; // drop empty
      if (trimmed === 'done.') return false;
      if (trimmed.startsWith('> ')) return false;
      // Drop echoed command lines starting with tool names when prefixed by '>'
      return true;
    });
    if (filtered.length) {
      outputBuffer += (outputBuffer && !outputBuffer.endsWith('\n') ? '\n' : '') + filtered.join('\n');
    }
  } else {
    outputBuffer += s;
  }
}

const onAnyMessage = async (event) => {
  const { id, payload } = event.data;

  switch (id) {
    case 'constructor':
      port = payload.port;
      port.onmessage = onAnyMessage;

      api = new API(genApiOptions(payload.path));
      api.ready.then(() => {
        port.postMessage({ id: 'ready' });
      });
      break;
    case 'setShowTiming':
      api.showTiming = payload;
      break;
    case 'run':
      // payload may contain { code, params, options }
      collectMode = !!(payload && payload.options && payload.options.collect);
      quietMode = !!(payload && payload.options && payload.options.quiet);
      outputBuffer = '';

      if (currentApp) {
        console.log('First, disallowing rAF from previous app.');
        // Stop running rAF on the previous app, if any.
        currentApp.allowRequestAnimationFrame = false;
      }
      try {
        currentApp = await api.compileLinkRun(payload);
        if (collectMode) {
          port.postMessage({ id: 'runComplete', data: { output: outputBuffer, success: true } });
          outputBuffer = '';
        }
      } catch (error) {
        if (collectMode) {
          // Any error messages printed by the WASM side were buffered already
          port.postMessage({ id: 'runError', data: { output: outputBuffer, error: String(error && error.message || error), success: false } });
          outputBuffer = '';
        } else {
          throw error;
        }
      } finally {
        collectMode = false;
        quietMode = false;
      }
      break;
  }
};

self.onmessage = onAnyMessage;
