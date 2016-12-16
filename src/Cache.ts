// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';

import * as url from 'url';
import * as http from 'http';
import * as stream from 'stream';
import * as request from 'request';
import * as Promise from 'bluebird';

import {TaskQueue} from 'cwait';

import {fsa, mkdirp, isDir} from './mkdirp';
import {Address} from './Address';

// TODO: continue interrupted downloads.
// TODO: handle redirect loops.

export interface FetchOptions {
	allowLocal?: boolean;
	forceHost?: string;
	forcePort?: number;
	cwd?: string;
}

export interface CacheOptions extends FetchOptions {
	indexName?: string;
	concurrency?: number;
}

export type InternalHeaders = { [key: string]: number | string };
export type Headers = { [key: string]: string };

export class CacheResult {
	constructor(streamOut: stream.Readable, address: Address, status: number, headers: Headers) {
		this.stream = streamOut;
		this.address = address;
		this.headers = headers;
		this.status = status;
	}

	stream: stream.Readable;
	address: Address;
	status: number;
	headers: Headers;
}

export class Cache {

	constructor(basePath: string, options?: CacheOptions) {
		if(!options) options = {};

		this.basePath = path.resolve(basePath || 'cache');
		this.indexName = options.indexName || 'index.html';
		this.fetchQueue = new TaskQueue(Promise, options.concurrency || 2);

		this.allowLocal = options.allowLocal || false;
		this.forceHost = options.forceHost;
		this.forcePort = options.forcePort;
		this.cwd = options.cwd || '.';
	}

	/** Store HTTP redirect headers with the final target address. */

