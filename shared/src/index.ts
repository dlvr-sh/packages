export const DLVR_API_KEY_ENV = "DLVR_API_KEY";
export const DLVR_DOWNLOAD_PASSWORD_ENV = "DLVR_DOWNLOAD_PASSWORD";
export const DLVR_API_AUTH_SCHEME = "Bearer";
export const DLVR_API_KEY_PREFIX = "dlvr_";

export const DLVR_MULTIPART_PROTOCOL_VERSION = 2 as const;
export const DLVR_DEFAULT_PART_SIZE = 64 * 1024 * 1024;
export const DLVR_DEFAULT_UPLOAD_CONCURRENCY = 4;
export const DLVR_DEFAULT_PRESIGN_WINDOW = 8;
export const DLVR_DEFAULT_RETRY_ATTEMPTS = 5;

export const DLVR_AUTH_ERROR_CODES = {
  missingApiKey: "api_key_required",
  invalidApiKey: "api_key_invalid",
  paidSubscriptionRequired: "paid_subscription_required",
  verifiedEmailRequired: "verified_email_required",
  permanentEmailRequired: "permanent_email_required",
  emailPolicyUnavailable: "email_policy_unavailable",
  accountMismatch: "api_key_account_mismatch",
} as const;

export type DlvrAuthErrorCode = (typeof DLVR_AUTH_ERROR_CODES)[keyof typeof DLVR_AUTH_ERROR_CODES];

export interface DlvrApiErrorBody {
  error: string;
  code?: string;
  [key: string]: unknown;
}

export interface DlvrUploadSummary {
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

export interface DlvrUploadResult {
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

export function buildAuthorizationHeader(apiKey?: string | null) {
  const normalized = apiKey?.trim();
  return normalized ? `${DLVR_API_AUTH_SCHEME} ${normalized}` : undefined;
}

export type DlvrFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DlvrRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function retryDelay(attempt: number, response: Response | undefined, options: DlvrRetryOptions) {
  const fromHeader = response ? retryAfterMs(response) : undefined;
  if (fromHeader !== undefined) return fromHeader;
  const base = Math.max(0, options.baseDelayMs ?? 250);
  const cap = Math.max(base, options.maxDelayMs ?? 10_000);
  return Math.floor((options.random ?? Math.random)() * Math.min(cap, base * 2 ** attempt));
}

/** Retry a request whose callback creates a fresh body on every invocation. */
export async function retryUploadRequest(
  request: () => Promise<Response>,
  options: DlvrRetryOptions = {},
) {
  const requestedAttempts = options.attempts ?? DLVR_DEFAULT_RETRY_ATTEMPTS;
  const attempts = Number.isFinite(requestedAttempts) ? Math.max(1, Math.trunc(requestedAttempts)) : DLVR_DEFAULT_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await request();
      if (!isRetryableStatus(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
    await sleep(retryDelay(attempt, response, options));
  }
  throw new Error("Upload retry loop exhausted unexpectedly.");
}

export interface DlvrMultipartSource {
  name: string;
  size: number;
  type?: string;
  /** Must return a new body for every call so retries never reuse a consumed stream. */
  createBody(start: number, endExclusive: number): BodyInit | Promise<BodyInit>;
}

export interface DlvrMultipartFileSession {
  fileId: string;
  filename: string;
  size: number;
  contentType: string;
  partSize: number;
  partCount: number;
}

export interface DlvrMultipartSession {
  protocolVersion: 2;
  uploadId: string;
  uploadToken: string;
  sessionExpiresAt: string;
  shareId: string;
  url: string;
  expiresAt: string;
  files: DlvrMultipartFileSession[];
  /** Stable across retries and persisted resumes. */
  idempotencyKey: string;
  workspace?: { id: string; name?: string } | null;
}

export interface DlvrUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  fileIndex: number;
  fileId: string;
  filename: string;
  fileUploadedBytes: number;
  fileSize: number;
  partNumber?: number;
}

export interface DlvrMultipartOptions {
  baseUrl: string;
  apiKey?: string;
  files: DlvrMultipartSource[];
  duration?: string;
  expiresAt?: string;
  password?: string;
  maxDownloads?: number;
  notifyEmails?: string[];
  /** Optional connected-seller settings for a paid transfer. */
  paidEnabled?: boolean;
  priceUsd?: number;
  taxCode?: string;
  turnstileToken?: string;
  /** Extra headers sent only to dlvr API routes, never to storage URLs. */
  requestHeaders?: Record<string, string>;
  idempotencyKey?: string;
  concurrency?: number;
  windowSize?: number;
  retry?: DlvrRetryOptions;
  signal?: AbortSignal;
  fetch?: DlvrFetch;
  onSession?: (session: DlvrMultipartSession) => void | Promise<void>;
  onProgress?: (progress: DlvrUploadProgress) => void;
  /** Optional per-byte transport. Its headers must be used exactly as supplied. */
  uploadPart?: (part: {
    uploadUrl: string;
    headers: Record<string, string>;
    body: BodyInit;
    size: number;
    signal?: AbortSignal;
    onProgress: (uploadedBytes: number) => void;
  }) => Promise<Response>;
}

export interface DlvrResumeMultipartOptions extends DlvrMultipartOptions {
  session: DlvrMultipartSession;
}

export class DlvrProtocolError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "DlvrProtocolError";
    Object.assign(this, options);
  }
}

function normalizedBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function randomIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (DlvrApiErrorBody & { message?: string }) | null;
  if (!response.ok) {
    throw new DlvrProtocolError(body?.error || body?.message || `Request failed with status ${response.status}`, {
      status: response.status,
      code: body?.code,
      details: body,
    });
  }
  return body as T;
}

function apiHeaders(apiKey: string | undefined, uploadToken?: string, extra: Record<string, string> = {}, requestHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...requestHeaders, ...extra };
  const authorization = buildAuthorizationHeader(apiKey);
  if (authorization) headers.authorization = authorization;
  if (uploadToken) headers["X-Dlvr-Upload-Token"] = uploadToken;
  return headers;
}

async function apiRequest<T>(
  fetchImpl: DlvrFetch,
  url: string,
  init: RequestInit,
  retry: DlvrRetryOptions,
) {
  const response = await retryUploadRequest(() => fetchImpl(url, init), retry);
  return parseJson<T>(response);
}

function assertSourcesMatch(session: DlvrMultipartSession, sources: DlvrMultipartSource[]) {
  if (session.protocolVersion !== DLVR_MULTIPART_PROTOCOL_VERSION) {
    throw new DlvrProtocolError(`Unsupported upload protocol version: ${session.protocolVersion}`);
  }
  if (session.files.length !== sources.length) throw new DlvrProtocolError("Resume files do not match the upload session.");
  session.files.forEach((file, index) => {
    const source = sources[index];
    if (!source || source.name !== file.filename || source.size !== file.size) {
      throw new DlvrProtocolError(`Resume file ${index + 1} does not match the upload session.`);
    }
  });
}

async function createSession(options: DlvrMultipartOptions, fetchImpl: DlvrFetch, retry: DlvrRetryOptions) {
  if (options.files.length === 0 || options.files.length > 100) {
    throw new DlvrProtocolError("Upload must contain between 1 and 100 files.");
  }
  const idempotencyKey = options.idempotencyKey || randomIdempotencyKey();
  // Turnstile response tokens are single-use. Retrying session creation with the
  // same browser token hides the original failure behind a duplicate-token 403.
  const createRetry = options.turnstileToken ? { ...retry, attempts: 1 } : retry;
  const response = await apiRequest<Omit<DlvrMultipartSession, "idempotencyKey">>(
    fetchImpl,
    `${normalizedBaseUrl(options.baseUrl)}/api/uploads`,
    {
      method: "POST",
      headers: apiHeaders(options.apiKey, undefined, {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      }, options.requestHeaders),
      body: JSON.stringify({
        files: options.files.map((file) => ({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        })),
        duration: options.duration,
        expiresAt: options.expiresAt,
        password: options.password,
        maxDownloads: options.maxDownloads,
        notifyEmails: options.notifyEmails,
        paidEnabled: options.paidEnabled,
        priceUsd: options.priceUsd,
        taxCode: options.taxCode,
        turnstileToken: options.turnstileToken,
      }),
      signal: options.signal,
    },
    createRetry,
  );
  const session = { ...response, idempotencyKey } as DlvrMultipartSession;
  assertSourcesMatch(session, options.files);
  await options.onSession?.(session);
  return session;
}

function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>) => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try { return await task(); }
    finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

interface SignedPart {
  partNumber: number;
  offset: number;
  size: number;
  uploadUrl: string;
  headers?: Record<string, string>;
}

interface MultipartFileStart {
  fileId: string;
  state: "uploading" | "ready";
  partSize: number;
  partCount: number;
}

