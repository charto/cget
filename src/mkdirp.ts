// This file is part of cget, copyright (c) 2015-2017 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as path from 'path';
import * as Promise from 'bluebird';

/** Asynchronous versions of fs methods, wrapped by Bluebird. */

const statAsync = Promise.promisify(fs.stat, { context: fs });
const renameAsync = Promise.promisify(fs.rename, { context: fs }) as (src: string, dst: string) => Promise<{}>;
const mkdirAsync = Promise.promisify(fs.mkdir, { context: fs }) as (name: string) => Promise<{}>;

/*
export const fsa = {
	stat: Promise.promisify(fs.stat),
	open: Promise.promisify(fs.open),
	rename: Promise.promisify(fs.rename) as (src: string, dst: string) => Promise<{}>,
	mkdir: Promise.promisify(fs.mkdir) as (name: string) => Promise<{}>,
	readFile: Promise.promisify(fs.readFile) as any as (name: string, options: {encoding: string; flag?: string;}) => Promise<string>,
	writeFile: Promise.promisify(fs.writeFile) as (name: string, content: string, options: {encoding: string; flag?: string;}) => Promise<{}>
};
*/

const again = {};

/** Promise while loop. */

export function repeat<T>(fn: (again: {}) => Promise<T> | T | undefined): Promise<T> {
	return(Promise.try(() =>
		fn(again)!
	).then((result: T) =>
		(result == again) ? repeat(fn) : result
	));
}

/** Create a new directory and its parent directories.
  * If a path component to create conflicts with an existing file,
  * rename to file to <component>/<indexName>. */

export function mkdirp(pathName: string, indexName: string) {
	var partList = path.resolve(pathName).split(path.sep);
	var prefixList = partList.slice(0);
	var pathPrefix: string;

	// Remove path components until an existing directory is found.

	return(repeat((again: {}) => {
		if(!prefixList.length) return;

		pathPrefix = prefixList.join(path.sep);

		return(statAsync(pathPrefix).then((stats: fs.Stats): {} | undefined => {
			if(stats.isFile()) {
				// Trying to convert a file into a directory.
				// Rename the file to indexName and move it into the new directory.

				var tempPath = pathPrefix + '.' + makeTempSuffix(6);

				return(
					renameAsync(
						pathPrefix,
						tempPath
					).then(() =>
						mkdirAsync(pathPrefix)
					).then(() =>
						renameAsync(tempPath, path.join(pathPrefix, indexName))
					)
				);
			} else if(!stats.isDirectory()) {
				throw(new Error('Tried to create a directory inside something weird: ' + pathPrefix));
			}
		}).catch((err: NodeJS.ErrnoException) => {
			// Re-throw unexpected errors.
			if(err.code != 'ENOENT' && err.code != 'ENOTDIR') throw(err);

			prefixList.pop();
			return(again);
		}));
	})).then(() => Promise.reduce(
		// Create path components that didn't exist yet.
		partList.slice(prefixList.length),
		(pathPrefix: any, part: string, index: number, len: number) => {
			var pathNew = pathPrefix + path.sep + part;

			return(Promise.try(() =>
				mkdirAsync(pathNew)
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
