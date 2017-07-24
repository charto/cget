import * as stream from 'stream';

export class BufferStream extends stream.Transform {
	_transform(
		chunk: Buffer,
		encoding: string,
		flush: (err: NodeJS.ErrnoException | null, chunk: Buffer) => void
	) {
		this.len += chunk.length;

		flush(null, chunk);
	}

	len = 0;
}
