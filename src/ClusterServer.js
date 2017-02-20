import ConnectedInterface from './ConnectedInterface';

import {
  CLUSTER_LOAD_MODULE,
  CLUSTER_SPAWN_PROCESS,

  WORKER_LOAD_MODULE,
  WORKER_SPAWN_PROCESS,
} from './messageTypes';

import {
  CLUSTER_QUEUE,
  MODULES_QUEUE,
  SPAWN_PROCESS_QUEUE,
} from './queueNames';

class ClusterServer extends ConnectedInterface {
  constructor({
    logLevel,
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
    this.logLevel = logLevel;
  }

  async run() {
    await this.connect();
    const mq = this.mq;
    mq.assertQueue(CLUSTER_QUEUE, { durable: false });
    mq.consume(CLUSTER_QUEUE, (message) => this.consumeClusterQueueMessage(message), { noAck: true });
  }

  async consumeClusterQueueMessage(message) {
    const { type, payload } = JSON.parse(message.content.toString());
    if(type === CLUSTER_LOAD_MODULE) {
      const { moduleName, modulePath } = payload;
      const { mq, storage } = this;
      await storage.hsetAsync('modules', moduleName, modulePath);
      mq.assertQueue(MODULES_QUEUE, { durable: false });
      mq.sendToQueue(MODULES_QUEUE, new Buffer(JSON.stringify({
        type: WORKER_LOAD_MODULE,
        payload: {
          moduleName,
        },
      })));
    }
    if(type === CLUSTER_SPAWN_PROCESS) {
      const {
        moduleName,
        initialState,
        processName,
        parentProcessName,
      } = payload;
      const { mq } = this;
      mq.assertQueue(SPAWN_PROCESS_QUEUE, { duable: false });
      mq.sendToQueue(SPAWN_PROCESS_QUEUE, new Buffer(JSON.stringify({
        type: WORKER_SPAWN_PROCESS,
        payload: {
          moduleName,
          initialState,
          processName,
          parentProcessName,
        },
      })));
    }
  }
}

export default ClusterServer;
