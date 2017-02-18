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

The Cluster is the environment in which an hypernode program runs. It comprises a collection of actual Node processes, on one or multiple machines, and an associated RabbitMQ cluster which handles all inter-process communication (see below). A cluster is comprised of a single cluster Node process (hypdernode-clusterd), a node-level Node process (hypernode-noded) on each machine, and a core-level Node process on each node (hypernode-cored), and a rabbitmq cluster.
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
