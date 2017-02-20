import bluebird from 'bluebird';

class TaskQueue {
  constructor(initialState) {
    this.state = initialState;
    this.globalPromise = new Promise((resolve, reject) => {
      this.reject = reject;
    });
    this.runningPromise = null;
    this.queue = [];
  }

  getState() {
    return this.state;
  }

  catch(...args) {
    this.globalPromise.catch(...args);
    return this;
  }

  async coroutine(task) {
    return bluebird.coroutine(task, {
      yieldHandler: (yieldedValue) => this.yieldHandler(yieldedValue),
    });
  }

  yieldHandler(yieldedValue) {
    return Promise.race(yieldedValue, this.globalPromise);
  }

  exit(err) {
    if(this.queue === null) {
      return this;
    }
    this.reject(err);
    this.queue = null;
    return this;
  }

  startTask(task) {
    this.runningPromise = this.coroutine(task)(this.state)
      .catch((err) => this.exit(err))
      .then((state) => {
        this.state = state;
      })
      .then(() => this.scheduleNextTask());
    return this;
  }

  scheduleNextTask() {
    if(this.queue === null) {
      return this;
    }
    this.runningPromise = null;
    if(this.queue.length > 0) {
      const task = this.queue.shift();
      this.startTask(task);
    }
    return this;
  }

  enqueue(task) {
    if(this.queue === null) {
      return this;
    }
    this.queue.push(task);
    if(this.runningPromise === null) {
      this.scheduleNextTask();
      return this;
    }
    return this;
  }
}

export default TaskQueue;
