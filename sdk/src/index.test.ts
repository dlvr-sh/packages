import { describe, expect, test } from "bun:test";
import { createDlvrClient, DlvrApiError, getDlvrLoginUrl, loginWithDlvr } from "./index";

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

describe("login helpers", () => {
  test("builds hosted login URL and rejects cross-origin redirects", () => {
    expect(getDlvrLoginUrl()).toBe("https://dlvr.sh/login/?redirect=%2Faccount%2Fapi%2F");
    expect(() => getDlvrLoginUrl({ redirectTo: "https://example.com/callback" })).toThrow(DlvrApiError);
  });

  test("assigns browser location", () => {
    let assigned = "";
    loginWithDlvr({ window: { location: { assign(value: string) { assigned = value; } } as Location } });
    expect(assigned).toContain("/login/");
  });
});

describe("multipart SDK", () => {
  test("uploads multiple blobs through protocol v2", async () => {
    const calls: string[] = [];
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/uploads")) {
        const request = JSON.parse(String(init.body));
        expect(request.files.map((file: { filename: string }) => file.filename)).toEqual(["one.txt", "two.txt"]);
        return json({
          protocolVersion: 2, uploadId: "u1", uploadToken: "token", sessionExpiresAt: "2099-01-01T00:00:00.000Z",
          shareId: "s1", url: "https://dlvr.sh/f/s1/", expiresAt: "2099-01-02T00:00:00.000Z",
          files: [
            { fileId: "f1", filename: "one.txt", size: 3, contentType: "text/plain", partSize: 3, partCount: 1 },
            { fileId: "f2", filename: "two.txt", size: 3, contentType: "text/plain", partSize: 3, partCount: 1 },
          ],
        }, { status: 201 });
      }
      if (url.endsWith("/start")) return json({ state: "uploading" });
      if (url.endsWith("/parts") && init.method === "GET") return json({ parts: [] });
      if (url.endsWith("/parts") && init.method === "POST") {
        const fileId = url.includes("/f1/") ? "f1" : "f2";
        return json({ parts: [{ partNumber: 1, offset: 0, size: 3, uploadUrl: `https://storage/${fileId}`, headers: {} }] });
      }
      if (url.startsWith("https://storage/")) {
        expect(new Headers(init.headers).get("authorization")).toBeNull();
        return new Response(null, { status: 200 });
      }
      if (url.includes("/files/") && url.endsWith("/complete")) return json({ state: "ready", size: 3 });
      if (url.endsWith("/u1/complete")) return json({
        id: "s1", url: "https://dlvr.sh/f/s1/", expires: "2099-01-02T00:00:00.000Z", downloads: 0,
        maxDownloads: null, passwordRequired: false, filename: "2 files", size: 6,
      });
      throw new Error(`Unexpected ${url}`);
    };

    const client = createDlvrClient({ apiKey: "dlvr_test", fetch });
    const result = await client.uploadFiles({
      files: [
        { file: new File(["one"], "one.txt", { type: "text/plain" }) },
        { file: new File(["two"], "two.txt", { type: "text/plain" }) },
      ],
      duration: "24h",
    });
    expect(result.size).toBe(6);
    expect(calls.filter((call) => call.startsWith("PUT https://storage/"))).toHaveLength(2);
  });

  test("requires an API key", () => {
    const client = createDlvrClient({ fetch: async () => json({}) });
    expect(client.uploadFile({ file: new Blob(["x"]) })).rejects.toThrow("API key required");
  });
});

describe("public downloads", () => {
  test("downloads a single-file share without requiring an API key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/files/share-1")) return json({ fileCount: 1 });
      if (url.endsWith("/api/files/share-1/download")) return new Response("hello");
      throw new Error(`Unexpected ${url}`);
    };

    const response = await createDlvrClient({ fetch }).downloadFile({ shareId: "share-1", password: "secret" });
    expect(await response.text()).toBe("hello");
    expect(calls[1]!.init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ password: "secret" }),
    });
    expect(new Headers(calls[1]!.init.headers).get("authorization")).toBeNull();
  });

  test("resolves a bundle ZIP link before downloading it", async () => {
    const calls: string[] = [];
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/files/bundle-1")) return json({ fileCount: 2 });
      if (url.endsWith("/api/files/bundle-1/links")) return json({ zipUrl: "https://dlvr.sh/api/files/bundle-1/zip" });
      if (url.endsWith("/api/files/bundle-1/zip")) return new Response("zip");
      throw new Error(`Unexpected ${url}`);
    };

    const response = await createDlvrClient({ fetch }).downloadFile({ shareId: "bundle-1" });
    expect(await response.text()).toBe("zip");
    expect(calls).toEqual([
      "GET https://dlvr.sh/api/files/bundle-1",
      "POST https://dlvr.sh/api/files/bundle-1/links",
      "GET https://dlvr.sh/api/files/bundle-1/zip",
    ]);
  });
});
