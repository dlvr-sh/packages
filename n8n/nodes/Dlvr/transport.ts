/* eslint-disable @n8n/community-nodes/require-node-api-error */
import type { IDataObject, IHttpRequestOptions, IN8nHttpFullResponse } from 'n8n-workflow';
import { sleepWithAbort } from 'n8n-workflow';
import type { HttpRequest, MultipartSource } from './sources';

export const DLVR_BASE_URL = 'https://dlvr.sh';
const RETRY_ATTEMPTS = 5;
const PART_WINDOW = 8;

export interface DlvrCredentials {
	apiKey: string;
}

export interface UploadSummary extends IDataObject {
	id: string;
	shareId: string;
	url: string;
	filename: string;
	size: number;
	expires: string;
	downloads: number;
	maxDownloads: number | null;
	passwordRequired: boolean;
	status: string;
	createdAt: string;
	uploadedAt: string | null;
	workspace?: { id: string; name?: string } | null;
}

export interface CliConfig {
	expiry?: { durationOptions?: Array<{ value: string; label: string; enabled: boolean }> };
	account?: { plan?: string; planName?: string };
	workspace?: { id: string; name?: string; role?: string } | null;
}

export interface UploadResult extends IDataObject {
	id: string;
	shareId?: string;
	url: string;
	expires: string;
	downloads: number;
	maxDownloads: number | null;
	passwordRequired: boolean;
	filename: string;
	size: number;
	files?: Array<{ id?: string; filename: string; size: number; contentType?: string }>;
	workspace?: { id: string; name?: string } | null;
}

interface MultipartFileSession {
	fileId: string;
	filename: string;
	size: number;
	contentType: string;
	partSize: number;
	partCount: number;
}

interface MultipartSession {
	protocolVersion: 2;
	uploadId: string;
	uploadToken: string;
	sessionExpiresAt: string;
	shareId: string;
	url: string;
	expiresAt: string;
	files: MultipartFileSession[];
}

interface SignedPart {
	partNumber: number;
	offset: number;
	size: number;
	uploadUrl: string;
	headers?: Record<string, string>;
}

export interface CreateDeliveryOptions {
	request: HttpRequest;
	credentials: DlvrCredentials;
	sources: MultipartSource[];
	duration?: string;
	expiresAt?: string;
	password?: string;
	maxDownloads?: number;
	notifyEmails?: string[];
	paidEnabled?: boolean;
	priceUsd?: number;
	taxCode?: string;
	idempotencyKey: string;
	concurrency: number;
	signal?: AbortSignal;
}

export class DlvrRequestError extends Error {
	status?: number;
	code?: string;
	details?: unknown;

	constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
		super(message);
		this.name = 'DlvrRequestError';
		Object.assign(this, options);
	}
}

function authorization(credentials: DlvrCredentials) {
	const key = credentials.apiKey?.trim();
	if (!key) throw new DlvrRequestError('A dlvr.sh API key is required.', { code: 'api_key_required' });
	return `Bearer ${key}`;
}

function fullResponse(value: unknown) {
	return value as IN8nHttpFullResponse;
}

function responseHeader(response: IN8nHttpFullResponse, name: string) {
	const value = response.headers[name] ?? response.headers[name.toLowerCase()];
	return Array.isArray(value) ? String(value[0] ?? '') : value == null ? undefined : String(value);
}

function retryable(status: number) {
	return status === 408 || status === 429 || status >= 500;
}

function delayFor(attempt: number, response?: IN8nHttpFullResponse) {
	const header = response ? responseHeader(response, 'retry-after') : undefined;
	if (header) {
		const seconds = Number(header);
		if (Number.isFinite(seconds)) return Math.max(0, Math.min(10_000, seconds * 1000));
	}
	return Math.min(10_000, 250 * 2 ** attempt);
}

async function requestWithRetry(
	request: HttpRequest,
	options: IHttpRequestOptions,
	signal?: AbortSignal,
) {
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
		let response: IN8nHttpFullResponse | undefined;
		try {
			response = fullResponse(
				await request({
					...options,
					abortSignal: signal,
					ignoreHttpStatusErrors: true,
					returnFullResponse: true,
					sendCredentialsOnCrossOriginRedirect: false,
				}),
			);
			if (!retryable(response.statusCode) || attempt === RETRY_ATTEMPTS - 1) return response;
		} catch (error) {
			if (attempt === RETRY_ATTEMPTS - 1) throw error;
		}
		await sleepWithAbort(delayFor(attempt, response), signal);
	}
	throw new DlvrRequestError('Request retry loop ended unexpectedly.');
}

