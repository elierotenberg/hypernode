import uuid from 'uuid/v4';
import childProcess from 'child_process';

class NodeServer {
  constructor({
    nodeName,
    numWorkers,
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
    this.nodeName = nodeName;
    this.numWorkers = numWorkers;
    this.logLevel = logLevel;
    this.mqConfig = {
      url,
      socketOptions,
    };
    this.storageConfig = {
      port,
      host,
      options,
    };
    this.childrenProcesses = Object.create(null);
  }

  run() {
    const numWorkers = this.numWorkers;
    for(let iWorker = 0; iWorker < numWorkers; iWorker = iWorker + 1) {
      const workerName = uuid();
      const args = [JSON.stringify({
        nodeName: this.nodeName,
        workerName,
        logLevel: this.logLevel,
        mqConfig: this.mqConfig,
        storageConfig: this.storageConfig,
      })];
      this.childrenProcesses[workerName] = childProcess.fork('./hypernode-worker', args);
    }
    return this;
  }
}

export default NodeServer;
