import * as stream from 'stream';

import { Address } from './Address';
import { Headers } from './Cache';

export class CacheResult {
	constructor(
		public stream: stream.Readable,
		public address: Address,
		public status: number,
		public message: string,
		public headers: Headers
	) {}
}
