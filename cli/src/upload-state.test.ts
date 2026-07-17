import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DlvrMultipartSession } from "@dlvr/shared";
import type { NormalizedUploadOptions } from "./types";
import { findUploadSession, storeUploadSession, uploadFingerprint } from "./upload-state";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const options: NormalizedUploadOptions = {
  files: [{
    filePath: "/private/tmp/artifact.zip",
    filename: "artifact.zip",
    fileSize: 42,
    mtimeMs: 1234,
  }],
  emails: ["team@example.com"],
  password: "download-secret",
  maxDownloads: 5,
  baseUrl: "https://dlvr.sh",
  apiKey: "dlvr_private_api_key",
  json: false,
  quiet: false,
  expiry: { kind: "duration", duration: "24h" },
};

const session: DlvrMultipartSession = {
  protocolVersion: 2,
  uploadId: "upload-1",
  uploadToken: "upload-capability",
  sessionExpiresAt: "2099-01-01T00:00:00.000Z",
  shareId: "share-1",
  url: "https://dlvr.sh/f/share-1/",
  expiresAt: "2099-01-02T00:00:00.000Z",
  idempotencyKey: "idempotency-1",
  files: [{
    fileId: "file-1",
    filename: "artifact.zip",
    size: 42,
    contentType: "application/octet-stream",
    partSize: 42,
    partCount: 1,
  }],
};

describe("resume fingerprint", () => {
  test("changes for credentials and every material delivery option without exposing secrets", () => {
    const baseline = uploadFingerprint(options);
    expect(baseline).toMatch(/^v2:[a-f0-9]{64}$/);
    expect(baseline).not.toContain(options.apiKey!);
    expect(baseline).not.toContain(options.password!);

    const variants: NormalizedUploadOptions[] = [
      { ...options, apiKey: "dlvr_other_account" },
      { ...options, password: "other-password" },
      { ...options, maxDownloads: 6 },
      { ...options, emails: ["other@example.com"] },
      { ...options, expiry: { kind: "duration", duration: "7d" } },
      { ...options, baseUrl: "https://staging.dlvr.sh" },
      { ...options, files: [{ ...options.files[0]!, mtimeMs: 1235 }] },
    ];
    for (const variant of variants) expect(uploadFingerprint(variant)).not.toBe(baseline);
  });

  test("treats recipient order as equivalent", () => {
    const first = { ...options, emails: ["a@example.com", "b@example.com"] };
    const second = { ...options, emails: ["b@example.com", "a@example.com"] };
    expect(uploadFingerprint(first)).toBe(uploadFingerprint(second));
  });
});

test("resume state remains private and mode 0600", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dlvr-upload-state-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "uploads.json");
  const fingerprint = uploadFingerprint(options);
  await storeUploadSession(fingerprint, session, path);

  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const persisted = await readFile(path, "utf8");
  expect(persisted).not.toContain(options.apiKey!);
  expect(persisted).not.toContain(options.password!);
  expect(persisted).not.toContain(options.files[0]!.filePath);
  expect(await findUploadSession(fingerprint, path)).toEqual(session);
});
