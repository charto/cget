// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as path from 'path';
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
	constructor(uri: string, cwd?: string) {
		var urn: string | null = null;
		var url: string | null = null;
		var cachePath: string;

		if(uri.match(/^\.?\.?\//)) {
			// The URI looks more like a local path.
			cachePath = path.resolve(cwd || '.', uri);
			url = 'file://' + cachePath;
			this.isLocal = true;
		} else if(uri.substr(0, 5) == 'file:') {
			cachePath = path.resolve(uri.substr(5));
			url = 'file://' + cachePath;
			this.isLocal = true;
		} else if(uri.substr(0, 4) == 'urn:') {
			urn = uri;
			cachePath = urn.substr(4).replace(/:/g, '/');
		} else {
			// If the URI is not a URN address, interpret it as a URL address and clean it up.
			url = sanitizeUrl(uri);
			cachePath = uri.substr(uri.indexOf(':') + 1);
		}

		this.uri = (urn || url)!;
		this.urn = urn;
		this.url = url;
		this.path = this.isLocal ? cachePath : sanitizePath(cachePath);
	}

	uri: string;
	urn: string | null;
	url: string | null;
	path: string;
	isLocal = false;
}
