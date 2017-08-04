import * as Promise from 'bluebird';

import { Address } from '../Address';
import { InternalHeaders } from '../Cache';
import { CacheResult, FetchError } from '../CacheResult';
import { FetchState } from '../FetchState';
import { Strategy } from './Strategy';
import { RemoteTransfer } from './RemoteTransfer';

export class RemoteFetch extends Strategy {

	fetch(state: FetchState) {
		if(!state.address.isRemote) return(false);

		if(!state.allowRemote) {
			throw(new FetchError('EPERM', 'Access denied to remote address ' + state.address.url));
		}

		return(new RemoteTransfer(this, state).ready);
	}

	/** Store HTTP redirect headers with the final target address. */

	addLinks(address: Address<InternalHeaders>) {
		return(Promise.map(address.history,
			({ url, path, data }) => this.cache.store(url, void 0, data)
		));
	}

}
