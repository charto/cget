// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';

import * as url from 'url';
import * as http from 'http';
import * as stream from 'stream';
import * as request from 'request';
import * as Promise from 'bluebird';

import {fsa, repeat, mkdirp, isDir, sanitizePath, sanitizeUrl} from './util'
import {TaskQueue} from './TaskQueue'
import {Task} from './Task'

// TODO: continue interrupted downloads.

Promise.longStackTraces();

export interface FetchOptions {
	url?: string;
	forceHost?: string;
	forcePort?: number;
}

export class CacheResult {
	constructor(streamOut: stream.Readable, urlRemote: string) {
		this.stream = streamOut;
		this.url = urlRemote;
	}

	stream: stream.Readable;
	url: string;
}

class FetchTask extends Task<CacheResult> {
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

			return(this.cache.fetchRemote(this.options, onFinish));
		});

		return(result);
	}

	cache: Cache;
	options: FetchOptions;
}

export class Cache {

	constructor(pathBase: string, indexName: string) {
		this.pathBase = path.resolve(pathBase);
		this.indexName = indexName;
	}

	// Store HTTP redirects as files containing the new URL.

	addLinks(redirectList: string[], target: string) {
		return(Promise.map(redirectList, (src: string) => {
			this.createCachePath(src).then((cachePath: string) =>
				fsa.writeFile(cachePath, 'LINK: ' + target + '\n', {encoding: 'utf-8'})
			)
		}));
	}

	// Get local cache file path where a remote URL should be downloaded.

	getCachePath(urlRemote: string) {
		var cachePath = path.join(
			this.pathBase,
			sanitizePath(urlRemote.substr(urlRemote.indexOf(':') + 1))
		);

		var makeValidPath = (isDir: boolean) => {
			if(isDir) cachePath = path.join(cachePath, this.indexName);

			return(cachePath);
		};

		if(urlRemote.charAt(urlRemote.length - 1) == '/') {
			return(Promise.resolve(makeValidPath(true)));
		}

		return(isDir(urlRemote).then(makeValidPath));
	}

	// Like getCachePath, but create the path if is doesn't exist.

	createCachePath(urlRemote: string) {
		return(this.getCachePath(urlRemote).then((cachePath: string) => {
			return(mkdirp(path.dirname(cachePath)).then(() => cachePath));
		}));
	}

	// Check if there's a cached link redirecting the URL.

	static checkRemoteLink(cachePath: string) {
		return(fsa.open(cachePath, 'r').then((fd: number) => {
			var buf = new Buffer(6);

			return(fsa.read(fd, buf, 0, 6, 0).then(() => {
				fsa.close(fd);

				if(buf.equals(new Buffer('LINK: ', 'ascii'))) {
					return(fsa.readFile(cachePath, {encoding: 'utf-8'}).then((link: string) => {
						var urlRemote = link.substr(6).replace(/\s+$/, '');

						return(urlRemote);
					}));
				} else return(null);
			}));
		}));
	}

	// Fetch URL from cache or download it if not available yet.
	// Returns the file's URL after redirections and a readable stream of its contents.

	fetch(options: FetchOptions) {
		return(this.fetchQueue.add(new FetchTask(this, {
			url: sanitizeUrl(options.url),
			forceHost: options.forceHost,
			forcePort: options.forcePort
		})));
	}

	fetchCached(options: FetchOptions, onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		var urlRemote = options.url;
		console.log('BEGIN CACHED ' + urlRemote);

		// Any errors shouldn't be handled here, but instead in the caller.

		var cachePath = this.getCachePath(urlRemote);
		var targetPath = cachePath.then(Cache.checkRemoteLink).then((urlRemote: string) => {
			if(urlRemote) return(this.getCachePath(urlRemote));
			else return(cachePath);
		});

		return(targetPath.then((targetPath: string) => {
			var streamIn = fs.createReadStream(targetPath, {encoding: 'utf-8'});

			streamIn.on('end', () => {
				console.log('FINISH CACHED ' + urlRemote);
				onFinish();
			});

			return(new CacheResult(
				streamIn,
				urlRemote
			));
		}));
	}

	fetchRemote(options: FetchOptions, onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		var urlRemote = options.url;
		console.log('BEGIN REMOTE ' + urlRemote);

		var redirectList: string[] = [];
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
			onFinish(err);
			throw(err);
		}

		var streamBuffer = new stream.PassThrough();

		var streamRequest = request.get({
			url: Cache.forceRedirect(urlRemote, options),
			followRedirect: (res: http.IncomingMessage) => {
				redirectList.push(urlRemote);
				urlRemote = url.resolve(urlRemote, res.headers.location);

				this.fetchCached({
					url: urlRemote,
					forceHost: options.forceHost,
					forcePort: options.forcePort
				}, onFinish).then((result: CacheResult) => {
					// File was already found in cache so stop downloading.

					streamRequest.abort();

					if(found) return;
					found = true;

					this.addLinks(redirectList, urlRemote).finally(() => {
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
			).indexOf(err.code) < 0) {
				die(err);
			}

			console.error('SHOULD RETRY');

			throw(err);
		});

		streamRequest.on('response', (res: http.IncomingMessage) => {
			if(found) return;
			found = true;

			var code = res.statusCode;

			if(code != 200) {
				if(code < 500 || code >= 600) {
					var err = new Error(code + ' ' + res.statusMessage);

					// TODO: Cache the HTTP error.

					die(err);
				}

				console.error('SHOULD RETRY');

				throw(err);
			}

			streamRequest.pipe(streamBuffer);

			this.createCachePath(urlRemote).then((cachePath: string) => {
				var streamOut = fs.createWriteStream(cachePath);

				streamOut.on('finish', () => {
					// Output stream file handle stays open after piping unless manually closed.

					streamOut.close();
				});

				streamBuffer.pipe(streamOut);

				return(this.addLinks(redirectList, urlRemote).finally(() => {
					resolve(new CacheResult(
						streamBuffer as any as stream.Readable,
						urlRemote
					));
				}));
			}).catch(die);
		});

		streamRequest.on('end', () => {
			console.log('FINISH REMOTE ' + urlRemote);
			onFinish();
		});

		if(options.forceHost || options.forcePort) {
			// Monkey-patch request to support forceHost when running tests.

			(streamRequest as any).chartoOptions = options;
		}

		return(promise);
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

		urlParts.search = '?host=' + encodeURIComponent(urlParts.host);
		urlParts.host = null;

		return(url.format(urlParts));
	}

	fetchQueue = new TaskQueue();

	pathBase: string;
	indexName: string;

	// Monkey-patch request to support forceHost when running tests.

	static patchRequest() {
		var proto = require('request/lib/redirect.js').Redirect.prototype;

		var func = proto.redirectTo;

		proto.redirectTo = function() {
			var urlRemote = func.apply(this, Array.prototype.slice.apply(arguments));
			var options: FetchOptions = this.request.chartoOptions;

			if(urlRemote && options) return(Cache.forceRedirect(urlRemote, options));

			return(urlRemote);
		};
	}

}
