// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as path from 'path';
import * as url from 'url';

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
		if(uri.match(/^\.?\.?\//)) {
			// The URI looks more like a local path.
			this.path = path.resolve(cwd || '.', uri);
			this.url = 'file://' + this.path;
			this.isLocal = true;
		} else if(uri.substr(0, 5) == 'file:') {
			this.path = path.resolve(uri.substr(5));
			this.url = 'file://' + this.path;
			this.isLocal = true;
		} else if(uri.substr(0, 4) == 'urn:') {
			this.urn = uri;
			this.path = sanitizePath(this.urn.substr(4).replace(/:/g, '/'));
		} else {
			// If the URI is not a URN address, interpret it as a URL address and clean it up.

			const parts = url.parse(uri, false, true);
			const origin = parts.host || '';

			const slash = ((parts.pathname || '').charAt(0) == '/') ? '' : '/';

			this.url = (
				(parts.protocol || 'http:') + '//' +
				url.resolve('', origin + slash + parts.pathname) +
				(parts.search || '')
			);

			this.path = sanitizePath(
				url.resolve('', origin.replace(/:.*/, '') + slash + parts.pathname) +
				(parts.search || '')
			);
		}

		this.uri = (this.urn || this.url)!;
	}

	uri: string;
	urn: string | null;
	url: string | null;
	path: string;
	isLocal = false;
}
