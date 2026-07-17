import type { IHttpRequestOptions, IN8nHttpFullResponse } from 'n8n-workflow';

export const URL_BUFFER_FALLBACK_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type HttpRequest = (options: IHttpRequestOptions) => Promise<unknown>;

export interface MultipartSource {
	name: string;
	size: number;
	type: string;
	createBody(start: number, endExclusive: number): Buffer | Promise<Buffer>;
}

export interface BinaryDescriptor {
	name: string;
	size: number;
	type: string;
	id?: string;
	inline?: Buffer;
}

export interface BinarySourceHelpers {
	getBinaryStream(id: string, chunkSize?: number): Promise<AsyncIterable<Uint8Array>>;
}

export interface PreparedSource {
	source: MultipartSource;
	concurrency: number;
}

function ipv4IsPrivate(address: string) {
	const parts = address.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return true;
	}
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && (b === 0 || b === 168)) ||
		(a === 198 && (b === 18 || b === 19 || b === 51)) ||
		(a === 203 && b === 0) ||
		a >= 224
	);
}

export function addressIsPrivate(address: string) {
	const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
	if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return ipv4IsPrivate(normalized);
	if (!normalized.includes(':')) return false;
	if (normalized === '::' || normalized === '::1') return true;
	if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
	if (/^fe[89ab]/.test(normalized)) return true;
	if (normalized.startsWith('2001:db8:')) return true;
	const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	return mapped ? ipv4IsPrivate(mapped) : false;
}

export function assertPublicHttpsUrl(value: string) {
	if (!URL.canParse(value)) throw new Error('Source URL must be a valid HTTPS URL.');
	const url = new URL(value);
	if (url.protocol !== 'https:') throw new Error('Source URL must use HTTPS.');
	if (url.username || url.password) throw new Error('Source URL must not contain credentials.');
	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal') ||
		addressIsPrivate(hostname)
	) {
		throw new Error('Source URL must not point to a private, local, or reserved network address.');
	}
	return url;
}

function fullResponse(value: unknown) {
	return value as IN8nHttpFullResponse;
}

async function safeRequest(request: HttpRequest, input: string | URL, options: IHttpRequestOptions) {
	let url = assertPublicHttpsUrl(String(input));
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
		const response = fullResponse(
			await request({
				...options,
				url: url.toString(),
				disableFollowRedirect: true,
				ignoreHttpStatusErrors: true,
				returnFullResponse: true,
				sendCredentialsOnCrossOriginRedirect: false,
			}),
		);
		if (![301, 302, 303, 307, 308].includes(response.statusCode)) return response;
		const location = String(response.headers.location ?? '');
		if (!location) throw new Error('Source URL redirected without a Location header.');
		if (redirect === MAX_REDIRECTS) throw new Error('Source URL redirected too many times.');
		url = assertPublicHttpsUrl(new URL(location, url).toString());
	}
	throw new Error('Source URL redirected too many times.');
}

function filenameFromDisposition(value: string | undefined) {
	if (!value) return undefined;
	const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
	if (encoded) {
		try {
			return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
		} catch {
			return encoded.replace(/^"|"$/g, '');
		}
	}
	return value.match(/filename="([^"]+)"/i)?.[1] ?? value.match(/filename=([^;]+)/i)?.[1]?.trim();
}

