// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as url from 'url';

export function sanitizeUrl(urlRemote: string) {
	var urlParts = url.parse(urlRemote, false, true);
	var origin = urlParts.host || '';

	if((urlParts.pathname || '').charAt(0) != '/') origin += '/';

	origin += urlParts.pathname;
	return([
		urlParts.protocol || 'http:',
		'//',
		url.resolve('', origin),
		urlParts.search || ''
	].join(''));
}

/** Last line of defence to filter malicious paths. */

export function sanitizePath(path: string) {
	return(path
		// Remove unwanted characters.
		.replace(/[^-_./0-9A-Za-z]/g, '_')

		// Remove - _ . / from beginnings of path parts.
		.replace(/(^|\/)[-_./]+/g, '$1')

		// Remove - _ . / from endings of path parts.
		.replace(/[-_./]+($|\/)/g, '$1')
	);
}

export class Address {
	constructor(uri: string) {
		var urn: string | null = null;
		var url: string | null = null;
		var path: string;

		if(uri.substr(0,4) == 'urn:') {
			urn = uri;
			path = urn.substr(4).replace(/:/g, '/');
		} else {
			// If the URI is not a URN address, interpret it as a URL address and clean it up.
			url = sanitizeUrl(uri);
			path = uri.substr(uri.indexOf(':') + 1);
		}

		this.uri = (urn || url)!;
		this.urn = urn;
		this.url = url;
		this.path = sanitizePath(path);
	}

	uri: string;
	urn: string | null;
	url: string | null;
	path: string;
}
