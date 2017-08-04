// This file is part of cget, copyright (c) 2015-2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as path from 'path';
import * as URL from 'url';

export function path2url(localPath: string) {
	// Make path absolute, ensure separators are slashes and escape any strange characters.
	const result = path.resolve(localPath).split(path.sep).map(encodeURIComponent).join('/');
	let prefix = 'file://';

	// Absolute paths start with a drive letter on Windows,
	// requiring an extra prefix slash.
	if(result.charAt(0) != '/') prefix += '/';

	return(prefix + result);
}

export function url2path(fileUrl: string) {
	const match = fileUrl.match(/file:\/\/(.*)/i);

	// TODO: Remove one more slash if url starts with a drive letter!

	if(!match) throw(new Error('Not a file URL: ' + fileUrl));

	return(match[1].split('/').map(decodeURIComponent).join(path.sep));
}

/** Last line of defence to filter malicious paths. */

export function sanitizePath(urlPath: string) {
	return(urlPath
		// Remove unwanted characters.
		.replace(/[^-_./0-9A-Za-z]/g, '_')

		// Remove - _ . / from beginnings of path parts.
		.replace(/(^|\/)[-_./]+/g, '$1')

		// Remove - _ . / from endings of path parts.
		.replace(/[-_./]+($|\/)/g, '$1')
	);
}

export class Address<RedirectData = any> {

	constructor(public uri: string, baseUrl?: string, public cacheKey?: string) {
		this.url = baseUrl || path2url('.');

		if(uri.match(/^urn:/i)) {
			this.urn = uri;
			this.cacheKey = this.urn.substr(4).replace(/:/g, '/');
		} else {
			this.redirect(uri, true);
		}

		if(this.cacheKey) this.setKey(this.cacheKey);
	}

	redirect(url: string, isFake = false, data?: RedirectData) {
		if(!isFake) this.history.push({ url: this.url, path: this.path, data });

		url = URL.resolve(this.url, url);
		this.url = url;

		this.wasLocal = this.wasLocal || this.isLocal;
		this.wasRemote = this.wasRemote || this.isRemote;

		if(url.match(/^file:/i)) {
			this.isLocal = true;
			this.isRemote = false;
			this.path = url2path(url);
		} else {
			this.isLocal = false;
			this.isRemote = true;

			if(!this.cacheKey) {
				const parts = URL.parse(url, false, true);
				const origin = (parts.host || '').replace(/:.*/, '');

				this.setKey(
					(
						parts.protocol + origin + '/' + parts.pathname + (parts.search || '')
					).split(/[/:?]/).map(decodeURIComponent).join('/')
				);
			}
		}

		return(this);
	}

	private setKey(cacheKey: string) {
		this.path = sanitizePath(cacheKey).replace(/\//g, path.sep);
	}

	urn: string | undefined;
	url: string;
	history: { url: string, path?: string, data?: RedirectData }[] = [];
	path: string;

	/** Address was redirected from a local file. */
	wasLocal = false;

	/** Address was redirected from a remote address. */
	wasRemote = false;

	/** Address refers to a local file. */
	isLocal = false;

	/** Address refers to a remote address. */
	isRemote = false;
}
