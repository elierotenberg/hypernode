hypernode
=========

hypernode is an environment to write and run programs written in JavaScript that are massively scalable, inspired by the Erlang/OTP concepts and powered by Node and RabbitMQ.

Several problems are hard to overcome when attempting to write, run and scale large applications written in Node. The core scaling abstraction in Node is its event loop: "slow" (often improperly named "blocking") operations are deferred out of the JS runtime and passed back to the JS runtime through the Node event loop and the results are passed to previously bound callbacks.
This method is very effective to scale at the single-process level, allowing many concurrent operations to be run by a single node process. However, since registering a callback to the event loop is a global side-effect, operationals errors can corrupt the state of a process and event crash it. You then have to restard the whole process and the OS-level (restart node), so recovering from failures is very hard and costly in Node.

Useful concepts, such as monitors and supervisors, are very hard to implement in Node since there is no efficient concept of isolated process or error stack.

Besides, scaling beyond a single process is very tedious in Node. It is possible, using the vanilla `cluster` API, or more advanced tools like `pm2`. So now you have a completely different concept and environment and tools to scale operations on multiple processes (and thus, OS-level cores).

And scaling to multiple machines requires even another abstraction layer, and to be efficient, requires out-of-band communication and synchronization tools, like RabbitMQ or redis.

So you have 3 levels of scaling abstraction with different communication/monitoring abstractions and mechanisms :
- process-level: the event-loop and its associated APIs (EventEmitter, callbacks, Promise, generators, async/await etc, which are basically syntactic sugar for the same thing)
- machine-level: node `cluster` or more advanced tools like `pm2`
- cluster-level: adhoc setups usually involving out-of-band tools like a load-balancer (eg. HAProxy), a message queue (eg. RabbitMQ), and a shared storage (eg. redis)

The situation quickly gets very hard, and requires the architects, the developpers, the devops, and the sysadmin, to have complete knowledge of the entire system at the entire time.

hypernode attempts to reuse the excellent ideas behind Erlang/OTP (and to leverage them indirectly using RabbitMQ) to address this array of issues. Through an opinionated array of concepts, hypernode unifies the different communication abstractions, so that the developpers can focus on the logic, and delegate the cluster administration to a SaaS or self-hosted platform.


### Concepts

- Cluster

The Cluster is the environment in which an hypernode program runs. It comprises a collection of actual Node processes, on one or multiple machines, and an associated RabbitMQ cluster which handles all inter-process communication (see below). A cluster is comprised of a single cluster Node process (`hypdernode-cluster`), a node-level Node process (`hypernode-node`) on each machine, and one or more core-level Node processes on each node (`hypernode-worker`), a backing rabbitmq cluster, and a backing redis server or cluster. You can interact with the cluster at runtime using the CLI tool `hypernode-cli`, to dynamically add or remove nodes/workers from the cluster, load or reload modules, spawn new processes, monitor what's going on, etc.
When initially started, a Cluster only runs a resident, bootstrapping process (called the root process). Processes can be spawned inside a Cluster, where it will be handled and monitored by the root process or its descendants, using a CLI client.
Node processes or machines can be added to or removed from the cluster at runtime.
Modules (units of code) can be loaded or reloaded (hot-updated) at runtime.

- Process

The core unit of running code in hypernode is called a process, much like Erlang/OTP processses. A process has a parent (the process which spawned it), zero, one or multiple child processes, and a message inbox. The Cluster scheduler (delegated to the RabbitMQ scheduler) makes sure that when another process sends a message to this process inbox, it will eventually have the opportunity to process this message and perform operations (such as performing calculations, and sending messages to other processes).
Within a process, all operations are synchronous. The single asynchronous abstraction is message passing: message are delivered and performed asynchronously, and processes are otherwise isolated. Processes do not share mutable state, and a failure inside a process don't have any direct side-effect on other processses. When a process crashes (for any reason), a message is sent to its parent, which can chose what to do with this information (ignore it, restart the process, etc.).

Where processses are actually run is opaque to the programmer. The Cluster scheduler decides on which actual Node process on which actual machine the process will run, and can decide to relocate a process for scheduling, load-balancing or resource-balancing reasons. No guarantees are given to the programmer that a child process will actually run in the same Node process or not.

- Module

A module is a set of related functions that can be used to spawn a process. A module has a global name (in the Cluster-level module namespace), and when a process is spawned, it is defined by its module name and an initial state (passed to the module constructor, along with a reference to its inbox and parent process).
A module can be dynamically loaded (and reloaded, for code updates) into a running Cluster, making its constructor available to other processes.

- Message

The only form of communication available between processes are messages. Message are pieces of immutable data (like strings or numbers, or serialized objects), which are asynchronously delivered from a given process to another process. The environment provides several guarantees about messages:
- a message will eventually be delivered to its target process, unless the target process crashes
- messages from a given process to a target process are guaranteed to be delivered in ordrer (but there is no guarantee that messages from multiple processes to the same target process will arrive in ordrer, or that messages from the same process to multiple target processes will arrive in ordrer).

