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

import { fsa, mkdirp, isDir } from './mkdirp';
import { Address } from './Address';

// TODO: continue interrupted downloads.
// TODO: handle redirect loops.

export interface FetchOptions {
	allowLocal?: boolean;
	allowRemote?: boolean;
	allowCacheRead?: boolean;
	allowCacheWrite?: boolean;
	forceHost?: string;
	forcePort?: number;
	username?: string;
	password?: string;
	timeout?: number;
	cwd?: string;
}

export interface CacheOptions extends FetchOptions {
	indexName?: string;
	concurrency?: number;
}

export interface InternalHeaders {
	[key: string]: number | string | string[] | undefined

	'cget-message'?: string;
};

export interface Headers {
	[key: string]: string | string[] | undefined
};

export interface RedirectResult {
	address: Address;
	cachePath: string;
	headers: InternalHeaders;
	oldHeaders?: InternalHeaders[];
}

interface RedirectSpec {
	address: Address;
	status: number;
	message: string;
	headers: Headers;
}

const defaultHeaders = {
	'cget-status': 200,
	'cget-message': 'OK'
};

const internalHeaderTbl: { [key: string]: boolean } = {
	'cget-status': true,
	'cget-message': true,
	'cget-target': true
};

const retryCodeTbl: { [key: string]: boolean } = {};

for(
	let code of (
		'EAI_AGAIN ECONNREFUSED ECONNRESET EHOSTUNREACH' +
		' ENOTFOUND EPIPE ESOCKETTIMEDOUT ETIMEDOUT'
	).split(' ')
) {
	retryCodeTbl[code] = true;
}

function removeInternalHeaders(headers: Headers | InternalHeaders) {
	const output: Headers = {};

	for(let key of Object.keys(headers)) {
		if(!internalHeaderTbl[key]) output[key] = headers[key] as (string | string[]);
	}

	return(output);
}

/** Get path to headers for a locally cached file. */

export function getHeaderPath(cachePath: string) {
	return(cachePath + '.header.json');
}

function storeHeaders(cachePath: string, headers: Headers, extra: InternalHeaders ) {
	const output: InternalHeaders = {};

	for(let key of Object.keys(headers)) output[key] = headers[key];
	for(let key of Object.keys(extra)) output[key] = extra[key];

	return(fsa.writeFile(
		getHeaderPath(cachePath),
		JSON.stringify(extra),
		{ encoding: 'utf8' }
	));
}

export function getHeaders(cachePath: string) {
	return(
		fsa.readFile(
			getHeaderPath(cachePath),
			{ encoding: 'utf8' }
		).then(JSON.parse).catch(
			/** If headers are not found, invent some. */
			(err: NodeJS.ErrnoException) => defaultHeaders
		)
	);
}

function openLocal(
	{ address, cachePath, headers }: RedirectResult,
	opened: (result: CacheResult) => void
) {
	const streamIn = fs.createReadStream(cachePath);

	// Resolve promise with headers if stream opens successfully.
	streamIn.on('open', () => {
		opened(new CacheResult(
			streamIn,
			address,
			+(headers['cget-status'] || 200),
			'' + (headers['cget-message'] || 'OK'),
			removeInternalHeaders(headers)
		));
	});

	return(new Promise((resolve, reject) => {
		// Cached file doesn't exist or IO error.
		streamIn.on('error', reject);
		streamIn.on('end', resolve);
	}));
}

export class CacheResult {
	constructor(
		public stream: stream.Readable,
		public address: Address,
		public status: number,
		public message: string,
		public headers: Headers
	) {}
}

export class CachedError extends Error {
	constructor(
		public status: number,
		message?: string,
		headers: Headers | InternalHeaders = {}
	) {
		super(status + (message ? ' ' + message : ''));

		this.headers = removeInternalHeaders(headers);
	}

	headers: Headers;
	/** Workaround for instanceof (prototype chain is messed up after inheriting Error in ES5). */
	isCachedError = true;
}

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

export class Cache {

	constructor(basePath?: string, options: CacheOptions = {}) {
		this.basePath = path.resolve('.', basePath || 'cache');
		this.indexName = options.indexName || 'index.html';
		this.fetchQueue = new TaskQueue(Promise, options.concurrency || 2);

		this.allowLocal = options.allowLocal || false;
		this.allowRemote = options.allowRemote || options.allowRemote === void 0;
		this.allowCacheRead = options.allowCacheRead || options.allowCacheRead === void 0;
		this.allowCacheWrite = options.allowCacheWrite || options.allowCacheWrite === void 0;

		this.forceHost = options.forceHost;
		this.forcePort = options.forcePort;
		this.cwd = options.cwd || '.';
	}

