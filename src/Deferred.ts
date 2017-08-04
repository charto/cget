import * as Promise from 'bluebird';

export class Deferred<Type> {
	constructor() {
		this.promise = new Promise<Type>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}

	promise: Promise<Type>;
	resolve: (result?: Type | Promise<Type>) => void;
	reject: (err?: any) => void;
}
