import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';

import * as Promise from 'bluebird';

import { mkdirp } from '../mkdirp';
import { Address } from '../Address';
import { Cache, CacheOptions, Headers, InternalHeaders } from '../Cache';
import { CacheResult, CachedError, defaultHeaders } from '../CacheResult';
import { FetchState } from '../FetchState';
import { Strategy } from './Strategy';
import { openLocal } from './LocalFetch';

const statAsync = Promise.promisify(fs.stat, { context: fs });
const readFileAsync = Promise.promisify(fs.readFile, { context: fs }) as any as (name: string, options: { encoding: string, flag?: string }) => Promise<Buffer | string>;
const writeFileAsync = Promise.promisify(fs.writeFile, { context: fs }) as any as (name: string, content: string, options: { encoding: string, flag?: string }) => Promise<{}>;

export interface RedirectResult {
	address: Address<InternalHeaders>;
	cachePath: string;
	headers: InternalHeaders;
}

export function pathIsDir(cachePath: string) {
	return(statAsync(cachePath).then(
		(stats: fs.Stats) => stats.isDirectory()
	).catch(
		(err: NodeJS.ErrnoException) => false
	));
}

/** Get path to headers for a locally cached file. */

export function getHeaderPath(cachePath: string, address: Address) {
	return(cachePath + '.header.json');
}

export function getHeaders(cachePath: string, address: Address) {
	return(
		readFileAsync(
			getHeaderPath(cachePath, address),
			{ encoding: 'utf8' }
		).then(JSON.parse).catch(
			/** If headers are not found, invent some. */
			(err: NodeJS.ErrnoException) => defaultHeaders
		)
	);
}

export class FileSystemCache extends Strategy {

	constructor(cache: Cache, basePath: string, options: CacheOptions) {
		super(cache, options);

		this.basePath = path.resolve('.', basePath);
		this.indexName = options.indexName || 'index.html';
	}

	/** Try to synchronously guess the cache path for an address.
	  * May be incorrect if it's a directory. */

	getCachePathSync(urlPath: string) {
		return(path.join(
			this.basePath,
			urlPath
		));
	}

	/** Get local cache file path where a remote URL should be downloaded. */

	getCachePath(urlPath: string) {
		const indexName = this.indexName;
		let cachePath = this.getCachePathSync(urlPath);

		function makeValidPath(isDir: boolean) {
			if(isDir) cachePath = path.join(cachePath, indexName);
			return(cachePath);
		};

		if(cachePath.charAt(cachePath.length - 1) == path.sep) {
			return(Promise.resolve(makeValidPath(true)));
		}

		return(pathIsDir(cachePath).then(makeValidPath));
	}

	/** Like getCachePath, but create its parent directory if nonexistent. */

	private createCachePath(urlPath: string) {
		return(this.getCachePath(urlPath).then((cachePath: string) =>
			mkdirp(
				path.dirname(cachePath),
				this.indexName
			).then(
				() => cachePath
			)
		));
	}

	/** Test if an address is cached. */

	isCached(uri: string) {
		const address = new Address(uri);

		if(!address.path) return(false);

		return(this.getCachePath(address.path).then((cachePath: string) =>
			statAsync(
				cachePath
			).then(
				(stats: fs.Stats) => !stats.isDirectory()
			).catch(
				(err: NodeJS.ErrnoException) => false
			)
		));
	}

	store(
		address: Address,
		data?: string | stream.Readable,
		headers?: InternalHeaders
	) {
		if(address.isLocal) return(Promise.reject(new Error('URI to cache is a local path')));

		const taskList: Promise<{}>[] = [];

		if(data) {
			taskList.push(this.createCachePath(address.path).then((cachePath: string) => {
				if(typeof(data) == 'string') {
					return(writeFileAsync(
						cachePath,
						data,
						{ encoding: 'utf8' }
					));
				} else {
					return(new Promise((resolve, reject) => {
						const stream = fs.createWriteStream(cachePath);

						// Output stream file handle stays open unless manually closed.
						stream.on('finish', () => {
							stream.close();
							resolve();
						});

						stream.on('error', (err: NodeJS.ErrnoException) => {
							stream.close();
							reject(err);
						});

						data.pipe(stream);
					}))
				}
			}));
		}

		if(headers) {
			taskList.push(this.createCachePath(address.path).then((cachePath: string) => {
				return(writeFileAsync(
					getHeaderPath(cachePath, address),
					JSON.stringify(headers),
					{ encoding: 'utf8' }
				));
			}));
		}

		return(Promise.all(taskList).then(() => true));
	}

	/** Check if there are cached headers with errors or redirecting the URL. */

	getRedirect(state: FetchState, address: Address): Promise<RedirectResult> {
		const result = this.getCachePath(address.path).then(
			(cachePath: string) => getHeaders(cachePath, address).then((headers: InternalHeaders) => {
				const status = +(headers['cget-status'] || 0);
				const target = headers['cget-target'] || '' + headers['location'];

				if(status && status >= 300 && status <= 308 && target) {
					if(!state.redirectsRemaining) {
						throw(new CachedError(status, 'Too many redirects', headers));
					}

					--state.redirectsRemaining;

					return(this.getRedirect(state, address.redirect(target)));
				}

				if(status && status != 200 && (status < 500 || status >= 600)) {
					throw(new CachedError(status, headers['cget-message'], headers));
				}

				const result: RedirectResult = { address, cachePath, headers };
				return(result);
			})
		);

		return(result);
	}

	fetch(state: FetchState) {
		if(!state.address.isRemote || !state.allowCacheRead) return(false);

		return(this.getRedirect(state, state.address).then(
			(result: RedirectResult) => openLocal(state, result.cachePath, result.headers)
		));
	}

	private basePath: string;
	private indexName: string;

}