	/** Store HTTP redirect headers with the final target address. */

	private addLinks(redirectList: RedirectSpec[], target: Address) {
		return(Promise.map(redirectList,
			({
				address: address,
				status: status,
				message: message,
				headers: headers
			}) => this.createCachePath(address).then((cachePath: string) =>
				storeHeaders(cachePath, headers, {
					'cget-status': status,
					'cget-message': message,
					'cget-target': target.uri
				})
			)
		));
	}

	/** Try to synchronously guess the cache path for an address.
	  * May be incorrect if it's a directory. */

	getCachePathSync(address: Address) {
		var cachePath = path.join(
			this.basePath,
			address.path
		);

		return(cachePath);
	}

	/** Get local cache file path where a remote URL should be downloaded. */

	getCachePath(address: Address) {
		var cachePath = this.getCachePathSync(address);

		var makeValidPath = (isDir: boolean) => {
			if(isDir) cachePath = path.join(cachePath, this.indexName);

			return(cachePath);
		};

		if(cachePath.charAt(cachePath.length - 1) == '/') {
			return(Promise.resolve(makeValidPath(true)));
		}

		return(isDir(cachePath).then(makeValidPath));
	}

	/** Check if there are cached headers with errors or redirecting the URL. */

	getRedirect(address: Address, oldHeaders: InternalHeaders[] = []): Promise<RedirectResult> {
		const cachePath = this.getCachePath(address);

		return(cachePath.then(getHeaders).then((headers: InternalHeaders) => {
			const status = +(headers['cget-status'] || 0);
			const target = headers['cget-target'] || headers['location'];

			if(status && status >= 300 && status <= 308 && target) {
				oldHeaders.push(headers);

				return(this.getRedirect(
					new Address(url.resolve(
						address.url!,
						'' + target
					)),
					oldHeaders
				));
			}

			if(status && status != 200 && (status < 500 || status >= 600)) {
				throw(new CachedError(status, headers['cget-message'], headers));
			}

			const result: RedirectResult = { address, cachePath: cachePath.value(), headers };

			if(oldHeaders.length) result.oldHeaders = oldHeaders;

			return(result);
		}));
	}

	/** Test if an address is cached. */

	isCached(uri: string) {
		return(this.getCachePath(new Address(uri)).then((cachePath: string) =>
			fsa.stat(
				cachePath
			).then(
				(stats: fs.Stats) => !stats.isDirectory()
			).catch(
				(err: NodeJS.ErrnoException) => false
			)
		));
	}

	/** Like getCachePath, but create its parent directory if nonexistent. */

	private createCachePath(address: Address) {
		return(this.getCachePath(address).then((cachePath: string) =>
			mkdirp(
				path.dirname(cachePath),
				this.indexName
			).then(
				() => cachePath
			)
		));
	}

	/** Store custom data related to a URL-like address,
	  * for example an XML namespace.
	  * @return Promise resolving to true after all data is written. */

	store(uri: string, data: string) {
		return(this.createCachePath(new Address(uri)).then((cachePath: string) =>
			fsa.writeFile(
				cachePath,
				data,
				{ encoding: 'utf8' }
			)
		).then(() => true));
	}

	/** Fetch URL from cache or download it if not available yet.
	 * Returns the file's URL after redirections
	 * and a readable stream of its contents. */

