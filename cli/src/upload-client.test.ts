import { expect, mock, test } from "bun:test";
import type { DlvrMultipartSession } from "@dlvr/shared";
import { uploadFiles } from "./upload-client";
import type { NormalizedUploadOptions } from "./types";

const options: NormalizedUploadOptions = {
  files: [
    { filePath: "/abs/one.bin", filename: "one.bin", fileSize: 3, mtimeMs: 10 },
    { filePath: "/abs/two.bin", filename: "two.bin", fileSize: 2, mtimeMs: 20 },
  ],
  emails: ["team@example.com"], baseUrl: "https://dlvr.sh", json: false, quiet: false,
  expiry: { kind: "duration", duration: "24h" },
};

const session: DlvrMultipartSession = {
  protocolVersion: 2, uploadId: "u1", uploadToken: "token", idempotencyKey: "idem",
  sessionExpiresAt: "2099-01-01T00:00:00.000Z", shareId: "s1", url: "https://dlvr.sh/f/s1/",
  expiresAt: "2099-01-02T00:00:00.000Z",
  files: [
    { fileId: "f1", filename: "one.bin", size: 3, contentType: "application/octet-stream", partSize: 3, partCount: 1 },
    { fileId: "f2", filename: "two.bin", size: 2, contentType: "application/octet-stream", partSize: 2, partCount: 1 },
  ],
};

test("streams a fresh filesystem range for each direct multipart file", async () => {
  const streams = mock((_path: string, _range: { start: number; end: number }) => new ReadableStream());
  let createBody: unknown;
  const fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/api/uploads")) {
      createBody = JSON.parse(String(init.body));
      return Response.json(session, { status: 201 });
    }
    if (url.endsWith("/start")) return Response.json({ state: "uploading" });
    if (url.endsWith("/parts") && init.method === "GET") return Response.json({ parts: [] });
    if (url.endsWith("/parts") && init.method === "POST") {
      const first = url.includes("/f1/");
      return Response.json({ parts: [{ partNumber: 1, offset: 0, size: first ? 3 : 2, uploadUrl: `https://storage/${first ? "f1" : "f2"}`, headers: {} }] });
    }
    if (url.startsWith("https://storage/")) return new Response(null, { status: 200 });
    if (url.includes("/files/") && url.endsWith("/complete")) return Response.json({ state: "ready" });
    if (url.endsWith("/u1/complete")) return Response.json({
      id: "s1", url: "https://dlvr.sh/f/s1/", expires: session.expiresAt, filename: "2 files", size: 5,
      downloads: 0, maxDownloads: null, passwordRequired: false,
    });
    throw new Error(`Unexpected ${url}`);
  });

  const result = await uploadFiles(options, {
    fetch, createReadStream: streams,
    findSession: async () => undefined,
    storeSession: async () => undefined,
    removeSession: async () => undefined,
  });
  expect(result.size).toBe(5);
  expect(createBody).toMatchObject({ files: [{ filename: "one.bin" }, { filename: "two.bin" }] });
  expect(streams.mock.calls.map(([path, range]) => [path, range])).toEqual([
    ["/abs/one.bin", { start: 0, end: 2 }],
    ["/abs/two.bin", { start: 0, end: 1 }],
  ]);
});

test("resumes from authoritative uploaded parts", async () => {
  const streams = mock(() => new ReadableStream());
  const fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/start")) return Response.json({ state: "uploading" });
    if (url.endsWith("/parts") && init.method === "GET") {
      return Response.json({ parts: [{ partNumber: 1, size: url.includes("/f1/") ? 3 : 2, etag: "etag" }] });
    }
    if (url.includes("/files/") && url.endsWith("/complete")) return Response.json({ state: "ready" });
    if (url.endsWith("/u1/complete")) return Response.json({
      id: "s1", url: session.url, expires: session.expiresAt, filename: "2 files", size: 5,
      downloads: 0, maxDownloads: null, passwordRequired: false,
    });
    throw new Error(`Unexpected ${init.method ?? "GET"} ${url}`);
  });
  await uploadFiles(options, {
    fetch, createReadStream: streams,
    findSession: async () => session,
    storeSession: async () => undefined,
    removeSession: async () => undefined,
  });
  expect(streams).not.toHaveBeenCalled();
});
