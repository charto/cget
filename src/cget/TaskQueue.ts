// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import {Task} from './Task'

export class TaskQueue {
	add(task: Task<any>) {
		if(this.busyCount < TaskQueue.concurrency) {
			// Start the task immediately.

			++this.busyCount;
			return(task.start(() => this.next()));
		} else {
			// Schedule the task and return a promise that will behave exactly
			// like what task.start() returns.

			this.backlog.push(task);
			return(task.delay());
		}
	}

	next() {
		var task = this.backlog.shift();

		if(task) task.resume(() => this.next());
		else --this.busyCount;
	}

	static concurrency = 2;

	backlog: Task<any>[] = [];
	busyCount = 0;
}
