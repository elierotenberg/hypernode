import ConnectedInterface from './ConnectedInterface';

import { CLUSTER_QUEUE } from './queueNames';
import {
  CLUSTER_LOAD_MODULE,
  CLUSTER_SPAWN_PROCESS,
} from './messageTypes';

class ClusterClient extends ConnectedInterface {
  constructor({
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
  }

  loadModule(moduleName, modulePath) {
    const { mq } = this;
    mq.assertQueue(CLUSTER_QUEUE, { durable: false });
    mq.sendToQueue(CLUSTER_QUEUE, new Buffer(JSON.stringify({
      type: CLUSTER_LOAD_MODULE,
      payload: {
        moduleName,
        modulePath,
      },
    })));
  }

  async listModules() {
    const { storage } = this;
    const modules = await storage.hgetallAsync('modules');
    return modules;
  }

  spawnRootProcess(
    moduleName,
    initialState,
    processName,
  ) {
    const { mq } = this;
    mq.assertQueue(CLUSTER_QUEUE, { duable: false });
    mq.sendToQueue(CLUSTER_QUEUE, new Buffer(JSON.stringify({
      type: CLUSTER_SPAWN_PROCESS,
      payload: {
        moduleName,
        initialState,
        processName,
        parentProcessName: 'root',
      },
    })));
  }

  async listProcesses() {
    const { storage } = this;
    const processes = await storage.hgetallAsync('processes');
    const tree = Object.create(null);
    processes.forEach(({ processName, parentProcessName }) => {
      if(!tree[processName]) {
        tree[processName] = Object.assign({
          children: Object.create(null),
        }, processes[processName]);
      }
      if(!tree[parentProcessName]) {
        tree[parentProcessName] = Object.assign({
          children: Object.create(null),
        }, processes[parentProcessName]);
      }
      tree[parentProcessName].children[processName] = tree[processName];
    });
    return tree.root;
  }
}

export default ClusterClient;
