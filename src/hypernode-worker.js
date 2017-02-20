import WorkerServer from './WorkerServer';

import { LOGLEVEL_DEBUG } from './logLevels';

const {
  nodeName,
  workerName,
  logLevel = LOGLEVEL_DEBUG,
  mqConfig: {
    url,
    socketOptions,
  },
  storageConfig: {
    port,
    host,
    options,
  },
} = JSON.parse(process.argv[2]);

const workerServer = new WorkerServer({
  nodeName,
  workerName,
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
});

workerServer.run();
