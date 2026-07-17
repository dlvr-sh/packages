import { createReadStream } from "node:fs";
import {
  DlvrProtocolError,
  resumeDlvrMultipart,
  uploadDlvrMultipart,
  type DlvrFetch,
  type DlvrMultipartSession,
  type DlvrRetryOptions,
  type DlvrUploadProgress,
} from "@dlvr/shared";
import { findUploadSession, removeUploadSession, storeUploadSession, uploadFingerprint } from "./upload-state";
import type { CliErrorShape, NormalizedUploadOptions, UploadResult } from "./types";

type UploadCreateReadStream = (path: string, options: { start: number; end: number }) => BodyInit;

interface UploadDeps {
  fetch?: DlvrFetch;
  createReadStream?: UploadCreateReadStream;
  sleep?: (delayMs: number) => Promise<void>;
  findSession?: (fingerprint: string) => Promise<DlvrMultipartSession | undefined>;
  storeSession?: (fingerprint: string, session: DlvrMultipartSession) => Promise<void>;
  removeSession?: (fingerprint: string) => Promise<void>;
  onProgress?: (progress: DlvrUploadProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

export class CliError extends Error {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, options: { status?: number; code?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "CliError";
    Object.assign(this, options);
  }
}

export async function uploadFiles(options: NormalizedUploadOptions, deps: UploadDeps = {}): Promise<UploadResult> {
  const fingerprint = uploadFingerprint(options);
  const stream = deps.createReadStream ?? ((path, range) => createReadStream(path, range) as unknown as BodyInit);
  const files = options.files.map((file) => ({
    name: file.filename,
    size: file.fileSize,
    type: "application/octet-stream",
    createBody: (start: number, endExclusive: number) => stream(file.filePath, { start, end: endExclusive - 1 }),
  }));
  const retry: DlvrRetryOptions = { sleep: deps.sleep };
  const common = {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    fetch: deps.fetch,
    files,
    retry,
    signal: deps.signal,
    concurrency: deps.concurrency,
    onProgress: deps.onProgress,
    onSession: async (session: DlvrMultipartSession) => {
      await (deps.storeSession ?? storeUploadSession)(fingerprint, session);
    },
  };

  try {
    const session = await (deps.findSession ?? findUploadSession)(fingerprint);
    const result = session
      ? await resumeDlvrMultipart({ ...common, session })
      : await uploadDlvrMultipart({
          ...common,
          duration: options.expiry.kind === "duration" ? options.expiry.duration : undefined,
          expiresAt: options.expiry.kind === "fixedDate" ? options.expiry.expiresAt : undefined,
          password: options.password,
          maxDownloads: options.maxDownloads,
          notifyEmails: options.emails,
        });
    await (deps.removeSession ?? removeUploadSession)(fingerprint);
    return result;
  } catch (error) {
    if (error instanceof DlvrProtocolError) {
      throw new CliError(error.message, {
        status: error.status,
        code: error.code,
        details: error.details as Record<string, unknown> | undefined,
      });
    }
    throw error;
  }
}

export function toCliErrorShape(error: unknown): CliErrorShape {
  if (error instanceof CliError) {
    return { message: error.message, error: error.message, status: error.status, code: error.code, details: error.details };
  }
  if (error instanceof Error) return { message: error.message, error: error.message };
  return { message: "Unknown error", error: "Unknown error" };
}
