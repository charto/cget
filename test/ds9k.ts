// This file is part of cget, copyright (c) 2015-2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

/** @file This is the DeathServer 9000.
  * It's meant to be the flakiest, most unreliable and overall worst
  * HTTP server imaginable. Built for testing cget, which should still
  * successfully download files from it.
  * Also guaranteed to come with glaring SECURITY FLAWS and REMOTE EXPLOITS.
  * Please avoid running on public-facing or production systems. */

import * as fs from 'fs';
import * as url from 'url';
import * as http from 'http';

import * as Promise from 'bluebird';

import { Address, Cache, CacheResult, RedirectResult, getHeaderPath } from '..';

export const enum ProblemBase {
	close = 1,
	length = close * 8,
	status = length * 16
}

/** Flags for things that will go wrong.
  * Note that closing the connection in the middle of data,
  * without timeout or content length, cannot be distinguished from success. */

export const enum Problem {
	none = 0,

	closeMask = ProblemBase.close * 3,
	closeBeforeHeader = ProblemBase.close * 1,
	closeAfterHeader = ProblemBase.close * 2,
	closeDuringData = ProblemBase.close * 3,

	timeout = ProblemBase.close * 4,

	lengthMask = ProblemBase.length * 15,
	contentLengthMissing = ProblemBase.length * 1,
	contentLengthIncorrect = ProblemBase.length * 2,
	rangeUnsupported = ProblemBase.length * 4,
	rangeIncorrect = ProblemBase.length * 8,

	statusMask = ProblemBase.status * 3,
	statusCode = ProblemBase.status * 1,
	redirectLoop = ProblemBase.status * 2
};

var cache = new Cache(
	process.argv[2],
	{
		// Deny access to file:// URLs.
		allowLocal: false
	}
);

class Error9k extends Error {
	/** @param code HTTP status code.
	  * @param headers Optional extra headers (clobbered by send method). */
	constructor(public code?: number, public headers: http.ServerResponseHeaders = {}) {
		super(code ? http.STATUS_CODES[code] : 'Unknown error');
	}

	send = (res: http.ServerResponse) => {
		if(!this.code) return;

		const headers = this.headers;
		const body = new Buffer(this.code + ' ' + this.message + '\n', 'utf-8');

		headers['Content-Type'] = 'text/plain';
		headers['Content-Length'] = body.length;

		res.writeHead(this.code, headers);
		res.end(body);
	}

	/** Workaround for instanceof (prototype chain is messed up after inheriting Error in ES5). */
	isError9k = true;
}

export function requestHandler(req: http.IncomingMessage, res: http.ServerResponse) {
	const parts = url.parse(req.url!);
	const match = (parts.query || '').match(/problem=([0-9]+)/);
	const problem = match ? match[1] as Problem : Problem.none;
	const problemClose = problem & Problem.closeMask;

	const host = req.headers.host! as string;
	const address = new Address('http://' + host.replace(/:.*/, '') + parts.pathname);
	const headers: http.ServerResponseHeaders = {};
	let cachePath: string;

	cache.getRedirect(address).then((result: RedirectResult) => {
		const oldHeaders = result.oldHeaders && result.oldHeaders[0];

		if(oldHeaders) {
			throw(new Error9k(
				+(oldHeaders['cget-status'] || 0),
				{ Location: '' + (oldHeaders['cget-target'] || oldHeaders['location']) }
			));
		}

		cachePath = result.cachePath;

		for(let key of Object.keys(result.headers)) {
			const value = result.headers[key];
			if(typeof(value) != 'undefined') headers[key] = value;
		}

		return(Promise.promisify(fs.stat)(cachePath));
	}).then((stats: fs.Stats) => {
		// if(!headers['Content-Type']) {
		//	headers['Content-Type'] = 'text/plain;charset=utf-8';
		// }

		headers['Content-Length'] = stats.size;

		if(problemClose == Problem.closeBeforeHeader) throw(new Error9k());
		res.writeHead(200, headers);
		if(problemClose == Problem.closeAfterHeader) throw(new Error9k());

		fs.createReadStream(cachePath, { encoding: null as any, start: 0 }).pipe(res);
	}).catch((err: NodeJS.ErrnoException | Error9k) => {
		const err9k = ('isError9k' in err) ? err as Error9k : new Error9k(404);

		if(err9k.code) err9k.send(res);

		if(!(problem & Problem.timeout)) {
			res.end();
			(res as any).connection.destroy();
		}
	});
}

export class Server {
	constructor(public port = 8080) {
		const server = http.createServer(requestHandler);

		this.ready = new Promise((resolve, reject) => {
			server.listen(port, () => {
				// Always print an annoying message to discourage users.
				console.error('DeathServer 9000 active. Run for your life.');
				resolve();
			});

			server.on('error', reject);
		});

		server.addListener('connection', (stream) => stream.setTimeout(100));

		this.server = server;
	}

	close() {
		return(Promise.promisify(this.server.close).call(this.server));
	}

	server: http.Server;
	ready: Promise<void>;
}
