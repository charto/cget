import * as request from 'request';

import { FetchOptions, CachedError } from './Cache';
import { BufferStream } from './BufferStream';
import { CacheResult } from './CacheResult';
import { Address } from './Address';

function extend<Type>(dst: Type, src: { [key: string]: any }) {
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

	address: Address;
	opened: (result: CacheResult) => void;
	errored: (err: CachedError | NodeJS.ErrnoException) => void;

	streamBuffer?: BufferStream;

}
