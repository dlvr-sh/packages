import {
  buildAuthorizationHeader,
  cancelDlvrMultipart,
  resumeDlvrMultipart,
  uploadDlvrMultipart,
} from "@dlvr/shared";

export const DEFAULT_DLVR_BASE_URL = "https://dlvr.sh";

export type DlvrFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DlvrRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

export interface DlvrUploadFileSession {
  fileId: string;
  filename: string;
  size: number;
  contentType: string;
  partSize: number;
  partCount: number;
}

export interface DlvrUploadSession {
  protocolVersion: 2;
  uploadId: string;
  uploadToken: string;
  sessionExpiresAt: string;
  shareId: string;
  url: string;
  expiresAt: string;
  files: DlvrUploadFileSession[];
  idempotencyKey: string;
  workspace?: { id: string; name?: string } | null;
}

type DlvrMultipartSession = DlvrUploadSession;

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

export interface DlvrClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: DlvrFetch;
  uploadRetry?: DlvrRetryOptions;
}

export interface DlvrLoginOptions {
  baseUrl?: string;
  redirectTo?: string | URL;
  window?: Pick<Window, "location">;
}

export interface DlvrFileInput {
  file: Blob;
  filename?: string;
  contentType?: string;
}

export interface DlvrDeliveryOptions {
  duration?: string;
  expiresAt?: string | Date;
  password?: string;
  maxDownloads?: number;
  notifyEmails?: string[];
  paidEnabled?: boolean;
  priceUsd?: number;
  taxCode?: string;
}

export interface DlvrTransferOptions extends DlvrDeliveryOptions {
  files: DlvrFileInput[];
  idempotencyKey?: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DlvrUploadProgress) => void;
  onSession?: (session: DlvrMultipartSession) => void | Promise<void>;
}

export interface DlvrUploadOptions extends DlvrDeliveryOptions, DlvrFileInput {
  idempotencyKey?: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DlvrUploadProgress) => void;
  onSession?: (session: DlvrMultipartSession) => void | Promise<void>;
}

export interface DlvrResumeOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DlvrUploadProgress) => void;
  onSession?: (session: DlvrMultipartSession) => void | Promise<void>;
}

export interface DlvrDownloadOptions {
  shareId: string;
  password?: string;
  signal?: AbortSignal;
}

export class DlvrApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "DlvrApiError";
    Object.assign(this, options);
  }
}

function normalizeBaseUrl(value = DEFAULT_DLVR_BASE_URL) {
  return value.replace(/\/+$/, "");
}

function authHeaders(apiKey?: string, extra: Record<string, string> = {}) {
  const authorization = buildAuthorizationHeader(apiKey);
  return authorization ? { ...extra, authorization } : extra;
}

function requireApiKey(apiKey?: string) {
  if (!apiKey?.trim()) {
    throw new DlvrApiError("API key required. Create one at https://dlvr.sh/account/api/.", {
      code: "api_key_required",
    });
  }
  return apiKey.trim();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string; code?: string } | null;
  if (!response.ok) {
    throw new DlvrApiError(body?.error || body?.message || `Request failed with status ${response.status}`, {
      status: response.status,
      code: body?.code,
      details: body,
    });
  }
  return body as T;
}

async function requireDownloadResponse(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as { error?: string; message?: string; code?: string } | null;
  throw new DlvrApiError(body?.error || body?.message || `Download failed with status ${response.status}`, {
    status: response.status,
    code: body?.code,
    details: body,
  });
}

function normalizeExpiry(options: DlvrDeliveryOptions) {
  if (options.duration && options.expiresAt) throw new DlvrApiError("Use duration or expiresAt, not both.");
  return {
    duration: options.duration,
    expiresAt: options.expiresAt instanceof Date ? options.expiresAt.toISOString() : options.expiresAt,
  };
}

function filenameOf(input: DlvrFileInput) {
  const named = input.file as Blob & { name?: string };
  return input.filename?.trim() || named.name?.trim() || "file";
}

function multipartFiles(files: DlvrFileInput[]) {
  return files.map((input) => ({
    name: filenameOf(input),
    size: input.file.size,
    type: input.contentType || input.file.type || "application/octet-stream",
    createBody: (start: number, endExclusive: number) => input.file.slice(start, endExclusive),
  }));
}

export function getDlvrLoginUrl(options: DlvrLoginOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const loginUrl = new URL("/login/", baseUrl);
  const redirectTo = options.redirectTo ?? "/account/api/";
  const redirectUrl = typeof redirectTo === "string" ? new URL(redirectTo, baseUrl) : redirectTo;
  if (redirectUrl.origin !== new URL(baseUrl).origin) throw new DlvrApiError("dlvr.sh login redirects must stay on dlvr.sh.");
  loginUrl.searchParams.set("redirect", `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`);
  return loginUrl.toString();
}

