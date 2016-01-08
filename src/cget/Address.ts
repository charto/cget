// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import {sanitizePath, sanitizeUrl} from './util'

export class Address {
	constructor(uri: string) {
		var urn: string;
		var url: string;
		var path: string;

		if(uri.substr(0,4) == 'urn:') {
			urn = uri;
			path = urn.substr(4).replace(/:/g, '/');
		} else {
			// If the URI is not a URN address, interpret it as a URL address and clean it up.
			url = sanitizeUrl(uri);
			path = uri.substr(uri.indexOf(':') + 1);
		}

		this.uri = urn || url;
		this.urn = urn || null;
		this.url = url || null;
		this.path = sanitizePath(path);
	}

	uri: string;
	urn: string;
	url: string;
	path: string;
}
