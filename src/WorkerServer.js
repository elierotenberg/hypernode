import {
  WORKER_LOAD_MODULE,
  WORKER_SPAWN_PROCESS,
} from './messageTypes';

import { LOGLEVEL_DEBUG } from './logLevels';
import {
  MODULES_QUEUE,
  SPAWN_PROCESS_QUEUE,
} from './queueNames';

import ConnectedInterface from './ConnectedInterface';

class WorkerServer extends ConnectedInterface {
  constructor({
    nodeName,
    workerName,
    loglLevel,
    mqConfig: {
      url,
      socketOptions,
    },
    storageConfig: {
      port,
      host,
      options,
    },
  }) {
    super({
      mqConfig: {
        url,
        socketOptions,
      },
      storageConfig: {
        port,
        host,
        options,
      },
    });
    this.nodeName = nodeName;
    this.workerName = workerName;
    this.logLevel = loglLevel;
  }

  async loadModules() {
    const { mq: { ch } } = this;
    ch.assertQueue(MODULES_QUEUE, { durable: false });
    ch.consume(MODULES_QUEUE, (message) => this.consumeModulesQueueMessage(message), { noAck: true });
    const modules = await this.storage.hgetallAsync('modules');
    Object.keys(modules).forEach((moduleName) => {
      const modulePath = modules[moduleName];
      this.modules[moduleName] = require(modulePath); // eslint-disable-line global-require
    });
  }

  async loadModule(moduleName) {
    const modulePath = await this.storage.hgetAsync('modules', moduleName);
    this.modules[moduleName] = require(modulePath); // eslint-disable-line global-require
  }

  consumeModulesQueueMessage(message) {
    const { type, payload } = JSON.parse(message.content.toString());
    if(type === WORKER_LOAD_MODULE) {
      const { moduleName } = payload;
      this.loadModule(moduleName);
      return;
    }
  }

  async run() {
    await this.connect();
    await this.loadModules();
    const mq = this.mq;
    mq.assertQueue(SPAWN_PROCESS_QUEUE, { durable: false });
    mq.consume(SPAWN_PROCESS_QUEUE, (message) => this.consumeSpawnProcessQueue(message), { noAck: true });
    return this;
  }

  consumeSpawnProcessQueue(message) {
    const { type, payload } = JSON.parse(message.content.toString());
    if(type === WORKER_SPAWN_PROCESS) {
      const {
        moduleName,
        initialState,
        processName,
        parentProcessName,
      } = payload;
      this.spawnProcess({
        parentProcessName,
        processName,
        moduleName,
        initialState,
      });
      return;
    }
  }

  spawnProcess({
    parentProcessName,
    processName,
    moduleName,
    initialState,
  }) {
    const Process = this.modules[moduleName];
    const p = new Process(initialState, {
      parentProcessName,
      processName,
      moduleName,
      logLevel: this.logLevel,
      mq: this.mq,
    });
    if(this.logLevel === LOGLEVEL_DEBUG) {
      console.log('spawnProcess', {
        parentProcessName,
        processName,
        moduleName,
        initialState,
      });
    }
    p.run();
  }
}

export default WorkerServer;