export function loginWithDlvr(options: DlvrLoginOptions = {}) {
  const targetWindow = options.window ?? globalThis.window;
  if (!targetWindow?.location) throw new DlvrApiError("loginWithDlvr requires a browser window.");
  targetWindow.location.assign(getDlvrLoginUrl(options));
}

export function createDlvrClient(options: DlvrClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const key = () => requireApiKey(options.apiKey);

  const uploadFiles = async (uploadOptions: DlvrTransferOptions): Promise<DlvrUploadResult> => {
    const expiry = normalizeExpiry(uploadOptions);
    return uploadDlvrMultipart({
      baseUrl,
      apiKey: key(),
      fetch: fetchImpl,
      files: multipartFiles(uploadOptions.files),
      duration: expiry.duration,
      expiresAt: expiry.expiresAt,
      password: uploadOptions.password,
      maxDownloads: uploadOptions.maxDownloads,
      notifyEmails: uploadOptions.notifyEmails,
      paidEnabled: uploadOptions.paidEnabled,
      priceUsd: uploadOptions.priceUsd,
      taxCode: uploadOptions.taxCode,
      idempotencyKey: uploadOptions.idempotencyKey,
      concurrency: uploadOptions.concurrency,
      retry: options.uploadRetry,
      signal: uploadOptions.signal,
      onProgress: uploadOptions.onProgress,
      onSession: uploadOptions.onSession,
    });
  };

  return {
    getLoginUrl: (loginOptions: Omit<DlvrLoginOptions, "baseUrl"> = {}) => getDlvrLoginUrl({ ...loginOptions, baseUrl }),
    login: (loginOptions: Omit<DlvrLoginOptions, "baseUrl"> = {}) => loginWithDlvr({ ...loginOptions, baseUrl }),

    uploadFiles,

    uploadFile: (uploadOptions: DlvrUploadOptions) => {
      const { file, filename, contentType, ...transfer } = uploadOptions;
      return uploadFiles({ ...transfer, files: [{ file, filename, contentType }] });
    },

    resumeUpload: (session: DlvrMultipartSession, files: DlvrFileInput[], resumeOptions: DlvrResumeOptions = {}): Promise<DlvrUploadResult> =>
      resumeDlvrMultipart({
        baseUrl,
        apiKey: key(),
        fetch: fetchImpl,
        files: multipartFiles(files),
        session,
        concurrency: resumeOptions.concurrency,
        retry: options.uploadRetry,
        signal: resumeOptions.signal,
        onProgress: resumeOptions.onProgress,
        onSession: resumeOptions.onSession,
      }),

    cancelUpload: (session: DlvrMultipartSession, signal?: AbortSignal): Promise<{ ok: true; state: "aborted" }> =>
      cancelDlvrMultipart({ baseUrl, apiKey: key(), fetch: fetchImpl, session, signal, retry: options.uploadRetry }),

    downloadFile: async (downloadOptions: DlvrDownloadOptions): Promise<Response> => {
      const shareId = downloadOptions.shareId.trim();
      if (!shareId) throw new DlvrApiError("shareId is required.", { code: "share_id_required" });
      const encodedShareId = encodeURIComponent(shareId);
      const requestOptions = { credentials: "include" as const, signal: downloadOptions.signal };
      const metadataResponse = await fetchImpl(`${baseUrl}/api/files/${encodedShareId}`, requestOptions);
      const metadata = await parseResponse<{ fileCount: number }>(metadataResponse);

      if (metadata.fileCount > 1) {
        const linksResponse = await fetchImpl(`${baseUrl}/api/files/${encodedShareId}/links`, {
          ...requestOptions,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: downloadOptions.password ?? "" }),
        });
        const links = await parseResponse<{ zipUrl: string }>(linksResponse);
        return requireDownloadResponse(await fetchImpl(links.zipUrl, requestOptions));
      }

      return requireDownloadResponse(await fetchImpl(`${baseUrl}/api/files/${encodedShareId}/download`, {
        ...requestOptions,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: downloadOptions.password ?? "" }),
      }));
    },

    listUploads: async () => {
      const response = await fetchImpl(`${baseUrl}/api/account/uploads`, { headers: authHeaders(key()) });
      return parseResponse<{ uploads: DlvrUploadSummary[] }>(response);
    },

    getUpload: async (id: string) => {
      const response = await fetchImpl(`${baseUrl}/api/account/uploads/${encodeURIComponent(id)}`, { headers: authHeaders(key()) });
      return parseResponse<{ upload: DlvrUploadSummary }>(response);
    },

    deleteUpload: async (id: string) => {
      const response = await fetchImpl(`${baseUrl}/api/account/uploads/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(key(), { "content-type": "application/json" }),
      });
      return parseResponse<{ ok: boolean }>(response);
    },
  };
}
