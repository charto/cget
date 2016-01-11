// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';

import * as url from 'url';
import * as http from 'http';
import * as stream from 'stream';
import * as request from 'request';
import * as Promise from 'bluebird';

import {fsa, repeat, mkdirp, isDir, sanitizePath} from './util';
import {Address} from './Address';
import {TaskQueue} from './TaskQueue';
import {FetchTask, FetchOptions} from './FetchTask';

// TODO: continue interrupted downloads.

Promise.longStackTraces();

export class CacheResult {
	constructor(streamOut: stream.Readable, address: Address) {
		this.stream = streamOut;
		this.address = address;
	}

	stream: stream.Readable;
	address: Address;
}

export class Cache {

	constructor(pathBase: string, indexName: string) {
		this.pathBase = path.resolve(pathBase);
		this.indexName = indexName;
	}

	// Store HTTP redirects as files containing the new URL.

	addLinks(redirectList: Address[], target: Address) {
		return(Promise.map(redirectList, (src: Address) => {
			this.createCachePath(src).then((cachePath: string) =>
				fsa.writeFile(
					cachePath,
					'LINK: ' + target.uri + '\n',
					{ encoding: 'utf8' }
				)
			)
		}));
	}

	getCachePathSync(address: Address) {
		var cachePath = path.join(
			this.pathBase,
			address.path
		);

		return(cachePath);
	}

	// Get local cache file path where a remote URL should be downloaded.

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

	ifCached(uri: string) {
		return(this.getCachePath(new Address(uri)).then((cachePath: string) =>
			fsa.stat(cachePath)
				.then((stats: fs.Stats) => !stats.isDirectory())
				.catch((err: NodeJS.ErrnoException) => false)
		));
	}

	// Like getCachePath, but create the path if is doesn't exist.

	createCachePath(address: Address) {
		return(this.getCachePath(address).then((cachePath: string) =>
			mkdirp(path.dirname(cachePath), this.indexName).then(() => cachePath)
		));
	}

	// Check if there's a cached link redirecting the URL.

	static checkRemoteLink(cachePath: string) {
		var buf = new Buffer(6);

		return(fsa.open(cachePath, 'r').then((fd: number) =>
			fsa.read(fd, buf, 0, 6, 0).then(() => {
				fsa.close(fd);

				if(buf.equals(new Buffer('LINK: ', 'ascii'))) {
					return(fsa.readFile(cachePath, { encoding: 'utf8'} ).then((link: string) =>
						link.substr(6).replace(/\s+$/, '')
					));
				} else return(null);
			})
		));
	}

	/** Store custom data related to a URL-like address,
	  * for example an XML namespace.
		* @return Promise resolving after all data is written. */

	store(uri: string, data: string) {
		return(this.createCachePath(new Address(uri)).then((cachePath: string) =>
			fsa.writeFile(
				cachePath,
				data,
				{ encoding: 'utf8' }
			)
		));
	}

	/** Fetch URL from cache or download it if not available yet.
	 * Returns the file's URL after redirections
	 * and a readable stream of its contents. */

	fetch(options: FetchOptions) {
		return(this.fetchQueue.add(new FetchTask(this, {
			address: options.address,
			forceHost: options.forceHost,
			forcePort: options.forcePort
		})));
	}

	fetchCached(options: FetchOptions, onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))

		// Any errors shouldn't be handled here, but instead in the caller.

		var cachePath = this.getCachePath(options.address);
		var targetPath = cachePath.then(Cache.checkRemoteLink).then((urlRemote: string) =>
			urlRemote ? this.getCachePath(new Address(urlRemote)) : cachePath
		);

		return(targetPath.then((targetPath: string) => {
			var streamIn = fs.createReadStream(targetPath, { encoding: 'utf8'} );

			streamIn.on('end', () => {
				onFinish();
			});

			return(new CacheResult(
				streamIn,
				options.address
			));
		}));
	}

	private storeHeaders(cachePath: string, res: http.IncomingMessage) {
		return(fsa.writeFile(
			cachePath + '.header.json',
			JSON.stringify(res.headers),
			{ encoding: 'utf8' }
		));
	}

	fetchRemote(options: FetchOptions, onFinish: (err?: NodeJS.ErrnoException) => void) {
		// These fix atom-typescript syntax highlight: ))
		var address = options.address;
		var urlRemote = address.url;

		var redirectList: Address[] = [];
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
			encoding: 'utf8',
			followRedirect: (res: http.IncomingMessage) => {
				redirectList.push(address);
				urlRemote = url.resolve(urlRemote, res.headers.location);
				address = new Address(urlRemote);

				this.fetchCached({
					address: address,
					forceHost: options.forceHost,
					forcePort: options.forcePort
				}, onFinish).then((result: CacheResult) => {
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

				return(Promise.join(this.addLinks(redirectList, address), this.storeHeaders(cachePath, res)).finally(() =>
					resolve(new CacheResult(
						streamBuffer as any as stream.Readable,
						address
					))
				));
			}).catch(die);
		});

		streamRequest.on('end', () => {
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