async function runMultipart(session: DlvrMultipartSession, options: DlvrMultipartOptions, fetchImpl: DlvrFetch) {
  assertSourcesMatch(session, options.files);
  const retry = { attempts: DLVR_DEFAULT_RETRY_ATTEMPTS, ...options.retry };
  const requestedWindow = options.windowSize ?? DLVR_DEFAULT_PRESIGN_WINDOW;
  const windowSize = Number.isFinite(requestedWindow) ? Math.min(8, Math.max(1, Math.trunc(requestedWindow))) : DLVR_DEFAULT_PRESIGN_WINDOW;
  const requestedConcurrency = options.concurrency ?? DLVR_DEFAULT_UPLOAD_CONCURRENCY;
  const concurrency = Number.isFinite(requestedConcurrency) ? Math.max(1, Math.trunc(requestedConcurrency)) : DLVR_DEFAULT_UPLOAD_CONCURRENCY;
  const limit = createLimiter(concurrency);
  const base = `${normalizedBaseUrl(options.baseUrl)}/api/uploads/${encodeURIComponent(session.uploadId)}`;
  const headers = apiHeaders(options.apiKey, session.uploadToken, { "content-type": "application/json" }, options.requestHeaders);
  const completed = new Set<string>();
  const completedBytes = new Map<number, number>();
  const inFlightBytes = new Map<string, number>();
  const lastFileReported = new Map<number, number>();
  let lastAggregateReported = 0;
  const totalBytes = options.files.reduce((total, file) => total + file.size, 0);

  const report = (fileIndex: number, partNumber?: number) => {
    const file = session.files[fileIndex]!;
    const stable = completedBytes.get(fileIndex) ?? 0;
    let currentFile = stable;
    let aggregate = 0;
    for (const bytes of completedBytes.values()) aggregate += bytes;
    for (const [key, bytes] of inFlightBytes) {
      aggregate += bytes;
      if (key.startsWith(`${fileIndex}:`)) currentFile += bytes;
    }
    lastAggregateReported = Math.max(lastAggregateReported, Math.min(totalBytes, aggregate));
    const fileReported = Math.max(lastFileReported.get(fileIndex) ?? 0, Math.min(file.size, currentFile));
    lastFileReported.set(fileIndex, fileReported);
    options.onProgress?.({
      uploadedBytes: lastAggregateReported,
      totalBytes,
      fileIndex,
      fileId: file.fileId,
      filename: file.filename,
      fileUploadedBytes: fileReported,
      fileSize: file.size,
      partNumber,
    });
  };

  const uploadOne = async (fileIndex: number, signed: SignedPart) => {
    const source = options.files[fileIndex]!;
    const key = `${fileIndex}:${signed.partNumber}`;
    const requestedUploadAttempts = retry.attempts ?? DLVR_DEFAULT_RETRY_ATTEMPTS;
    const uploadAttempts = Number.isFinite(requestedUploadAttempts)
      ? Math.max(1, Math.trunc(requestedUploadAttempts))
      : DLVR_DEFAULT_RETRY_ATTEMPTS;
    for (let attempt = 0; attempt < uploadAttempts; attempt += 1) {
      options.signal?.throwIfAborted();
      let current = signed;
      if (attempt > 0) {
        const refreshed = await apiRequest<{ parts: SignedPart[] }>(fetchImpl, `${base}/files/${encodeURIComponent(session.files[fileIndex]!.fileId)}/parts`, {
          method: "POST", headers, body: JSON.stringify({ partNumbers: [signed.partNumber] }), signal: options.signal,
        }, retry);
        current = refreshed.parts[0]!;
      }
      const body = await source.createBody(current.offset, current.offset + current.size);
      let response: Response;
      try {
        response = options.uploadPart
          ? await options.uploadPart({
              uploadUrl: current.uploadUrl,
              headers: current.headers ?? {},
              body,
              size: current.size,
              signal: options.signal,
              onProgress: (bytes) => {
                inFlightBytes.set(key, Math.max(inFlightBytes.get(key) ?? 0, Math.min(current.size, bytes)));
                report(fileIndex, current.partNumber);
              },
            })
          : await fetchImpl(current.uploadUrl, {
              method: "PUT",
              // Browsers derive this from Blob bodies; streamed Node/Bun clients
              // must provide it because S3-compatible stores reject chunked PUTs.
              headers: { ...current.headers, "content-length": String(current.size) },
              body,
              signal: options.signal,
              // Node fetch requires duplex for stream bodies; browsers ignore this extension.
              ...({ duplex: "half" } as RequestInit),
            });
      } catch (error) {
        inFlightBytes.delete(key);
        if (attempt + 1 >= uploadAttempts) throw error;
        await (retry.sleep ?? defaultSleep)(retryDelay(attempt, undefined, retry));
        continue;
      }
      if (response.ok) {
        inFlightBytes.delete(key);
        if (!completed.has(key)) {
          completed.add(key);
          completedBytes.set(fileIndex, (completedBytes.get(fileIndex) ?? 0) + current.size);
        }
        report(fileIndex, current.partNumber);
        return;
      }
      inFlightBytes.delete(key);
      const renewable = response.status === 403;
      if ((!renewable && !isRetryableStatus(response.status)) || attempt + 1 >= uploadAttempts) {
        throw new DlvrProtocolError("Upload to storage failed.", { status: response.status });
      }
      await response.body?.cancel().catch(() => undefined);
      await (retry.sleep ?? defaultSleep)(retryDelay(attempt, response, retry));
    }
  };

  // Keep the presigned URL window global: finish one file's current window before
  // announcing parts for the next file. PUT concurrency remains global within it.
  for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
    const file = session.files[fileIndex]!;
    const started = await apiRequest<MultipartFileStart>(fetchImpl, `${base}/files/${encodeURIComponent(file.fileId)}/start`, {
      method: "POST", headers, body: "{}", signal: options.signal,
    }, retry);
    if (started.state === "ready") {
      completedBytes.set(fileIndex, file.size);
      for (let partNumber = 1; partNumber <= file.partCount; partNumber += 1) {
        completed.add(`${fileIndex}:${partNumber}`);
      }
      report(fileIndex);
      continue;
    }
    const listed = await apiRequest<{ parts: Array<{ partNumber: number; size: number }> }>(fetchImpl, `${base}/files/${encodeURIComponent(file.fileId)}/parts`, {
      method: "GET", headers: apiHeaders(options.apiKey, session.uploadToken, {}, options.requestHeaders), signal: options.signal,
    }, retry);
    const present = new Set(listed.parts.map((part) => part.partNumber));
    const resumedBytes = listed.parts.reduce((sum, part) => sum + part.size, 0);
    completedBytes.set(fileIndex, resumedBytes);
    for (const part of listed.parts) completed.add(`${fileIndex}:${part.partNumber}`);
    report(fileIndex);

    const missing = Array.from({ length: file.partCount }, (_, index) => index + 1).filter((part) => !present.has(part));
    for (let offset = 0; offset < missing.length; offset += windowSize) {
      const partNumbers = missing.slice(offset, offset + windowSize);
      const signed = await apiRequest<{ parts: SignedPart[] }>(fetchImpl, `${base}/files/${encodeURIComponent(file.fileId)}/parts`, {
        method: "POST", headers, body: JSON.stringify({ partNumbers }), signal: options.signal,
      }, retry);
      await Promise.all(signed.parts.map((part) => limit(() => uploadOne(fileIndex, part))));
    }
    await apiRequest(fetchImpl, `${base}/files/${encodeURIComponent(file.fileId)}/complete`, {
      method: "POST", headers, body: "{}", signal: options.signal,
    }, retry);
  }

  return apiRequest<DlvrUploadResult>(fetchImpl, `${base}/complete`, {
    method: "POST", headers, body: "{}", signal: options.signal,
  }, retry);
}

