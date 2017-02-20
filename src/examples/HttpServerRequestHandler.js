/** @hypernode-module HttpServerRequestHandler **/

import { Process } from '../';

export default class HttpServerRequestHandler extends Process {
  *processWillRun(state, { send, getParentProcessName }) {
    const { req } = state;
    send(getParentProcessName(), { response: `hello ${req.connection.remoteAddress}` });
    return state;
  }

  *processDidReceiveMessage(state, { type, payload }, processName, { exit }) {
    if(type === 'PROCESS_EXIT') {
      const { err } = payload;
      exit(err);
    }
  }
}
