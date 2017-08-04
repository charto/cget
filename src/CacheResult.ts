import * as stream from 'stream';

import { Address } from './Address';
import { Headers, InternalHeaders } from './Cache';

const internalHeaderTbl: { [key: string]: boolean } = {
	'cget-stamp': true,
	'cget-status': true,
	'cget-message': true,
	'cget-target': true
};

export const defaultHeaders = {
	'cget-status': 200,
	'cget-message': 'OK'
};

function removeInternalHeaders(headers: Headers | InternalHeaders) {
	const output: Headers = {};

	for(let key of Object.keys(headers)) {
		if(!internalHeaderTbl[key]) output[key] = headers[key] as (string | string[]);
	}

	return(output);
}

export class CacheResult {
	constructor(
		public stream: stream.Readable,
		public address: Address,
		headers: InternalHeaders
	) {
		this.status = headers['cget-status'] || 200;
		this.message = headers['cget-message'] || 'OK';
		this.headers = removeInternalHeaders(headers);
	}

	status: number;
	message: string;
	headers: Headers;
}

function prototype(value: any) {
	return((target: any, key: string) => {
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: false,
			value,
			writable: true
		});
		target[key] = value;
	});
}

export interface CustomError extends Error {
	new(message: string): CustomError;
}

export const CustomError: CustomError = function CustomError(this: CustomError, message: string) {
	if(Error.captureStackTrace) {
		Error.captureStackTrace(this, CustomError);
	} else {
		const dummy = Error.apply(this, arguments);

		Object.defineProperty(this, 'stack', {
			configurable: true,
			get: () => dummy.stack
		})
	}

	this.message = message;
} as any;

CustomError.prototype = Object.create(Error.prototype, {
	constructor: {
		configurable: true,
		value: CustomError,
		writable: true
	}
});

export class FetchError extends CustomError {
	constructor(public code: string, message?: string) { super(message || code); }

	@prototype('FetchError')
	name: string;
}

export class CachedError extends CustomError {
	constructor(
		public status: number,
		message?: string,
		headers: Headers | InternalHeaders = {}
	) {
		super(status + (message ? ' ' + message : ''));

		this.headers = removeInternalHeaders(headers);
	}

	headers: Headers;

	@prototype('CustomError')
	name: string;
}