function jsonBody(response: IN8nHttpFullResponse) {
	if (typeof response.body === 'string') {
		try {
			return JSON.parse(response.body) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return response.body && typeof response.body === 'object' ? (response.body as Record<string, unknown>) : null;
}

function requireSuccess<T>(response: IN8nHttpFullResponse) {
	const body = jsonBody(response) as ({ error?: string; message?: string; code?: string } & Record<string, unknown>) | null;
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new DlvrRequestError(body?.error || body?.message || `dlvr.sh returned HTTP ${response.statusCode}.`, {
			status: response.statusCode,
			code: body?.code,
			details: body,
		});
	}
	return body as T;
}

async function apiJson<T>(
	request: HttpRequest,
	credentials: DlvrCredentials,
	path: string,
	options: Omit<IHttpRequestOptions, 'url'> = {},
	signal?: AbortSignal,
	uploadToken?: string,
) {
	const headers: IDataObject = {
		authorization: authorization(credentials),
		...(uploadToken ? { 'x-dlvr-upload-token': uploadToken } : {}),
		...(options.headers ?? {}),
	};
	const response = await requestWithRetry(
		request,
		{
			...options,
			url: `${DLVR_BASE_URL}${path}`,
			headers,
			json: true,
			encoding: 'json',
		},
		signal,
	);
	return requireSuccess<T>(response);
}

function limiter(concurrency: number) {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async <T>(task: () => Promise<T>) => {
		if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
		active += 1;
		try {
			return await task();
		} finally {
			active -= 1;
			waiting.shift()?.();
		}
	};
}

async function uploadPart(
	options: CreateDeliveryOptions,
	session: MultipartSession,
	fileIndex: number,
	part: SignedPart,
) {
	const file = session.files[fileIndex]!;
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
		options.signal?.throwIfAborted();
		let current = part;
		if (attempt > 0) {
			const refreshed = await apiJson<{ parts: SignedPart[] }>(
				options.request,
				options.credentials,
				`/api/uploads/${encodeURIComponent(session.uploadId)}/files/${encodeURIComponent(file.fileId)}/parts`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: { partNumbers: [part.partNumber] },
				},
				options.signal,
				session.uploadToken,
			);
			current = refreshed.parts[0]!;
		}

		try {
			const body = await options.sources[fileIndex]!.createBody(current.offset, current.offset + current.size);
			const response = fullResponse(
				await options.request({
					url: current.uploadUrl,
					method: 'PUT',
					headers: { ...(current.headers ?? {}), 'content-length': String(current.size) },
					body,
					encoding: 'text',
					json: false,
					abortSignal: options.signal,
					ignoreHttpStatusErrors: true,
					returnFullResponse: true,
					sendCredentialsOnCrossOriginRedirect: false,
				}),
			);
			if (response.statusCode >= 200 && response.statusCode < 300) return;
			if (response.statusCode !== 403 && !retryable(response.statusCode)) {
				throw new DlvrRequestError('Upload to storage failed.', { status: response.statusCode });
			}
		} catch (error) {
			if (attempt === RETRY_ATTEMPTS - 1) throw error;
		}
		await sleepWithAbort(delayFor(attempt), options.signal);
	}
	throw new DlvrRequestError('Upload to storage failed after retrying.');
}

export async function getCliConfig(request: HttpRequest, credentials: DlvrCredentials, signal?: AbortSignal) {
	return apiJson<CliConfig>(request, credentials, '/api/cli/config', {}, signal);
}

export async function createDelivery(options: CreateDeliveryOptions): Promise<UploadResult> {
	if (options.sources.length === 0 || options.sources.length > 100) {
		throw new DlvrRequestError('A delivery must contain between 1 and 100 files.');
	}
	const session = await apiJson<MultipartSession>(
		options.request,
		options.credentials,
		'/api/uploads',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', 'idempotency-key': options.idempotencyKey },
			body: {
				files: options.sources.map((source) => ({
					filename: source.name,
					contentType: source.type,
					size: source.size,
				})),
				duration: options.duration,
				expiresAt: options.expiresAt,
				password: options.password,
				maxDownloads: options.maxDownloads,
				notifyEmails: options.notifyEmails,
				paidEnabled: options.paidEnabled,
				priceUsd: options.priceUsd,
				taxCode: options.taxCode,
			},
		},
		options.signal,
	);
	if (session.protocolVersion !== 2 || session.files.length !== options.sources.length) {
		throw new DlvrRequestError('dlvr.sh returned an incompatible multipart upload session.');
	}

	const limit = limiter(Math.max(1, Math.trunc(options.concurrency)));
	for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
		const file = session.files[fileIndex]!;
		const started = await apiJson<{ state: 'uploading' | 'ready' }>(
			options.request,
			options.credentials,
			`/api/uploads/${encodeURIComponent(session.uploadId)}/files/${encodeURIComponent(file.fileId)}/start`,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: {} },
			options.signal,
			session.uploadToken,
		);
		if (started.state === 'ready') continue;

		const listed = await apiJson<{ parts: Array<{ partNumber: number; size: number }> }>(
			options.request,
			options.credentials,
			`/api/uploads/${encodeURIComponent(session.uploadId)}/files/${encodeURIComponent(file.fileId)}/parts`,
			{ method: 'GET' },
			options.signal,
			session.uploadToken,
		);
		const present = new Set(listed.parts.map(({ partNumber }) => partNumber));
		const missing = Array.from({ length: file.partCount }, (_, index) => index + 1).filter(
			(partNumber) => !present.has(partNumber),
		);
		for (let offset = 0; offset < missing.length; offset += PART_WINDOW) {
			const partNumbers = missing.slice(offset, offset + PART_WINDOW);
			const signed = await apiJson<{ parts: SignedPart[] }>(
				options.request,
				options.credentials,
				`/api/uploads/${encodeURIComponent(session.uploadId)}/files/${encodeURIComponent(file.fileId)}/parts`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: { partNumbers },
				},
				options.signal,
				session.uploadToken,
			);
			await Promise.all(signed.parts.map((part) => limit(() => uploadPart(options, session, fileIndex, part))));
		}
		await apiJson(
			options.request,
			options.credentials,
			`/api/uploads/${encodeURIComponent(session.uploadId)}/files/${encodeURIComponent(file.fileId)}/complete`,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: {} },
			options.signal,
			session.uploadToken,
		);
	}

	return apiJson<UploadResult>(
		options.request,
		options.credentials,
		`/api/uploads/${encodeURIComponent(session.uploadId)}/complete`,
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: {} },
		options.signal,
		session.uploadToken,
	);
}

