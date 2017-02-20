/** @hypernode-module HttpServer **/

import http from 'http';

import { Process } from '../';

export default class HttpServer extends Process {
  *processWillRun(state, { spawn }) {
    state.pendingRequests = Object.create(null);
    state.server = http.createServer((req, res) => {
      const processName = spawn('HttpServerRequestHandler', { req });
      state.pendingRequests[processName] = res;
    }).listen(state.port);
    return state;
  }

  *processDidReceiveMessage(state, { type, payload }, processName, { send }) {
    if(type === 'CHILD_PROCESS_EXIT') {
      const { err } = payload;
      if(state.pendingRequests[processName]) {
        state.pendingRequests[processName].end(err.toString());
        delete state.pendingRequests[processName];
      }
    }
    if(type === 'HTTP_RESPONSE') {
      const { response } = payload;
      state.pendingRequests[processName].end(response);
      delete state.pendingRequests[processName];
      send(processName, { type: 'PROCESS_EXIT', payload: { err: 'Response sent' } });
    }
    return state;
  }

  *processWillExit(state) {
    state.server.close();
  }
}
