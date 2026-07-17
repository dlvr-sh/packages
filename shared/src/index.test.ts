import { describe, expect, mock, test } from "bun:test";
import { resumeDlvrMultipart, retryUploadRequest, uploadDlvrMultipart, type DlvrMultipartSession } from "./index";

test("retryUploadRequest uses full jitter and Retry-After", async () => {
  const sleep = mock(async (_delayMs: number) => undefined);
  let attempts = 0;
  const response = await retryUploadRequest(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("network unavailable");
    if (attempts === 2) return new Response(null, { status: 429, headers: { "retry-after": "2" } });
    return new Response(null, { status: 200 });
  }, { sleep, random: () => 0.5 });

  expect(response.status).toBe(200);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([125, 2000]);
});

test("retryUploadRequest does not retry permanent client errors", async () => {
  const request = mock(async () => new Response(null, { status: 400 }));
  expect((await retryUploadRequest(request)).status).toBe(400);
  expect(request).toHaveBeenCalledTimes(1);
});

test("browser session creation never retries a single-use Turnstile token", async () => {
  const request = mock(async () => Response.json({ error: "Temporary failure." }, { status: 500 }));

  await expect(uploadDlvrMultipart({
    baseUrl: "https://dlvr.sh",
    fetch: request,
    turnstileToken: "single-use-token",
    files: [{
      name: "artifact.bin",
      size: 1,
      createBody: () => new Uint8Array([1]),
    }],
    retry: { attempts: 5, sleep: async () => undefined },
  })).rejects.toMatchObject({ status: 500 });

  expect(request).toHaveBeenCalledTimes(1);
});

describe("multipart protocol", () => {
  test("resume skips part discovery and upload when start reports an already-ready file", async () => {
    const createBody = mock((_start: number, _endExclusive: number) => new Uint8Array([1, 2, 3, 4, 5]));
    const progress = mock((_value: unknown) => undefined);
    const requests: Array<{ method: string; url: string }> = [];
    const session: DlvrMultipartSession = {
      protocolVersion: 2,
      uploadId: "upload-1",
      uploadToken: "capability",
      sessionExpiresAt: "2099-01-01T00:00:00.000Z",
      shareId: "share-1",
      url: "https://dlvr.sh/f/share-1/",
      expiresAt: "2099-01-02T00:00:00.000Z",
      files: [{
        fileId: "file-1",
        filename: "artifact.bin",
        size: 5,
        contentType: "application/octet-stream",
        partSize: 5,
        partCount: 1,
      }],
      idempotencyKey: "idempotency-1",
    };
    const fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ method: init.method ?? "GET", url });
      if (url.endsWith("/files/file-1/start")) {
        return Response.json({ fileId: "file-1", state: "ready", partSize: 5, partCount: 1 });
      }
      if (url.endsWith("/upload-1/complete")) {
        return Response.json({
          id: "share-1",
          url: "https://dlvr.sh/f/share-1/",
          expires: "2099-01-02T00:00:00.000Z",
          downloads: 0,
          maxDownloads: null,
          passwordRequired: false,
          filename: "artifact.bin",
          size: 5,
        });
      }
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
    });

    const result = await resumeDlvrMultipart({
      baseUrl: "https://dlvr.sh",
      fetch,
      session,
      files: [{ name: "artifact.bin", size: 5, createBody }],
      onProgress: progress,
    });

    expect(result.url).toBe("https://dlvr.sh/f/share-1/");
    expect(createBody).not.toHaveBeenCalled();
    expect(requests).toEqual([
      { method: "POST", url: "https://dlvr.sh/api/uploads/upload-1/files/file-1/start" },
      { method: "POST", url: "https://dlvr.sh/api/uploads/upload-1/complete" },
    ]);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0]?.[0]).toMatchObject({
      uploadedBytes: 5,
      fileUploadedBytes: 5,
      fileId: "file-1",
    });
  });

  test("renews a rejected part URL, creates fresh bodies, and never leaks dlvr auth to storage", async () => {
    const storageHeaders: Headers[] = [];
    const createdBodies: number[] = [];
    let signedRequests = 0;
    let storageAttempts = 0;
    const fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/api/uploads")) {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer dlvr_test");
        expect(new Headers(init.headers).get("idempotency-key")).toBeTruthy();
        expect(JSON.parse(String(init.body))).toMatchObject({
          files: [{ filename: "artifact.bin", size: 5 }],
          turnstileToken: "turnstile",
        });
        return Response.json({
          protocolVersion: 2, uploadId: "upload-1", uploadToken: "capability",
          sessionExpiresAt: "2099-01-01T00:00:00.000Z", shareId: "share-1",
          url: "https://dlvr.sh/f/share-1/", expiresAt: "2099-01-02T00:00:00.000Z",
          files: [{ fileId: "file-1", filename: "artifact.bin", size: 5, contentType: "application/octet-stream", partSize: 5, partCount: 1 }],
        }, { status: 201 });
      }
      if (url.endsWith("/start")) return Response.json({ fileId: "file-1", state: "uploading", partSize: 5, partCount: 1 });
      if (url.endsWith("/parts") && init.method === "GET") return Response.json({ fileId: "file-1", parts: [] });
      if (url.endsWith("/parts") && init.method === "POST") {
        signedRequests += 1;
        return Response.json({ parts: [{ partNumber: 1, offset: 0, size: 5, uploadUrl: `https://storage.example/part-${signedRequests}`, headers: { "x-signed": "yes" } }] });
      }
      if (url.startsWith("https://storage.example/")) {
        storageAttempts += 1;
        storageHeaders.push(new Headers(init.headers));
        return new Response(null, { status: storageAttempts === 1 ? 403 : 200 });
      }
      if (url.endsWith("/files/file-1/complete")) return Response.json({ fileId: "file-1", state: "ready", size: 5 });
      if (url.endsWith("/upload-1/complete")) return Response.json({
        id: "share-1", url: "https://dlvr.sh/f/share-1/", expires: "2099-01-02T00:00:00.000Z",
        downloads: 0, maxDownloads: null, passwordRequired: false, filename: "artifact.bin", size: 5,
      });
      throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
    });

    const result = await uploadDlvrMultipart({
      baseUrl: "https://dlvr.sh", apiKey: "dlvr_test", fetch,
      requestHeaders: { "x-dlvr-anon-id": "anon" }, turnstileToken: "turnstile",
      files: [{ name: "artifact.bin", size: 5, createBody: () => {
        createdBodies.push(createdBodies.length + 1);
        return new Uint8Array([1, 2, 3, 4, 5]);
      } }],
      retry: { sleep: async () => undefined, random: () => 0 },
    });

    expect(result.url).toBe("https://dlvr.sh/f/share-1/");
    expect(createdBodies).toHaveLength(2);
    expect(storageHeaders).toHaveLength(2);
    for (const headers of storageHeaders) {
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-dlvr-upload-token")).toBeNull();
      expect(headers.get("x-dlvr-anon-id")).toBeNull();
      expect(headers.get("x-signed")).toBe("yes");
      expect(headers.get("content-length")).toBe("5");
    }
  });
});
