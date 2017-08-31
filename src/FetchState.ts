import * as Promise from 'bluebird';
import * as request from 'request';

import { Cache, FetchOptions, InternalHeaders } from './Cache';
import { BufferStream } from './BufferStream';
import { CacheResult, CachedError } from './CacheResult';
import { Address } from './Address';

export function extend<Type>(dst: Type, src: { [key: string]: any }) {
	for(let key of Object.keys(src)) {
		if(src[key] !== void 0) {
			(dst as { [key: string]: any })[key] = src[key];
		}
	}

	return(dst);
}

export class FetchState implements FetchOptions {
	constructor(options: FetchOptions = {}) {
		this.setOptions(options);

		if(
			!this.retryDelay ||
			!this.retryCount ||
			this.retryDelay < 0 ||
			this.retryCount < 0
		) this.retryCount = 0;

		this.retriesRemaining = this.retryCount;
	}

	setOptions(options: FetchOptions = {}) {
		return(extend(this, options));
	}

	extendRequestConfig(config: request.CoreOptions) {
		return(extend(config, this.requestConfig || {}));
	}

	clone() {
		return(new FetchState(this));
	}

	startStream(result: CacheResult) {
		const ready = Promise.try(
			() => this.onStream(result)
		).then(
			() => { this.isStreaming = true; }
		);

		return(ready);
	}

	abort() {
		this.strategyNum = Infinity;
	}

	retryNow() {
		this.strategyNum = 0;
	}

	retryLater() {
		if(this.retriesRemaining <= 0) return;
		--this.retriesRemaining;

		this.strategyNum = 0;

		// Signal cache to delay before retrying.
		this.strategyDelay = this.retryDelay * (1 + Math.random());
		this.retryDelay *= this.retryBackoffFactor;
	}

	allowLocal = false;
	allowRemote = true;
	allowCacheRead = true;
	allowCacheWrite = true;
	rewrite?: (url: string) => string = void 0;
	username?: string = void 0;
	password?: string = void 0;
	timeout = 0;
	cwd = '.';

	requestConfig?: request.CoreOptions = void 0;

	retryCount = 0;
	retryDelay = 0;
	retryBackoffFactor = 1;
	retriesRemaining: number;

	strategyNum = 0;
	strategyDelay = 0;
	isStreaming = false;

	address: Address<InternalHeaders>;
	onKill: (err?: any) => void;
	onStream: (result: CacheResult) => void;
	errored: (err: CachedError | NodeJS.ErrnoException) => void;

	buffer?: BufferStream;

}
