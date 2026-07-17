import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadShareToFile, parseDownloadShareId } from "./download-client";

test("parses a share id or dlvr share URL", () => {
  expect(parseDownloadShareId("share_123")).toBe("share_123");
  expect(parseDownloadShareId("https://dlvr.sh/f/share_123/")).toBe("share_123");
  expect(() => parseDownloadShareId("https://dlvr.sh/pricing/")).toThrow("/f/:shareId/");
});

test("streams a public single-file download to disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dlvr-download-"));
  const outputPath = join(directory, "hello.txt");
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/files/share-1")) {
      return Response.json({ id: "share-1", filename: "hello.txt", size: 5, fileCount: 1 });
    }
    if (url.endsWith("/api/files/share-1/download")) return new Response("hello");
    throw new Error(`Unexpected ${url}`);
  };

  try {
    const result = await downloadShareToFile({
      baseUrl: "https://dlvr.sh",
      shareUrl: "https://dlvr.sh/f/share-1/",
      outputPath,
    }, { fetch });
    expect(await readFile(outputPath, "utf8")).toBe("hello");
    expect(result).toMatchObject({ ok: true, shareId: "share-1", bundle: false });
    expect(calls).toEqual([
      "GET https://dlvr.sh/api/files/share-1",
      "POST https://dlvr.sh/api/files/share-1/download",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not claim a download when the output file already exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dlvr-download-existing-"));
  const outputPath = join(directory, "existing.txt");
  await writeFile(outputPath, "keep");
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return Response.json({ id: "share-1", filename: "existing.txt", size: 4, fileCount: 1 });
  };

  try {
    let thrown: unknown;
    try {
      await downloadShareToFile({
        baseUrl: "https://dlvr.sh",
        shareUrl: "share-1",
        outputPath,
      }, { fetch });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "EEXIST" });
    expect(await readFile(outputPath, "utf8")).toBe("keep");
    expect(calls).toEqual(["https://dlvr.sh/api/files/share-1"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
