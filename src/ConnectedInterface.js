import amqp from 'amqplib';
import bluebird from 'bluebird';
import redis from 'redis';
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

class ConnectedInterface {
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
    this.mqConfig = {
      url,
      socketOptions,
    };
    this.storageConfig = {
      port,
      host,
      options,
    };
  }

  async connect() {
    await Promise.all([this.connectStorage(), this.connectMq()]);
    return this;
  }

  async disconnect() {
    await Promise.all([this.disconnectStorage(), this.disconnectMq()]);
  }

  async connectStorage() {
    const { port, host, options } = this.storageConfig;
    this.storage = redis.createClient(port, host, options);
    return this;
  }

  async disconnectStorage() {
    return this.storage.quit();
  }

  async connectMq() {
    const conn = this.mqConn = await amqp.connect(this.mqConfig.url, this.mqConfig.socketOptions);
    this.mq = await conn.createChannel();
    return this;
  }

  async disconnectMq() {
    return await this.mqConn.close();
  }
}

export default ConnectedInterface;
