// This file is part of cget, copyright (c) 2015-2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import * as http from 'http';
import * as stream from 'stream';
import * as request from 'request';

import * as Promise from 'bluebird';

import { TaskQueue } from 'cwait';

import {
	Strategy,
	LocalFetch,
	RemoteFetch,
	FileSystemCache
} from './strategy/index';

import { repeat } from './mkdirp';
import { Address, path2url } from './Address';
import { FetchState } from './FetchState';
import { BufferStream } from './BufferStream';
import { CacheResult, CachedError } from './CacheResult';

// TODO: continue interrupted downloads.

export interface FetchOptions {
	allowLocal?: boolean;
	allowRemote?: boolean;
	allowCacheRead?: boolean;
	allowCacheWrite?: boolean;
	rewrite?: (url: string) => string;
	username?: string | null;
	password?: string | null;
	timeout?: number;
	cwd?: string;

	cacheKey?: string;

	requestConfig?: request.CoreOptions;

	retryCount?: number;
	/** Backoff time between retries, in milliseconds. */
	retryDelay?: number;
	/** Base for exponential backoff. */
	retryBackoffFactor?: number;

	/** Maximum number of redirects before throwing error. */
	redirectCount?: number;
}

export interface CacheOptions extends FetchOptions {
	indexName?: string;
	concurrency?: number;
}

export interface InternalHeaders {
	[key: string]: number | string | string[] | undefined

	'cget-stamp'?: number;
	'cget-status'?: number;
	'cget-message'?: string;
	'cget-target'?: string;
};

export interface Headers {
	[key: string]: string | string[] | undefined
};

export class Cache {

	constructor(basePath?: string, options: CacheOptions = {}) {
		const fileSystemCache = new FileSystemCache(this, basePath || 'cache', options);

		this.fetchPipeline.push(new LocalFetch(this, options));
		this.fetchPipeline.push(fileSystemCache);
		this.fetchPipeline.push(new RemoteFetch(this, options));

		this.storePipeline.push(fileSystemCache);

		this.fetchQueue = new TaskQueue(Promise, options.concurrency || 2);
		this.defaultState = new FetchState(options);
	}

	/** Fetch URL from cache or download it if not available yet.
	  * @return URL of fetched file after redirections
	  * and a readable stream of its contents. */

	fetch(uri: string, options: FetchOptions = {}) {
		return(new Promise(
			(
				opened: (result: CacheResult) => void,
				errored: (err: CachedError | NodeJS.ErrnoException) => void
			) => {
				const state = this.defaultState.clone().setOptions(options);

				state.address = new Address<InternalHeaders>(
					uri,
					path2url(state.cwd) + '/',
					options.cacheKey
				);
				state.onStream = opened;
				state.errored = errored;

				this.fetchDetect(state);
			}
		));
	}

	private fetchDetect(state: FetchState, delay = 0) {
		const pipeline = this.fetchPipeline;
		let errLatest: CachedError | NodeJS.ErrnoException;

		this.fetchQueue.add(
			() => repeat((again: {}) =>
				Promise.try(
					() => pipeline[state.strategyNum++].fetch(state)
				).catch((err: CachedError | NodeJS.ErrnoException) => {
					errLatest = err;
					return(false);
				}).then((success: boolean) => {
					if(success) return;

					if(state.strategyNum >= pipeline.length || errLatest instanceof CachedError) {
						state.errored(errLatest || new Error('Unable to handle URI ' + state.address.uri));
					} else if(state.strategyDelay) {
						this.fetchDetect(state, state.strategyDelay);
					} else {
						return(again);
					}
				})
			),
			delay
		);
	}

	/** Store custom data related to a URL-like address,
	  * for example an XML namespace.
	  * @return Promise resolving to path of cached file after all data is written. */

	store(uri: string | Address, data?: string | stream.Readable, headers?: InternalHeaders) {
		const address = uri instanceof Address ? uri : new Address(uri);
		const pipeline = this.storePipeline;
		let strategyNum = 0;

		const result = repeat((again: {}) =>
			Promise.try(
				() => pipeline[strategyNum++].store!(address, data, headers)
			).then((success: boolean) => success || again)
		);

		return(result);
	}

	/** Queue for limiting parallel downloads. */
	private fetchQueue: TaskQueue<Promise<any>>;

	fetchPipeline: Strategy[] = [];
	storePipeline: Strategy[] = [];

	private defaultState: FetchState;

}