	addLinks(redirectList: { address: Address, status: number, headers: Headers }[], target: Address) {
		return(Promise.map(redirectList, ({ address: address, status: status, headers: headers }) => {
			this.createCachePath(address).then((cachePath: string) =>
				this.storeHeaders(cachePath, headers, {
					'cget-status': status,
					'cget-target': target.uri
				})
			)
		}));
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

	/** Get path to headers for a locally cached file. */

	static getHeaderPath(cachePath: string) {
		return(cachePath + '.header.json');
	}

	/** Test if an address is cached. */

	isCached(uri: string) {
		return(this.getCachePath(new Address(uri)).then((cachePath: string) =>
			fsa.stat(cachePath)
				.then((stats: fs.Stats) => !stats.isDirectory())
				.catch((err: NodeJS.ErrnoException) => false)
		));
	}

	/** Like getCachePath, but create its parent directory if nonexistent. */

	createCachePath(address: Address) {
		return(this.getCachePath(address).then((cachePath: string) =>
			mkdirp(path.dirname(cachePath), this.indexName).then(() => cachePath)
		));
	}

	/** Check if there are cached headers that redirect the URL. */

	static getRedirect(cachePath: string) {
		return(
			fsa.readFile(
				Cache.getHeaderPath(cachePath),
				{ encoding: 'utf8' }
			).then((data: string) => {
				// Parse headers stored as JSON.
				const headers = JSON.parse(data);
				const status = headers['cget-status'];

				if(status >= 300 && status <= 308 && headers.location) {
					return(headers['cget-target'] || headers.location);
				}

				return(null);
			}).catch(() => null as any as {})
		);
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

	fetch(uri: string, options?: FetchOptions) {
		if(!options) options = {};

		const address = new Address(uri, this.cwd || options.cwd);

		if(address.isLocal) {
			if(!(options.allowLocal || (options.allowLocal !== false && this.allowLocal))) {
				return(Promise.reject(new Error('Access denied to url ' + address.url)));
			}

			return(new Promise((resolve, reject) =>
				this.fetchQueue.add(() => new Promise((resolveTask, rejectTask) =>
					this.fetchLocal(
						address,
						options!,
						resolveTask,
						rejectTask
					).then(resolve, reject)
				))
			));
		}

		return(new Promise((resolve, reject) =>
			this.fetchQueue.add(() => new Promise((resolveTask, rejectTask) =>
				this.fetchCached(
					address,
					options!,
					resolveTask
				).catch((err: NodeJS.ErrnoException) => {
					// Re-throw unexpected errors.
					if(err.code != 'ENOENT') {
						rejectTask(err);
						throw(err);
					}

					if(address.url && !address.isLocal) {
						return(this.fetchRemote(address, options!, resolveTask, rejectTask));
					} else {
						rejectTask(err);
						throw(err);
					}
				}).then(resolve, reject)
			))
		));
	}

	fetchLocal(
		address: Address,
		options: FetchOptions,
		resolveTask: () => void,
		rejectTask: (err?: NodeJS.ErrnoException) => void
	) {
		var streamIn = fs.createReadStream(address.path);

		return(
			new Promise((resolve, reject) => {
				// Resolve promise with headers if stream opens successfully.
				streamIn.on('open', () => resolve({
					'cget-status': 200
				}));

				// Cached file doesn't exist or IO error.
				streamIn.on('error', (err: NodeJS.ErrnoException) => {
					reject(err);
					rejectTask(err);
					throw(err);
				});

				streamIn.on('end', resolveTask);
			}).then((headers: InternalHeaders) => new CacheResult(
				streamIn,
				address,
				headers['cget-status'] as number,
				Cache.removeInternalHeaders(headers)
			))
		);
	}

	fetchCached(address: Address, options: FetchOptions, resolveTask: () => void) {
		var streamIn: fs.ReadStream;

		// Any errors shouldn't be handled here, but instead in the caller.

		return(
			this.getCachePath(address).then((cachePath: string) =>
				Cache.getRedirect(cachePath).then((urlRemote: string) =>
					urlRemote ? this.getCachePath(new Address(urlRemote)) : cachePath
				)
			).then((cachePath: string) => new Promise((resolve, reject) => {
				streamIn = fs.createReadStream(cachePath);

				// Resolve promise with headers if stream opens successfully.
				streamIn.on('open', () => resolve(
					fsa.readFile(
						Cache.getHeaderPath(cachePath),
						{ encoding: 'utf8' }
					).then(
						/** Parse headers stored as JSON. */
						(data: string) => JSON.parse(data)
					).catch(
						/** If headers are not found, invent some. */
						(err: NodeJS.ErrnoException) => ({ 'cget-status': 200 })
					)
				));

				// Cached file doesn't exist.
				streamIn.on('error', reject);

				streamIn.on('end', resolveTask);
			})).then((headers: InternalHeaders) => new CacheResult(
				streamIn,
				address,
				headers['cget-status'] as number,
				Cache.removeInternalHeaders(headers)
			))
		);
	}

	private storeHeaders(cachePath: string, headers: Headers, extra: InternalHeaders ) {
		for(let key of Object.keys(headers)) {
			if(!extra.hasOwnProperty(key)) extra[key] = headers[key]
		}

		return(fsa.writeFile(
			Cache.getHeaderPath(cachePath),
			JSON.stringify(extra),
			{ encoding: 'utf8' }
		));
	}

	fetchRemote(address: Address, options: FetchOptions, resolveTask: () => void, rejectTask: (err?: NodeJS.ErrnoException) => void) {
		var urlRemote = address.url!;

		var redirectList: { address: Address, status: number, headers: Headers }[] = [];
		var found = false;
		var resolve: (result: any) => void;
		var reject: (err: any) => void;
		var promise = new Promise<CacheResult>((res, rej) => {
			resolve = res;
			reject = rej;
		})

		function die(err: NodeJS.ErrnoException) {
			// Abort and report.
			if(streamRequest) streamRequest.abort();

			console.error('Got error:');
			console.error(err);
			console.error('Downloading URL:');
			console.error(urlRemote);

			reject(err);
			rejectTask(err);
			throw(err);
		}

		var streamBuffer = new stream.PassThrough();

		var streamRequest = request.get({
			url: Cache.forceRedirect(urlRemote, options),
			encoding: null,
			followRedirect: (res: http.IncomingMessage) => {
				redirectList.push({
					address: address,
					status: res.statusCode!,
					headers: res.headers
				});

				urlRemote = url.resolve(urlRemote, res.headers.location);
				address = new Address(urlRemote);

				this.fetchCached(address, options, resolveTask).then((result: CacheResult) => {
					// File was already found in cache so stop downloading.

					streamRequest.abort();

					if(found) return;
					found = true;

					this.addLinks(redirectList, address).finally(() => {
						resolve(result);
					});
				}).catch((err: NodeJS.ErrnoException) => {
					if(err.code != 'ENOENT' && err.code != 'ENOTDIR') {
						// Weird!
						die(err);
					}
				});

				return(true);
			}
		});

		streamRequest.on('error', (err: NodeJS.ErrnoException) => {
			// Check if retrying makes sense for this error.
			if((
				'EAI_AGAIN ECONNREFUSED ECONNRESET EHOSTUNREACH ' +
				'ENOTFOUND EPIPE ESOCKETTIMEDOUT ETIMEDOUT '
			).indexOf(err.code || '') < 0) {
				die(err);
			}

			console.error('SHOULD RETRY');

			throw(err);
		});

		streamRequest.on('response', (res: http.IncomingMessage) => {
			if(found) return;
			found = true;

			const code = res.statusCode;

			if(code != 200) {
				if(code < 500 || code >= 600) {
					var err = new Error(code + ' ' + res.statusMessage);

					// TODO: Cache the HTTP error.

					die(err);
				}

				console.error('SHOULD RETRY');

				throw(new Error('RETRY'));
			}

			streamRequest.pause();

			this.createCachePath(address).then((cachePath: string) => {
				var streamOut = fs.createWriteStream(cachePath);

				streamOut.on('finish', () => {
					// Output stream file handle stays open after piping unless manually closed.

					streamOut.close();
				});

				streamRequest.pipe(streamOut, {end: true});
				streamRequest.pipe(streamBuffer, {end: true});
				streamRequest.resume();

				return(
					Promise.join(
						this.addLinks(redirectList, address),
						this.storeHeaders(cachePath, res.headers, {
							'cget-status': res.statusCode!
						})
					).finally(
						() => resolve(new CacheResult(
							streamBuffer as any as stream.Readable,
							address,
							res.statusCode!,
							res.headers
						))
					)
				);
			}).catch(die);
		});

		streamRequest.on('end', resolveTask);

		if(options.forceHost || options.forcePort || this.forceHost || this.forcePort) {
			// Monkey-patch request to support forceHost when running tests.

			(streamRequest as any).cgetOptions = {
				forceHost: options.forceHost || this.forceHost,
				forcePort: options.forcePort || this.forcePort
			};
		}

		return(promise);
	}

	static removeInternalHeaders(headers: InternalHeaders) {
		const output: Headers = {};

		for(let key of Object.keys(headers)) {
			if(key != 'cget-status' && key != 'cget-target') output[key] = headers[key] as string;
		}

		return(output);
	}

	static forceRedirect(urlRemote: string, options: FetchOptions) {
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
	fetchQueue: TaskQueue<Promise<any>>;

	basePath: string;
	indexName: string;

	allowLocal: boolean;
	forceHost?: string;
	forcePort?: number;
	cwd: string;

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
