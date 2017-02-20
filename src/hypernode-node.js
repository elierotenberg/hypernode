import os from 'os';
import NodeServer from './NodeServer';

const {
  nodeName,
  numWorkers = os.cpus().length,
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
} = JSON.parse(process.argv[2]);

const nodeServer = new NodeServer({
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
});

nodeServer.run();
