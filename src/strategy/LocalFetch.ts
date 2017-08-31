import * as fs from 'fs';

import * as Promise from 'bluebird';

import { url2path } from '../Address';
import { InternalHeaders } from '../Cache';
import { CacheResult, FetchError, defaultHeaders } from '../CacheResult';
import { FetchState } from '../FetchState';
import { Strategy } from './Strategy';

const statAsync = Promise.promisify(fs.stat, { context: fs });

export function openLocal(
	state: FetchState,
	path: string,
	headers: InternalHeaders
): Promise<boolean> {
	const streamIn = fs.createReadStream(path, state.buffer ? { start: state.buffer.len } : {});

	// Resolve promise with headers if stream opens successfully.
	streamIn.on('open', () => {
		// TODO: Should always stream through a buffer...
		if(state.buffer) {
			streamIn.pipe(state.buffer);
		} else {
			state.startStream(new CacheResult(
				streamIn,
				state,
				headers
			));
		}
	});

	return(new Promise(
		(
			resolve: (result: boolean) => void,
			reject: (err: NodeJS.ErrnoException) => void
		) => {
			// TODO: also emit the error?
			state.onKill = reject;
			// Cached file doesn't exist or IO error.
			streamIn.on('error', reject);
			streamIn.on('end', () => resolve(true));
		}
	));
}

export class LocalFetch extends Strategy {

	fetch(state: FetchState) {
		if(!state.address.isLocal) return(false);

		if(!state.allowLocal) {
			throw(new FetchError('EPERM', 'Access denied to local ' + state.address.url));
		}

		const path = state.address.path;
		const result = statAsync(path).then((stats: fs.Stats) => ({
			'cget-stamp': stats.mtime.getTime(),
			'cget-status': 200,
			'cget-message': 'OK'
		})).then(
			(headers: InternalHeaders) => openLocal(state, path, headers)
		)

		return(result);
	}

}
