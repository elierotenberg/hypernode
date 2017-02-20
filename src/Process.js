import bluebird from 'bluebird';
import uuid from 'uuid/v4';

import TaskQueue from './TaskQueue';

import { LOGLEVEL_DEBUG } from './logLevels';

import {
  CLUSTER_SPAWN_PROCESS,
  PROCESS_DIRECT_MESSAGE,
  PROCESS_PARENT_EXIT,
  PROCESS_PROBE_STATE,
} from './messageTypes';

import {
  CLUSTER_QUEUE,
  PROCESS_QUEUE,
} from './queueNames';

class Process {
  static create(arg) {
    if(typeof arg === 'function') {
      return class extends Process {
        *processDidReceiveMessage(...args) {
          return yield arg(...args);
        }
      };
    }
    const {
      processWillRun,
      processDidReceiveMessage,
      processWillExit,
    } = arg;
    return class extends Process {
      *processWillRun(...args) {
        return yield processWillRun(...args);
      }

      *processDidReceiveMessage(...args) {
        return yield processDidReceiveMessage(...args);
      }

      *processWillExit(...args) {
        return yield processWillExit(...args);
      }
    };
  }

  constructor(initialState, {
    parentProcessName,
    processName,
    moduleName,
    logLevel,
    mq,
  }) {
    this.parentProcessName = parentProcessName;
    this.processName = processName;
    this.moduleName = moduleName;
    this.logLevel = logLevel;
    this.mq = mq;
    this.initialState = initialState;
    this.tasks = null;
    this.children = Object.create(null);
    this.processQueue = PROCESS_QUEUE(processName);
    this.ctx = {
      getState: this.getState.bind(this),
      getProcessName: this.getProcessName.bind(this),
      getParentProcessName: this.getParentProcessName.bind(this),
      getModuleName: this.getModuleName.bind(this),
      getChildrenProcessNames: this.getChildrenProcessNames.bind(this),
      send: this.send.bind(this),
      spaw: this.spawn.bind(this),
      exit: this.exit.bind(this),
    };

    this.processDidReceiveMessage = this.processDidReceiveMessage.bind(this);
    this.processWillExit = bluebird.coroutine(this.processWillExit.bind(this));
    this.processWillRun = bluebird.coroutine(this.processWillRun.bind(this));
  }

  /** Methods which can be overriden **/

  *processDidReceiveMessage(state, message, processName, ctx) {
    void ctx;
    void processName;
    return state;
  }

  *processWillExit(state, err, ctx) {
    void ctx;
    return err;
  }

  *processWillRun(state, ctx) {
    void ctx;
    return state;
  }

  /** Public API (provided in context) **/

  getState() {
    return this.tasks ? this.tasks.getState() : this.initialState;
  }

  getProcessName() {
    return this.processName;
  }

  getParentProcessName() {
    return this.parentProcessName;
  }

  getModuleName() {
    return this.moduleName;
  }

  getChildrenProcessNames() {
    return this.children;
  }

  send(processName, message) {
    const mq = this.mq;
    const processQueue = PROCESS_QUEUE(processName);
    mq.assertQueue(processQueue, { duable: false });
    mq.sendToQueue(processQueue, new Buffer(JSON.stringify({
      type: PROCESS_DIRECT_MESSAGE,
      payload: {
        sourceProcessName: this.getProcessName(),
        message,
      },
    })));
    if(this.logLevel === LOGLEVEL_DEBUG) {
      console.log('send', {
        sourceProcessName: this.getProcessName(),
        targetProcessName: processName,
        message,
      });
    }
  }

  spawn(moduleName, initialState) {
    const mq = this.mq;
    mq.assertQueue(CLUSTER_QUEUE, { durable: false });
    const processName = `${moduleName}:${uuid()}`;
    mq.sendToQueue(CLUSTER_QUEUE, new Buffer(JSON.stringify({
      type: CLUSTER_SPAWN_PROCESS,
      payload: {
        parentProcessName: this.getProcessName(),
        processName,
        moduleName,
        initialState,
      },
    })));
    this.children[processName] = processName;
    if(this.logLevel === LOGLEVEL_DEBUG) {
      console.log('spawn', {
        parentProcessName: this.getProcessName(),
        processName,
        moduleName,
        initialState,
      });
    }
    return processName;
  }

  async exit(err, { notifyParent = true } = {}) {
    const mq = this.mq;
    try {
      await this.processWillExit(this.getState(), err, this.ctx);
    }
    catch(internalErr) {
      console.error(internalErr);
    }
    if(notifyParent) {
      this.send(this.getParentProcessName(), {
        type: 'CHILD_PROCESS_EXIT',
        payload: {
          err,
        },
      });
    }

    this.tasks.exit(err);
    Object.keys(this.children).forEach((processName) => {
      mq.sendToQueue(PROCESS_QUEUE(processName), new Buffer(JSON.stringify({
        type: PROCESS_PARENT_EXIT,
        payload: {
          err,
        },
      })));
      mq.deleteQueue(this.processQueue);
    });
    if(this.logLevel === LOGLEVEL_DEBUG) {
      console.log('exit', {
        processName: this.getProcessName(),
        err,
      });
    }
    this.storage.hdelAsync('processes', this.getProcessName());
  }

  /** Internal API **/

  async run() {
    try {
      const initialState = await bluebird.coroutine(this.processWillRun.bind(this))(this.getState(), this.ctx);
      this.tasks = new TaskQueue(initialState);
      this.tasks.catch((err) => this.exit(err));
      const mq = this.mq;
      const processQueue = this.processQueue;
      await this.storage.hsetAsync('processes', this.getProcessName(), JSON.stringify({
        processName: this.getProcessName(),
        parentProcessName: this.getParentProcessName(),
        moduleName: this.getModuleName(),
      }));
      mq.assertQueue(processQueue, { durable: false });
      mq.consume(processQueue, (message) => this.consumeProcessQueueMessage(message));
    }
    catch(err) {
      this.exit(err);
    }
  }

  consumeProcessQueueMessage(message) {
    const { type, payload } = JSON.parse(message.content.toString());
    if(type === PROCESS_DIRECT_MESSAGE) {
      this.tasks.enqueue(function* receive(state) {
        return yield this.processDidReceiveMessage(
          state,
          payload.message,
          payload.sourceProcessName,
          this.ctx,
        );
      });
      return;
    }
    if(type === PROCESS_PARENT_EXIT) {
      const { err } = payload;
      this.exit(err, { notifyParent: false });
      return;
    }
    if(type === PROCESS_PROBE_STATE) {
      const { queueName } = payload;
      this.mq.sendToQueue(queueName, new Buffer(JSON.stringify({
        processName: this.getProcessName(),
        parentProcessName: this.getParentProcessName(),
        childrenProcessNames: this.getChildrenProcessNames(),
      })));
      return;
    }
  }
}

export default Process;