	fetch(uri: string, options: FetchOptions = {}) {
		const address = new Address(uri, this.cwd || options.cwd);
		const allowLocal = (options.allowLocal !== void 0) ? options.allowLocal : this.allowLocal;
		const allowRemote = (options.allowRemote !== void 0) ? options.allowRemote : this.allowRemote;
		const allowCacheRead = (options.allowCacheRead !== void 0) ? options.allowCacheRead : this.allowCacheRead;
		const allowCacheWrite = (options.allowCacheWrite !== void 0) ? options.allowCacheWrite : this.allowCacheWrite;
		let isOpened = false;
		let isErrored = false;
		let handler: (
			opened: (result: CacheResult) => void,
		) => Promise<any>;

		if(address.isLocal && allowLocal) {
			handler = (opened) => this.fetchLocal(
				address,
				options,
				opened
			);
		} else if(!address.isLocal && allowCacheRead) {
			handler = (opened) => this.fetchCached(
				address,
				options,
				opened
			).catch((err: CachedError | NodeJS.ErrnoException) => {
				// Re-throw HTTP and unexpected errors.
				if((err as CachedError).isCachedError || (err as NodeJS.ErrnoException).code != 'ENOENT' || !allowRemote) {
					throw(err);
				}

				return(this.fetchRemote(
					address,
					options,
					opened
				));
			});
		} else if(!address.isLocal && allowRemote) {
			handler = (opened) => this.fetchRemote(
				address,
				options,
				opened
			);
		} else {
			return(Promise.reject(new CachedError(403, 'Access denied to url ' + address.url)));
		}

		return(new Promise((opened, errored) =>
			this.fetchQueue.add(
				() => handler((result: CacheResult) => {
					if(!isErrored) {
						isOpened = true;
						opened(result);
					}
				}).catch((err: CachedError | NodeJS.ErrnoException) => {
					if(!isOpened) errored(err);
					isErrored = true;
				})
			)
		));
	}

	private fetchLocal(
		address: Address,
		options: FetchOptions,
		opened: (result: CacheResult) => void
	) {
		const result = {
			address,
			cachePath: address.path,
			headers: defaultHeaders
		};

		return(openLocal(result, opened));
	}

	private fetchCached(
		address: Address,
		options: FetchOptions,
		opened: (result: CacheResult) => void
	) {
		return(this.getRedirect(address).then(
			(result: RedirectResult) => openLocal(result, opened)
		));
	}

