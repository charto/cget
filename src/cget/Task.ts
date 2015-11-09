// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as Promise from 'bluebird';

export class Task<ResultType> {
	constructor(func?: () => Promise<ResultType>) {
		this.func = func;
	}

	start(onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		return(this.func().finally(onFinish));
	}

	delay() {
		return(new Promise((resolve: (result: ResultType) => void, reject: (err: any) => void) => {
			this.resolve = resolve;
			this.reject = reject;
		}));
	}

	resume(onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		return(this.start(onFinish).then(this.resolve).catch(this.reject));
	}

	func: () => Promise<ResultType>;

	resolve: (result: ResultType) => void;
	reject: (err: any) => void;
}
