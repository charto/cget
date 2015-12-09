// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import {Task} from './Task'

export class TaskQueue {
	/** Add a new task to the queue.
	  * It will start when the number of other concurrent tasks is low enough. */

	add(task: Task<any>) {
		if(this.busyCount < TaskQueue.concurrency) {
			// Start the task immediately.

			++this.busyCount;
			return(task.start(() => this.next()));
		} else {
			// Schedule the task and return a promise resolving
			// to the result of task.start().

			this.backlog.push(task);
			return(task.delay());
		}
	}

	/** Start the next task from the backlog. */

	private next() {
		var task = this.backlog.shift();

		if(task) task.resume(() => this.next());
		else --this.busyCount;
	}

	static concurrency = 2;

	backlog: Task<any>[] = [];
	busyCount = 0;
}