	private fetchRemote(
		address: Address,
		options: FetchOptions,
		opened: (result: CacheResult | Promise<CacheResult>) => void
	) {
		const allowCacheRead = (options.allowCacheRead !== void 0) ? options.allowCacheRead : this.allowCacheRead;
		const allowCacheWrite = (options.allowCacheWrite !== void 0) ? options.allowCacheWrite : this.allowCacheWrite;
		var urlRemote = address.url!;

		/** Flag whether deferred is resolved. */
		let isResolved = false;
		/** Flag whether a HTTP response was received. */
		let isFound = false;
		/** Flag whether stream open callback was called. */
		let isOpened = false;
		let streamRequest: request.Request;
		const streamBuffer = new stream.PassThrough();
		const redirectList: RedirectSpec[] = [];
		const deferred = new Deferred<CacheResult>();

		function die(err: NodeJS.ErrnoException | CachedError) {
			if(isResolved) return;

			// Abort and report.
			streamRequest.abort();

			// Only emit error in output stream after open callback
			// had a chance to attach an error handler.
			if(isOpened) streamBuffer.emit('error', err);

			isResolved = true;
			deferred.reject(err);
		}

		const requestConfig: request.CoreOptions = {
			encoding: null,
			gzip: true,
			followRedirect: (res: http.IncomingMessage) => {
				redirectList.push({
					address: address,
					status: res.statusCode!,
					message: res.statusMessage!,
					headers: res.headers
				});

				urlRemote = url.resolve(urlRemote, '' + res.headers.location);
				address = new Address(urlRemote);

				if(!allowCacheRead) return(true);

				this.fetchCached(address, options, opened).then((result: CacheResult) => {
					isOpened = true;

					if(isFound || isResolved) return;
					isFound = true;

					// File was already found in cache so stop downloading.
					streamRequest.abort();

					this.addLinks(redirectList, address).finally(() => {
						isResolved = true;
						deferred.resolve(result);
					});
				}).catch((err: NodeJS.ErrnoException) => {
					if(err.code != 'ENOENT' && err.code != 'ENOTDIR') {
						// Weird error! Let's try to download the remote file anyway.
					}
				});

				return(true);
			}
		};

		if(options.timeout) requestConfig.timeout = options.timeout;

		if(options.username && options.password) {
			requestConfig.auth = {
				user: options.username,
				pass: options.password,
				sendImmediately: true
			};
		}

		streamRequest = request.get(
			Cache.forceRedirect(urlRemote, options),
			requestConfig
		);

		streamRequest.on('error', (err: NodeJS.ErrnoException) => {
			// Check if retrying makes sense for this error.
			if(retryCodeTbl[err.code || '']) {
				console.error('SHOULD RETRY');
				die(err);
			} else {
				die(err);
			}
		});

		streamRequest.on('response', (res: http.IncomingMessage) => {
			if(isFound) return;
			isFound = true;

			const status = res.statusCode!;

			if(status >= 500 && status < 600) {
				// TODO
				console.error('SHOULD RETRY');
				die(new Error('RETRY'));
			} else if(status != 200) {
				var err = new CachedError(status, res.statusMessage, res.headers);

				if(allowCacheWrite) {
					this.createCachePath(address).then((cachePath: string) =>
						storeHeaders(cachePath, res.headers, {
							'cget-status': status,
							'cget-message': res.statusMessage
						})
					);
				}

				die(err);
				return;
			}

			streamRequest.pause();

			const cacheReady = ( !allowCacheWrite ? Promise.resolve(null) :
				this.createCachePath(address).then((cachePath: string) => {
					var streamOut = fs.createWriteStream(cachePath);

					streamOut.on('finish', () => {
						// Output stream file handle stays open after piping unless manually closed.
						streamOut.close();
					});

					streamRequest.pipe(streamOut, { end: true });

					return(cachePath);
				}).catch(
					// Can't write to cache for some reason. Carry on...
					(err: NodeJS.ErrnoException) => null
				)
			);

			const pipeReady = cacheReady.then((cachePath: string | null) => {
				const tasks: Promise<any>[] = [];

				streamRequest.pipe(streamBuffer, { end: true });
				streamRequest.resume();

				if(allowCacheWrite) {
					tasks.push(this.addLinks(redirectList, address));
					if(cachePath) {
						tasks.push(
							storeHeaders(cachePath, res.headers, {
								'cget-status': res.statusCode,
								'cget-message': res.statusMessage
							})
						);
					}
				}

				return(Promise.all(tasks));
			}).catch((err: NodeJS.ErrnoException) => {
				// Unable to save metadata in the cache. Carry on...
			});

			pipeReady.then(
				() => opened(new CacheResult(
					streamBuffer as any as stream.Readable,
					address,
					res.statusCode!,
					res.statusMessage!,
					res.headers
				))
			).then(
				() => isOpened = true
			);
		});

		streamRequest.on('end', () => {
			if(isResolved) return;

			isResolved = true;
			deferred.resolve();
		});

		if(options.forceHost || options.forcePort || this.forceHost || this.forcePort) {
			// Monkey-patch request to support forceHost when running tests.

			(streamRequest as any).cgetOptions = {
				forceHost: options.forceHost || this.forceHost,
				forcePort: options.forcePort || this.forcePort
			};
		}

		return(deferred.promise);
	}

	private static forceRedirect(urlRemote: string, options: FetchOptions) {
		if(!options.forceHost && !options.forcePort) return(urlRemote);

		var urlParts = url.parse(urlRemote);
		var changed = false;

		if(!urlParts.hostname) return(urlRemote);

		if(options.forceHost && urlParts.hostname != options.forceHost) {
			urlParts.hostname = options.forceHost;
			changed = true;
		}

		if(options.forcePort && urlParts.port != '' + options.forcePort) {
			urlParts.port = '' + options.forcePort;
			changed = true;
		}

		if(!changed) return(urlRemote);

		urlParts.search = '?host=' + encodeURIComponent(urlParts.host || '');
		urlParts.host = null as any;

		return(url.format(urlParts));
	}

	/** Queue for limiting parallel downloads. */
	private fetchQueue: TaskQueue<Promise<any>>;

	private basePath: string;
	private indexName: string;

	private allowLocal: boolean;
	private allowRemote: boolean;
	private allowCacheRead: boolean;
	private allowCacheWrite: boolean;
	private forceHost?: string;
	private forcePort?: number;
	private cwd: string;

	/** Monkey-patch request to support forceHost when running tests. */

	static patchRequest() {
		var proto = require('request/lib/redirect.js').Redirect.prototype;

		var func = proto.redirectTo;

		proto.redirectTo = function(this: any) {
			var urlRemote = func.apply(this, Array.prototype.slice.apply(arguments));
			var options: FetchOptions = this.request.cgetOptions;

			if(urlRemote && options) return(Cache.forceRedirect(urlRemote, options));

			return(urlRemote);
		};
	}

}
