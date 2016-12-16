cget
====

[![npm version](https://img.shields.io/npm/v/cget.svg)](https://www.npmjs.com/package/cget)

`cget` is a robust streaming parallel download manager with a filesystem cache.

These docs are relevant to the new version under construction on Github, not yet published on NPM.

Features
--------

- Promise-based API, returns HTTP headers and a Node.js stream with contents.
- Filesystem cache mirrors remote hosts and their directory structure.
  - Easy to bypass `cget` and look at cached files.
- Headers are stored in separate `.header.json` files.
- Concurrent downloads are automatically limited using [cwait](https://github.com/charto/cwait#readme).
- Follows and caches redirect headers.
- Built on top of [request](https://github.com/request/request).
- Streaming from `file://` URLs can be enabled, bypassing the cache.
- Files can be stored in the cache with any URI (URL or URN) as the key.
- Written in TypeScript.

`cget` is perfect for downloading and caching various schema files,
and is used in [cxsd](https://github.com/charto/cxsd#readme)

Usage
=====

Cached downloads
----------------

```JavaScript
var Cache = require('cget').Cache;

// Initialize the download cache.

var cache = new Cache({

  // Store files in "cache" subdirectory next to this script.
  basePath: require('path').join(__dirname, 'cache'),

  // Allow up to 2 parallel downloads.
  concurrency: 2

});

// Download a web page and print some info.

cache.fetch('http://www.google.com/').then(function(result) {

  console.log('Remote address:   ' + result.address.url);
  console.log('Local cache path: ' + result.address.path);
  console.log('HTTP status code: ' + result.status);

  console.log('Headers:');
  console.log(result.headers);

  console.log('Content:');
  result.stream.pipe(process.stdout);

});
```

Running it the first time prints and saves the downloaded file and its headers including any redirects
in local files, for example:

- `cache/www.google.com.header.json`
- `cache/www.google.<COUNTRY>/<NONCE>`
- `cache/www.google.<COUNTRY>/<NONCE>.header.json`

The second time it prints the exact same output, but without needing a network connection.

Caching arbitrary files
-----------------------

The `store` method supports caching a string with any URI (URL or URN) as the key:

```JavaScript
var cache = new (require('cget').Cache)();

cache.store('urn:x-inspire:specification:gmlas:GeographicalNames:3.0', 'Some data');

cache.store('http://inspire.ec.europa.eu/schemas/ad/4.0', 'More data');
```

License
=======

[The MIT License](https://raw.githubusercontent.com/charto/cget/master/LICENSE)

Copyright (c) 2015-2016 BusFaster Ltd
