import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DlvrMultipartSession } from "@dlvr/shared";
import type { NormalizedUploadOptions } from "./types";

interface StoredUpload {
  fingerprint: string;
  session: DlvrMultipartSession;
  updatedAt: string;
}

interface UploadStateFile {
  version: 1;
  uploads: StoredUpload[];
}

export function defaultUploadStatePath() {
  return join(homedir(), ".config", "dlvr", "uploads.json");
}

export function uploadFingerprint(options: NormalizedUploadOptions) {
  const material = JSON.stringify({
    version: 2,
    baseUrl: options.baseUrl,
    credential: options.apiKey?.trim() || null,
    files: options.files.map((file) => ({
      path: file.filePath,
      name: file.filename,
      size: file.fileSize,
      mtimeMs: file.mtimeMs,
    })),
    expiry: options.expiry,
    notifyEmails: [...options.emails].sort(),
    maxDownloads: options.maxDownloads ?? null,
    password: options.password ?? null,
  });
  return `v2:${createHash("sha256").update(material).digest("hex")}`;
}

async function load(path: string): Promise<UploadStateFile> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as UploadStateFile;
    return value.version === 1 && Array.isArray(value.uploads) ? value : { version: 1, uploads: [] };
  } catch {
    return { version: 1, uploads: [] };
  }
}

async function save(path: string, state: UploadStateFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function findUploadSession(fingerprint: string, path = defaultUploadStatePath()) {
  const state = await load(path);
  const match = state.uploads.find((upload) => upload.fingerprint === fingerprint);
  if (!match || Date.parse(match.session.sessionExpiresAt) <= Date.now()) return undefined;
  return match.session;
}

export async function storeUploadSession(fingerprint: string, session: DlvrMultipartSession, path = defaultUploadStatePath()) {
  const state = await load(path);
  state.uploads = state.uploads.filter((upload) =>
    upload.fingerprint !== fingerprint && Date.parse(upload.session.sessionExpiresAt) > Date.now()
  );
  state.uploads.push({ fingerprint, session, updatedAt: new Date().toISOString() });
  await save(path, state);
}

export async function removeUploadSession(fingerprint: string, path = defaultUploadStatePath()) {
  const state = await load(path);
  state.uploads = state.uploads.filter((upload) => upload.fingerprint !== fingerprint);
  await save(path, state);
}