Within a cluster, the processes form a tree. The root of the tree is the root process and instantiates the Root module.

### Process definition API

The API of hypernode at the programmer-level is declarative and reactive. You define Modules by declaring custom Process classes by implementing the Process lifecycle functions.

The core lifecycle functions are:

- `*processDidReceiveMessage(state, message, processName, context): nextState`:
Define what a process instanciated by this module should do when it receives a message. `state` is the current state of the process, `message` is the message received by the process, `processName` is the name of the sender process (which may or not be still alive upon receiving the message), and `context` is the process context (seen below).
hypernode guarantees that only one message at a time will be handled by a given process - it won't call `processDidReceiveMessage` until it terminates.
Note that `processDidReceiveMessage` is a generator function, which will be run wrapped inside `bluebird.coroutine`, so you can `yield` promises to wait for asynchronous operations to end (much like `async/wait`). From the point of view of the process, this will block and allow synchronous treatment, but of course the actual underlying OS-level process won't block - other processes can still perform their work while one or multiple other processes are blocked `yield`-ing.

This function acts as a state reducer: it must return the new state (which can be the same), so that next calls to lifecycle functions see the properly updated state.

- `*processWillRun(state, context)`:
Define what a process instanciated by this module should do just before starting to listen for incoming messages. This gives an opportunity to do complex and/or asynchronous state initialisation, such as binding a server or spawning helper children processes.

This function acts as a state reducer: it must return the new state (which can be the same), so that next calls to lifecycle functions see the properly updated state.

- `*processWillExit(state, err, context)`:
Define what a process instanciated by this module should do just before exiting. Exiting at this point can not be prevented, but this gives an opportunity to perform resource clean-up, such as closing open connections, files, etc.

The return value of this function is ignored.

Each lifecycle function has a parameter named `context`, an object which represents the special capabilities of the process:

- `context.send(processName, message)`: sends a message to the given process (if it exists). `message` should be serializable (JSON-stringifiable).
- `context.spawn(moduleName, initialState): processName`: spawn a new child process using the given module. `initialState` should be serializable (JSON-stringifiable). `spawn` returns the name (guaranteed to be unique cluster-wide) of the created process, so a reference can be saved in the process `state` to send messages to it later.
- `context.exit(err)`: shuts down this process with the given reason/error. All children processes (and their descendants) will automatically exit, and the parent process will be notified (by a message of type `CHILD_PROCESS_EXIT`).

- `context.getState()`: returns the current state of this process; should be considered read-only
- `context.getProcessName()`: returns the name of this process.
- `context.getParentProcessName()`: returns the name of the parent process of this process.
- `context.getChildrenProcessNames()`: returns an object keyed by the names of the children processes of this process.

The following example defines a trivial http server which spawns one child process to handle each incoming request.

```js
/** @hypernode-module HttpServer **/

import http from 'http';

import { Process } from 'hypernode';

export default class HttpServer extends Process {
  *processWillRun(state, { spawn }) {
    state.pendingRequests = Object.create(null);
    state.server = http.createServer((req, res) => {
      const processName = spawn('HttpServerRequestHandler', { req });
      state.pendingRequests[processName] = res;
    }).listen(state.port);
    return state;
  }

  *processDidReceiveMessage(state, { type, payload }, processName, { send }) {
    if(type === 'CHILD_PROCESS_EXIT') {
      const { err } = payload;
      if(state.pendingRequests[processName]) {
        state.pendingRequests[processName].end(err.toString());
        delete state.pendingRequests[processName];
      }
    }
    if(type === 'HTTP_RESPONSE') {
      const { response } = payload;
      state.pendingRequests[processName].end(response);
      delete state.pendingRequests[processName];
      send(processName, { type: 'PROCESS_EXIT', payload: { err: 'Response sent' } });
    }
    return state;
  }

  *processWillExit(state) {
    state.server.close();
  }
}
```

```js
/** @hypernode-module HttpServerRequestHandler **/

import { Process } from 'hypernode';

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
```

### Prototype caveats

This prototype/proof of concept is intentionally simplistic and isn't fitted for production.

All message are serialized (JSON-stringified) everytime which is terribly inefficient. (fix: perform structural sharing and process affinity for shared data-structures)

The internal Node processes (ClusterServer, NodeServer and WorkerServer) don't have autorestart/dramatic failure recovery mechanisms. (fix: carefully handle failures and recovery using RabbitMQ atomic mechanisms)

The scheduler is a dumb round-robin scheduler and doesn't take load into account at all. (fix: take load and affinity into account in the scheduler using RabbitMQ scheduling mechanisms)

All these issues can be addressed in a further version designed for production (with few to no API changes), if the proof of concept is pleasing to work with.
