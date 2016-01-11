// This file is part of cget, copyright (c) 2015 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

// Define some simple utility functions to avoid depending on other packages.

import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';
import * as Promise from 'bluebird';

/** Asynchronous versions of fs methods, wrapped by Bluebird. */

export var fsa = {
	stat: Promise.promisify(fs.stat),
	open: Promise.promisify(fs.open),
	close: Promise.promisify(fs.close),
	rename: Promise.promisify(fs.rename),
	mkdir: Promise.promisify(fs.mkdir),
	read: Promise.promisify(fs.read),
	readFile: Promise.promisify(fs.readFile) as any as (name: string, options: {encoding: string; flag?: string;}) => Promise<string>,
	writeFile: Promise.promisify(fs.writeFile) as (name: string, content: string, options: {encoding: string; flag?: string;}) => Promise<{}>
};

var againSymbol = {};
var again = () => againSymbol;

/** Promise while loop. */

export function repeat<T>(fn: (again: () => {}) => Promise<T>): Promise<T> {
	return(Promise.try(() =>
		fn(again)
	).then((result: T) =>
		(result == againSymbol) ? repeat(fn) : result
	));
}

/** Copy all members of src object to dst object. */

export function extend(dst: {[key: string]: any}, src: {[key: string]: any}) {
	for(var key of Object.keys(src)) {
		dst[key] = src[key];
	}

	return(dst);
}

/** Make shallow clone of object. */

export function clone(src: Object) {
	return(extend({}, src));
}

/** Create a new directory and its parent directories.
  * If a path component to create conflicts with an existing file,
  * rename to file to <component>/<indexName>. */

export function mkdirp(pathName: string, indexName: string) {
	var partList = path.resolve(pathName).split(path.sep);
	var prefixList = partList.slice(0);
	var pathPrefix: string;

	// Remove path components until an existing directory is found.

	return(repeat((again: () => {}) => {
		if(!prefixList.length) return;

		pathPrefix = prefixList.join(path.sep);

		return(Promise.try(() => fsa.stat(pathPrefix)).then((stats: fs.Stats) => {
			if(stats.isFile()) {
				// Trying to convert a file into a directory.
				// Rename the file to indexName and move it into the new directory.

				var tempPath = pathPrefix + '.' + makeTempSuffix(6);

				return(Promise.try(() =>
					fsa.rename(pathPrefix, tempPath)
				).then(() =>
					fsa.mkdir(pathPrefix)
				).then(() =>
					fsa.rename(tempPath, path.join(pathPrefix, indexName))
				));
			} else if(!stats.isDirectory()) {
				throw(new Error('Tried to create a directory inside something weird: ' + pathPrefix));
			}
		}).catch((err: NodeJS.ErrnoException) => {
			// Re-throw unexpected errors.
			if(err.code != 'ENOENT' && err.code != 'ENOTDIR') throw(err);

			prefixList.pop();
			return(again());
		}));
	})).then(() => Promise.reduce(
		// Create path components that didn't exist yet.
		partList.slice(prefixList.length),
		(pathPrefix: any, part: string, index: number, len: number) => {
			var pathNew = pathPrefix + path.sep + part;

			return(Promise.try(() =>
				fsa.mkdir(pathNew)
			).catch((err: NodeJS.ErrnoException) => {
				// Because of a race condition with simultaneous cache stores,
				// the directory might already exist.

				if(err.code != 'EEXIST') throw(err);
			}).then(() =>
				pathNew
			));
		},
		pathPrefix
	));
}

/** Create a string of random letters and numbers. */

export function makeTempSuffix(length: number) {
	return(
		Math.floor((Math.random() + 1) * Math.pow(36, length))
		.toString(36)
		.substr(1)
	)
}

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

export function isDir(cachePath: string) {
	return(fsa.stat(cachePath).then(
		(stats: fs.Stats) => stats.isDirectory()
	).catch(
		(err: NodeJS.ErrnoException) => false
	));
}

export function sanitizeUrl(urlRemote: string) {
	var urlParts = url.parse(urlRemote, false, true);
	var origin = urlParts.host;

	if(urlParts.pathname.charAt(0) != '/') origin += '/';

	origin += urlParts.pathname;
	return((urlParts.protocol || 'http:') + '//' + url.resolve('', origin));
}