function filenameFromUrl(url: URL) {
	const segment = url.pathname.split('/').filter(Boolean).at(-1);
	if (!segment) return 'file';
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

function parseContentRange(value: string | undefined) {
	const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
	if (!match) return undefined;
	return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function asBuffer(value: unknown) {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new Error('HTTP response did not contain binary data.');
}

class SequentialRangeReader {
	private iterator?: AsyncIterator<Uint8Array>;
	private stash: Buffer = Buffer.alloc(0);
	private cursor = 0;
	private last?: { start: number; end: number; data: Buffer };

	constructor(
		private readonly open: () => Promise<AsyncIterable<Uint8Array>>,
		private readonly signal?: AbortSignal,
	) {}

	private async nextChunk() {
		this.signal?.throwIfAborted();
		this.iterator ??= (await this.open())[Symbol.asyncIterator]();
		const next = await this.iterator.next();
		if (next.done) return false;
		this.stash = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
		return true;
	}

	private async take(length: number, collect: boolean) {
		const parts: Buffer[] = [];
		let remaining = length;
		while (remaining > 0) {
			this.signal?.throwIfAborted();
			if (this.stash.length === 0 && !(await this.nextChunk())) {
				throw new Error('n8n binary data ended before its declared size.');
			}
			const count = Math.min(remaining, this.stash.length);
			if (collect) parts.push(this.stash.subarray(0, count));
			this.stash = this.stash.subarray(count);
			this.cursor += count;
			remaining -= count;
		}
		if (!collect) return Buffer.alloc(0);
		const output = Buffer.alloc(length);
		let offset = 0;
		for (const part of parts) {
			output.set(part, offset);
			offset += part.byteLength;
		}
		return output;
	}

	async read(start: number, end: number) {
		if (this.last?.start === start && this.last.end === end) return this.last.data;
		if (start < this.cursor) {
			throw new Error('n8n binary stream requested an already-consumed multipart range.');
		}
		if (start > this.cursor) await this.take(start - this.cursor, false);
		const data = await this.take(end - start, true);
		this.last = { start, end, data };
		return data;
	}
}

export function prepareBinarySource(
	descriptor: BinaryDescriptor,
	helpers: BinarySourceHelpers,
	signal?: AbortSignal,
): PreparedSource {
	if (descriptor.inline) {
		return {
			concurrency: 4,
			source: {
				name: descriptor.name,
				size: descriptor.size,
				type: descriptor.type,
				createBody: (start, end) => descriptor.inline!.subarray(start, end),
			},
		};
	}
	if (!descriptor.id) throw new Error('n8n binary data has neither an inline body nor a storage ID.');
	const reader = new SequentialRangeReader(() => helpers.getBinaryStream(descriptor.id!), signal);
	return {
		concurrency: 1,
		source: {
			name: descriptor.name,
			size: descriptor.size,
			type: descriptor.type,
			createBody: (start, end) => reader.read(start, end),
		},
	};
}

export async function prepareUrlSource(
	request: HttpRequest,
	value: string,
	overrides: { filename?: string; contentType?: string } = {},
	signal?: AbortSignal,
): Promise<PreparedSource> {
	const url = assertPublicHttpsUrl(value);
	const probe = await safeRequest(request, url, {
		url: url.toString(),
		method: 'GET',
		headers: { range: 'bytes=0-0' },
		encoding: 'arraybuffer',
		abortSignal: signal,
	});
	if (probe.statusCode < 200 || probe.statusCode >= 300) {
		throw new Error(`Source URL returned HTTP ${probe.statusCode}.`);
	}

	const contentType =
		overrides.contentType?.trim() || String(probe.headers['content-type'] ?? '') || 'application/octet-stream';
	const filename =
		overrides.filename?.trim() ||
		filenameFromDisposition(probe.headers['content-disposition'] as string | undefined) ||
		filenameFromUrl(url);
	const contentRange = parseContentRange(probe.headers['content-range'] as string | undefined);

	if (probe.statusCode === 206 && contentRange?.start === 0 && contentRange.end === 0) {
		return {
			concurrency: 4,
			source: {
				name: filename,
				size: contentRange.total,
				type: contentType,
				createBody: async (start, end) => {
					const response = await safeRequest(request, url, {
						url: url.toString(),
						method: 'GET',
						headers: { range: `bytes=${start}-${end - 1}` },
						encoding: 'arraybuffer',
						abortSignal: signal,
					});
					const range = parseContentRange(response.headers['content-range'] as string | undefined);
					if (
						response.statusCode !== 206 ||
						range?.start !== start ||
						range.end !== end - 1 ||
						range.total !== contentRange.total
					) {
						throw new Error('Source URL did not honor the requested byte range.');
					}
					const body = asBuffer(response.body);
					if (body.length !== end - start) throw new Error('Source URL returned an incomplete byte range.');
					return body;
				},
			},
		};
	}

	const declaredSize = Number(probe.headers['content-length']);
	if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > URL_BUFFER_FALLBACK_BYTES) {
		throw new Error('Source URL must support byte ranges, or declare a size of 64 MiB or less.');
	}
	const body = asBuffer(probe.body);
	if (body.length !== declaredSize) throw new Error('Source URL body does not match its declared size.');
	return prepareBinarySource(
		{ name: filename, size: body.length, type: contentType, inline: body },
		{
			getBinaryStream: async () => {
				throw new Error('Inline URL source does not use n8n binary storage.');
			},
		},
	);
}
