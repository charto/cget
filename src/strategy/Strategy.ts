import * as stream from 'stream';
import * as Promise from 'bluebird';

import { Address } from '../Address';
import { Cache, CacheOptions, InternalHeaders } from '../Cache';
import { CacheResult } from '../CacheResult';
import { FetchState } from '../FetchState';


export abstract class Strategy {

	constructor(public cache: Cache, public options: CacheOptions) {}

	/** @return Success flag. */
	abstract fetch(state: FetchState): boolean | Promise<boolean>

	store?(
		address: Address,
		data?: string | stream.Readable,
		headers?: InternalHeaders
	): boolean | Promise<boolean> { return(false); }

}
