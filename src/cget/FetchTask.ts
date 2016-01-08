// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import {Address} from './Address';
import {Cache, CacheResult} from './Cache';
import {Task} from './Task';

export interface FetchOptions {
	address?: Address;
	forceHost?: string;
	forcePort?: number;
}

export class FetchTask extends Task<CacheResult> {
	constructor(cache: Cache, options: FetchOptions) {
		super();

		this.cache = cache;
		this.options = options;
	}

	start(onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		var result = this.cache.fetchCached(this.options, onFinish).catch((err: NodeJS.ErrnoException) => {
			// Re-throw unexpected errors.
			if(err.code != 'ENOENT') {
				onFinish(err);
				throw(err);
			}

			if(this.options.address.url) {
				return(this.cache.fetchRemote(this.options, onFinish));
			} else {
				onFinish(err);
				throw(err);
			}
		});

		return(result);
	}

	cache: Cache;
	options: FetchOptions;
}
