// This file is part of cget, copyright (c) 2015-2016 BusFaster Ltd.
// Released under the MIT license, see LICENSE.

import * as fs from 'fs';
import * as url from 'url';
import * as http from 'http';

import {fsa, extend} from '../dist/cget/util';
import {Address, Cache, CacheResult} from '../dist/cget';

var cache = new Cache(process.argv[2], process.argv[3]);

type ArgTbl = {[key: string]: string};

function parseArgs(query: string) {
	var result: ArgTbl = {};

	if(query) {
		for(var item of query.split('&')) {
			var partList = item.split('=').map(decodeURIComponent);

			if(partList.length == 2) result[partList[0]] = partList[1];
		}
	}

	return(result);
}

function reportError(res: http.ServerResponse, code: number, header?: Object) {
	var body = new Buffer(code + '\n', 'utf-8');

	header = extend(
		header || {},
		{
			'Content-Type': 'text/plain',
			'Content-Length': body.length
		}
	)

	res.writeHead(code, header);

	res.end(body);
}

var app = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
	var urlParts = url.parse(req.url);
	var args = parseArgs(urlParts.query);
	var host = args['host'];

	if(!host) {
		reportError(res, 400);
		return;
	}

	urlParts.protocol = 'http';
	urlParts.search = null;
	urlParts.query = null;
	urlParts.host = host;

	var cachePath = cache.getCachePath(new Address(url.format(urlParts)));

	cachePath.then(Cache.checkRemoteLink).then((urlRemote: string) => {
		if(urlRemote) {
			reportError(res, 302, {
				'Location': urlRemote
			});

			return;
		}

		fsa.stat(cachePath.value()).then((stats: fs.Stats) => {
			var header = {
				'Content-Type': 'text/plain;charset=utf-8',
				'Content-Length': stats.size
			};

			res.writeHead(200, header);

			fs.createReadStream(cachePath.value()).pipe(res);
		});
	}).catch((err: NodeJS.ErrnoException) => {
		console.log('404: ' + req.url);
		reportError(res, 404);
	});
});

app.listen(12345);