export async function uploadDlvrMultipart(options: DlvrMultipartOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const retry = { attempts: DLVR_DEFAULT_RETRY_ATTEMPTS, ...options.retry };
  const session = await createSession(options, fetchImpl, retry);
  return runMultipart(session, options, fetchImpl);
}

export async function resumeDlvrMultipart(options: DlvrResumeMultipartOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  await options.onSession?.(options.session);
  return runMultipart(options.session, options, fetchImpl);
}

export async function cancelDlvrMultipart(options: {
  baseUrl: string;
  apiKey?: string;
  session: DlvrMultipartSession;
  fetch?: DlvrFetch;
  signal?: AbortSignal;
  retry?: DlvrRetryOptions;
  requestHeaders?: Record<string, string>;
}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  return apiRequest<{ ok: true; state: "aborted" }>(
    fetchImpl,
    `${normalizedBaseUrl(options.baseUrl)}/api/uploads/${encodeURIComponent(options.session.uploadId)}`,
    {
      method: "DELETE",
      headers: apiHeaders(options.apiKey, options.session.uploadToken, { "content-type": "application/json" }, options.requestHeaders),
      signal: options.signal,
    },
    { attempts: DLVR_DEFAULT_RETRY_ATTEMPTS, ...options.retry },
  );
}
