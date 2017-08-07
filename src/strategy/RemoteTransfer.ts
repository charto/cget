import * as http from 'http';
import * as stream from 'stream';

import * as Promise from 'bluebird';
import * as request from 'request';

import { Deferred } from '../Deferred';
import { BufferStream } from '../BufferStream';
import { InternalHeaders } from '../Cache';
import { CacheResult, CachedError, defaultHeaders } from '../CacheResult';
import { FetchState, extend } from '../FetchState';
import { RemoteFetch } from './RemoteFetch';

const retryCodeTbl: { [key: string]: boolean } = {};

for(
	let code of (
		'EAI_AGAIN ECONNREFUSED ECONNRESET EHOSTUNREACH' +
		' ENOTFOUND EPIPE ESOCKETTIMEDOUT ETIMEDOUT'
	).split(' ')
) {
	retryCodeTbl[code] = true;
}

function applyRewrite(url: string, options: FetchState) {
	return(options.rewrite ? options.rewrite(url) : url);
}

export class RemoteTransfer {

	constructor(public strategy: RemoteFetch, public state: FetchState) {
		this.streamRequest = this.initRequest(state.address.url);
		this.start();
	}

	initRequest(url: string) {
		const state = this.state;

		const config: request.CoreOptions = state.extendRequestConfig({
			// Receive raw byte buffers.
			encoding: null,
			gzip: true,
			followRedirect: (res: http.IncomingMessage) => this.followRedirect(res),
			pool: {
				maxSockets: Infinity
			}
		});

		if(state.timeout) config.timeout = state.timeout;

		if(state.username && state.password) {
			config.auth = {
				user: state.username,
				pass: state.password,
				sendImmediately: true
			};
		}

		const stream = request.get(applyRewrite(url, state), config);

		return(stream);
	}

	followRedirect(res: http.IncomingMessage) {
		const headers: InternalHeaders = {};

		extend(headers, res.headers);
		extend(headers, {
			'cget-stamp': new Date().getTime(),
			'cget-status': res.statusCode!,
			'cget-message': res.statusMessage!
		});

		this.state.address.redirect('' + headers.location, false, headers);

		this.state.retryNow();
		this.deferred.resolve(false);
		return(false);
	}

	start() {
		const streamRequest = this.streamRequest;

		streamRequest.on('data', (chunk: Buffer) => this.onData(chunk));
		streamRequest.on('end', () => this.onEnd());

		streamRequest.on('error', (err: NodeJS.ErrnoException) => {
			// Check if retrying makes sense for this error.
			if(retryCodeTbl[err.code || '']) {
				this.retry(err);
			} else {
				this.die(err);
			}
		});

		streamRequest.on('response', (res: http.IncomingMessage) => this.onResponse(res));
	}

	retry(err?: NodeJS.ErrnoException) {
		this.state.retryLater();
		this.deferred.reject(err);
	}

	die(err: CachedError | NodeJS.ErrnoException) {
		// Only emit error in output stream after open callback
		// had a chance to attach an error handler.
		if(this.state.isStreaming) {
			this.streamBuffer.emit('error', err);
		} else {
			this.errorList.push(err);
		}

		this.deferred.reject(err);
	}

	onData = (chunk: Buffer) => { this.chunkList.push(chunk); };
	onEnd = () => { this.isEnded = true; };

	onResponse(res: http.IncomingMessage) {
		const state = this.state;
		const status = res.statusCode!;

		const headers: InternalHeaders = {};

		extend(headers, res.headers);
		extend(headers, {
			'cget-stamp': new Date().getTime(),
			'cget-status': status,
			'cget-message': res.statusMessage!
		});

		if(status >= 500 && status < 600) {
			this.retry();
			return;
		} else if(status != 200) {
			var err = new CachedError(status, res.statusMessage, headers);

			if(state.allowCacheWrite) {
				this.strategy.cache.store(this.state.address, void 0, headers).catch(() => {});
			}

			this.die(err);
			return;
		}

		if(state.allowCacheWrite) {
			this.streamStore = new stream.PassThrough();

			this.strategy.cache.store(this.state.address, this.streamStore, headers).catch(() => {});
			if(!this.state.address.cacheKey) this.strategy.addLinks(this.state.address);
		}

		if(!state.buffer) state.buffer = new BufferStream();
		this.streamBuffer = state.buffer

		this.streamBuffer.on('error', (err: NodeJS.ErrnoException) => {
			this.streamRequest.abort();
			this.state.isStreaming = false;
			this.die(err);
		});

		this.streamBuffer.on('finish', () => { this.deferred.resolve(true); });

		state.startStream(new CacheResult(
			this.streamBuffer,
			state.address,
			res.headers
		)).then(() => {
			// Start emitting data straight to output streams.
			this.onData = (chunk: Buffer) => {
				if(this.streamStore) this.streamStore.write(chunk);
				this.streamBuffer.write(chunk);
			}

			this.onEnd = () => {
				if(this.streamStore) this.streamStore.end();
				this.streamBuffer.end();
			}

			// Output data chunks already arrived in memory buffer.
			for(let chunk of this.chunkList) this.onData(chunk);

			// Emit any errors already encountered.
			for(let err of this.errorList) this.streamBuffer.emit('error', err);

			if(this.isEnded) this.onEnd();

			// Clear buffers to save memory.
			this.chunkList = [];
			this.errorList = [];
		});
	}

	deferred = new Deferred<boolean>();
	ready = this.deferred.promise;

	streamBuffer: BufferStream;
	streamRequest: request.Request;
	streamStore: stream.PassThrough;

	chunkList: Buffer[] = [];
	errorList: (NodeJS.ErrnoException | CachedError)[] = [];
	isEnded = false;

}
