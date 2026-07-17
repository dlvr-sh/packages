import { describe, expect, test } from 'bun:test';
import type { IHttpRequestOptions } from 'n8n-workflow';
import { createDelivery, listDeliveries, normalizeShareId, type DlvrCredentials } from '../n8n/nodes/Dlvr/transport';

const credentials: DlvrCredentials = { apiKey: 'dlvr_test' };

describe('multipart delivery transport', () => {
	test('creates, uploads, and completes without leaking authorization to storage', async () => {
		const calls: IHttpRequestOptions[] = [];
		const request = async (options: IHttpRequestOptions) => {
			calls.push(options);
			const url = options.url;
			if (url === 'https://dlvr.sh/api/uploads') {
				return {
					statusCode: 200,
					headers: {},
					body: {
						protocolVersion: 2,
						uploadId: 'upload-1',
						uploadToken: 'token-1',
						sessionExpiresAt: '2026-07-17T14:00:00.000Z',
						shareId: 'share-1',
						url: 'https://dlvr.sh/f/share-1',
						expiresAt: '2026-07-18T12:00:00.000Z',
						files: [{ fileId: 'file-1', filename: 'hello.txt', size: 5, contentType: 'text/plain', partSize: 5, partCount: 1 }],
					},
				};
			}
			if (url.endsWith('/start')) return { statusCode: 200, headers: {}, body: { state: 'uploading' } };
			if (url.endsWith('/parts') && options.method === 'GET') return { statusCode: 200, headers: {}, body: { parts: [] } };
			if (url.endsWith('/parts') && options.method === 'POST') {
				return {
					statusCode: 200,
					headers: {},
					body: { parts: [{ partNumber: 1, offset: 0, size: 5, uploadUrl: 'https://storage.example/part', headers: { 'x-signed': 'yes' } }] },
				};
			}
			if (url === 'https://storage.example/part') return { statusCode: 200, headers: {}, body: '' };
			if (url.endsWith('/files/file-1/complete')) return { statusCode: 200, headers: {}, body: { ok: true } };
			if (url.endsWith('/upload-1/complete')) {
				return {
					statusCode: 200,
					headers: {},
					body: {
						id: 'upload-1', shareId: 'share-1', url: 'https://dlvr.sh/f/share-1', expires: '2026-07-18T12:00:00.000Z',
						downloads: 0, maxDownloads: null, passwordRequired: false, filename: 'hello.txt', size: 5,
					},
				};
			}
			throw new Error(`Unexpected request: ${options.method} ${url}`);
		};

		const result = await createDelivery({
			request,
			credentials,
			sources: [{ name: 'hello.txt', size: 5, type: 'text/plain', createBody: () => Buffer.from('hello') }],
			duration: '24h',
			idempotencyKey: 'n8n-test',
			concurrency: 1,
		});
		expect(result.url).toBe('https://dlvr.sh/f/share-1');
		const create = calls.find(({ url }) => url === 'https://dlvr.sh/api/uploads')!;
		expect(create.headers?.authorization).toBe('Bearer dlvr_test');
		expect(create.headers?.['idempotency-key']).toBe('n8n-test');
		const storage = calls.find(({ url }) => url === 'https://storage.example/part')!;
		expect(storage.headers?.authorization).toBeUndefined();
		expect(storage.headers?.['content-length']).toBe('5');
		expect(storage.headers?.['x-signed']).toBe('yes');
		expect((storage.body as Buffer).toString()).toBe('hello');
	});
});

test('delivery listing sends bounded pagination parameters', async () => {
	let requestedUrl = '';
	const result = await listDeliveries(
		async (options) => {
			requestedUrl = options.url;
			return { statusCode: 200, headers: {}, body: { uploads: [], nextOffset: null } };
		},
		credentials,
		{ limit: 250, offset: 12 },
	);
	expect(requestedUrl).toBe('https://dlvr.sh/api/account/uploads?limit=100&offset=12');
	expect(result.nextOffset).toBeNull();
});

describe('share IDs', () => {
	test('accepts IDs and full share URLs', () => {
		expect(normalizeShareId('abc123')).toBe('abc123');
		expect(normalizeShareId('https://dlvr.sh/f/abc123')).toBe('abc123');
	});
});
