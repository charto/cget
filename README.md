cget
====

[![npm version](https://img.shields.io/npm/v/cget.svg)](https://www.npmjs.com/package/cget)

`cget` is a robust streaming parallel download manager with a filesystem cache.

Features
--------

- Promise-based API, returns HTTP headers and a Node.js stream with contents.
- Filesystem cache mirrors remote host and directory structure.
  - Easy to bypass `cget` and look at cached files.
- Headers are stored in separate `.header.json` files.
- Concurrent downloads are automatically limited using [cwait](https://github.com/charto/cwait#readme).
- Also supports and caches redirect headers.
- Built on top of [request](https://github.com/request/request).
- Written in TypeScript.

Usage
=====

Cached downloads
----------------

```JavaScript
var path = require('path');
var Cache = require('..').Cache;

var cache = new Cache({
  basePath: path.join(__dirname, 'cache'),
  concurrency: 2
});

cache.fetch('http://www.google.com/').then(function(result) {
  console.log('Remote address:   ' + result.address.url);
  console.log('Local cache path: ' + result.address.path);

  console.log('Headers:');
  console.log(result.headers);

  console.log('Content:');
  result.stream.pipe(process.stdout);
});
```

Running it the first time prints and saves the downloaded file and its headers:

- `cache/www.google.com/index.html`
- `cache/www.google.com/index.html.header.json`

The second time it prints the exact same output, but without needing a network connection.

Caching arbitrary files
-----------------------

`cget` supports any URI (URL or URN) as the cache key.

License
=======

[The MIT License](https://raw.githubusercontent.com/charto/cget/master/LICENSE)

Copyright (c) 2015-2016 BusFaster Ltd
