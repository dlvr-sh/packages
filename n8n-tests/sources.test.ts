import { describe, expect, test } from 'bun:test';
import {
	addressIsPrivate,
	assertPublicHttpsUrl,
	prepareBinarySource,
	prepareUrlSource,
	type HttpRequest,
} from '../n8n/nodes/Dlvr/sources';

describe('source URL policy', () => {
	test('rejects local, credentialed, non-HTTPS, and private literal destinations', () => {
		for (const value of [
			'not a URL',
			'http://example.com/file',
			'https://localhost/file',
			'https://127.0.0.1/file',
			'https://10.0.0.1/file',
			'https://user:pass@example.com/file',
			'https://[::1]/file',
		]) {
			expect(() => assertPublicHttpsUrl(value)).toThrow();
		}
		expect(assertPublicHttpsUrl('https://files.example.com/file.zip').hostname).toBe('files.example.com');
		expect(addressIsPrivate('192.168.1.1')).toBe(true);
		expect(addressIsPrivate('8.8.8.8')).toBe(false);
	});
});

describe('binary source', () => {
	test('reads stored binary data sequentially and reuses the last part for retry', async () => {
		let opened = 0;
		const prepared = prepareBinarySource(
			{ id: 'filesystem:file', name: 'artifact.bin', size: 10, type: 'application/octet-stream' },
			{
				getBinaryStream: async () => {
					opened += 1;
					return (async function* () {
						yield new TextEncoder().encode('abc');
						yield new TextEncoder().encode('defgh');
						yield new TextEncoder().encode('ij');
					})();
				},
			},
		);
		expect(prepared.concurrency).toBe(1);
		expect((await prepared.source.createBody(0, 4)).toString()).toBe('abcd');
		expect((await prepared.source.createBody(0, 4)).toString()).toBe('abcd');
		expect((await prepared.source.createBody(6, 10)).toString()).toBe('ghij');
		expect(opened).toBe(1);
	});

	test('slices inline binary data with normal concurrency', async () => {
		const prepared = prepareBinarySource(
			{ inline: Buffer.from('abcdef'), name: 'a.txt', size: 6, type: 'text/plain' },
			{ getBinaryStream: async () => { throw new Error('not used'); } },
		);
		expect(prepared.concurrency).toBe(4);
		expect((await prepared.source.createBody(2, 5)).toString()).toBe('cde');
	});
});

describe('URL source', () => {
	test('probes and requests exact byte ranges', async () => {
		const calls: Array<{ headers?: Record<string, unknown> }> = [];
		const request: HttpRequest = async (options) => {
			calls.push({ headers: options.headers });
			const range = String(options.headers?.range ?? '');
			if (range === 'bytes=0-0') {
				return {
					statusCode: 206,
					headers: {
						'content-range': 'bytes 0-0/6',
						'content-type': 'text/plain',
						'content-disposition': 'attachment; filename="hello.txt"',
					},
					body: Buffer.from('a'),
				};
			}
			return {
				statusCode: 206,
				headers: { 'content-range': 'bytes 1-3/6' },
				body: Buffer.from('bcd'),
			};
		};
		const prepared = await prepareUrlSource(request, 'https://files.example.com/ignored');
		expect(prepared.source.name).toBe('hello.txt');
		expect(prepared.source.size).toBe(6);
		expect((await prepared.source.createBody(1, 4)).toString()).toBe('bcd');
		expect(calls.map(({ headers }) => headers?.range)).toEqual(['bytes=0-0', 'bytes=1-3']);
	});

	test('buffers a small source that ignores ranges', async () => {
		const request: HttpRequest = async () => ({
			statusCode: 200,
			headers: { 'content-length': '5', 'content-type': 'text/plain' },
			body: Buffer.from('hello'),
		});
		const prepared = await prepareUrlSource(request, 'https://files.example.com/hello.txt');
		expect((await prepared.source.createBody(1, 4)).toString()).toBe('ell');
	});

	test('validates redirect destinations before following them', async () => {
		const request: HttpRequest = async () => ({
			statusCode: 302,
			headers: { location: 'https://127.0.0.1/private' },
			body: '',
		});
		expect(prepareUrlSource(request, 'https://files.example.com/file')).rejects.toThrow('private');
	});
});
