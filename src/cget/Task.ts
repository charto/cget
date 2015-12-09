// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as Promise from 'bluebird';

/** Task wraps a promise, delaying it until some resource gets less busy. */

export class Task<ResultType> {
	constructor(func?: () => Promise<ResultType>) {
		this.func = func;
	}

	/** Start the task immediately and call onFinish callback when done. */

	start(onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		return(this.func().finally(onFinish));
	}

	/** Wrap task result in a new promise so it can be resolved later. */

	delay() {
		return(new Promise((resolve: (result: ResultType) => void, reject: (err: any) => void) => {
			this.resolve = resolve;
			this.reject = reject;
		}));
	}

	/** Resolve the result of a delayed task and call onFinish when done. */

	resume(onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		return(this.start(onFinish).then(this.resolve).catch(this.reject));
	}

	func: () => Promise<ResultType>;

	resolve: (result: ResultType) => void;
	reject: (err: any) => void;
}