export async function listDeliveries(
	request: HttpRequest,
	credentials: DlvrCredentials,
	options: { limit?: number; offset?: number } = {},
	signal?: AbortSignal,
) {
	const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 100)));
	const offset = Math.max(0, Math.trunc(options.offset ?? 0));
	return apiJson<{ uploads: UploadSummary[]; nextOffset?: number | null }>(
		request,
		credentials,
		`/api/account/uploads?limit=${limit}&offset=${offset}`,
		{},
		signal,
	);
}

export async function getDelivery(request: HttpRequest, credentials: DlvrCredentials, id: string, signal?: AbortSignal) {
	return apiJson<{ upload: UploadSummary }>(
		request,
		credentials,
		`/api/account/uploads/${encodeURIComponent(id)}`,
		{},
		signal,
	);
}

export async function deleteDelivery(request: HttpRequest, credentials: DlvrCredentials, id: string, signal?: AbortSignal) {
	return apiJson<{ ok: boolean }>(
		request,
		credentials,
		`/api/account/uploads/${encodeURIComponent(id)}`,
		{ method: 'DELETE', headers: { 'content-type': 'application/json' } },
		signal,
	);
}

export function normalizeShareId(value: string) {
	const normalized = value.trim();
	if (!normalized) throw new DlvrRequestError('Share ID or URL is required.', { code: 'share_id_required' });
	try {
		const url = new URL(normalized);
		const match = url.pathname.match(/\/f\/([^/]+)/);
		if (!match?.[1]) throw new Error('not a share URL');
		return decodeURIComponent(match[1]);
	} catch {
		return normalized;
	}
}

export interface DownloadMetadata extends IDataObject {
	id: string;
	filename: string;
	size: number;
	fileCount: number;
	expires: string;
	passwordRequired: boolean;
	downloads: number;
	maxDownloads: number | null;
	remainingDownloads: number | null;
	files?: Array<{ fileId: string; filename: string; contentType: string; size: number }>;
}

function requireDownloadResponse(response: IN8nHttpFullResponse) {
	if (response.statusCode >= 200 && response.statusCode < 300) return response;
	const body = jsonBody(response) as { error?: string; message?: string; code?: string } | null;
	throw new DlvrRequestError(body?.error || body?.message || `Download returned HTTP ${response.statusCode}.`, {
		status: response.statusCode,
		code: body?.code ?? (response.statusCode === 402 ? 'payment_required' : undefined),
		details: body,
	});
}

export async function downloadShare(request: HttpRequest, value: string, password = '', signal?: AbortSignal) {
	const shareId = normalizeShareId(value);
	const encoded = encodeURIComponent(shareId);
	const metadataResponse = fullResponse(
		await request({
			url: `${DLVR_BASE_URL}/api/files/${encoded}`,
			method: 'GET',
			json: true,
			encoding: 'json',
			abortSignal: signal,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		}),
	);
	const metadata = requireSuccess<DownloadMetadata>(metadataResponse);

	let response: IN8nHttpFullResponse;
	let filename = metadata.filename;
	if (metadata.fileCount > 1) {
		const linksResponse = fullResponse(
			await request({
				url: `${DLVR_BASE_URL}/api/files/${encoded}/links`,
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: { password },
				json: true,
				encoding: 'json',
				abortSignal: signal,
				ignoreHttpStatusErrors: true,
				returnFullResponse: true,
			}),
		);
		const links = requireSuccess<{ zipUrl: string }>(linksResponse);
		response = fullResponse(
			await request({
				url: links.zipUrl,
				method: 'GET',
				encoding: 'stream',
				abortSignal: signal,
				ignoreHttpStatusErrors: true,
				returnFullResponse: true,
				sendCredentialsOnCrossOriginRedirect: false,
			}),
		);
		filename = `${metadata.filename || shareId}.zip`;
	} else {
		response = fullResponse(
			await request({
				url: `${DLVR_BASE_URL}/api/files/${encoded}/download`,
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: { password },
				json: true,
				encoding: 'stream',
				abortSignal: signal,
				ignoreHttpStatusErrors: true,
				returnFullResponse: true,
			}),
		);
	}

	return { metadata, filename, response: requireDownloadResponse(response) };
}
