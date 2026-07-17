import { mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type DownloadFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface DownloadShareOptions {
  baseUrl: string;
  shareUrl: string;
  outputPath: string;
  password?: string;
  overwrite?: boolean;
}

interface DownloadShareDeps {
  fetch?: DownloadFetch;
}

interface PublicFileMetadata {
  id: string;
  filename: string;
  size: number;
  fileCount: number;
}

async function parseJson<T>(response: Response) {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Request failed with status ${response.status}`);
  if (!body) throw new Error("dlvr.sh returned an invalid response.");
  return body;
}

async function requireDownload(response: Response) {
  if (response.ok && response.body) return response;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(body?.error || `Download failed with status ${response.status}`);
}

export function parseDownloadShareId(value: string) {
  const input = value.trim();
  if (!input) throw new Error("shareUrl is required.");
  try {
    const url = new URL(input);
    const match = url.pathname.match(/^\/f\/([^/]+)\/?$/);
    if (!match) throw new Error("Use a dlvr.sh /f/:shareId/ URL.");
    return decodeURIComponent(match[1]!);
  } catch (error) {
    if (/^[a-zA-Z0-9_-]+$/.test(input)) return input;
    throw error instanceof Error ? error : new Error("Invalid share URL.");
  }
}

export async function downloadShareToFile(options: DownloadShareOptions, deps: DownloadShareDeps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const shareId = parseDownloadShareId(options.shareUrl);
  const encodedShareId = encodeURIComponent(shareId);
  const metadata = await parseJson<PublicFileMetadata>(await fetchImpl(`${baseUrl}/api/files/${encodedShareId}`));
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const writePath = options.overwrite ? `${outputPath}.${randomUUID()}.part` : outputPath;
  const outputFile = await open(writePath, "wx");
  let bundle = false;
  try {
    let downloadResponse: Response;
    if (metadata.fileCount > 1) {
      bundle = true;
      const links = await parseJson<{ zipUrl: string }>(await fetchImpl(`${baseUrl}/api/files/${encodedShareId}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: options.password ?? "" }),
      }));
      downloadResponse = await requireDownload(await fetchImpl(links.zipUrl));
    } else {
      downloadResponse = await requireDownload(await fetchImpl(`${baseUrl}/api/files/${encodedShareId}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: options.password ?? "" }),
      }));
    }

    await pipeline(
      Readable.fromWeb(downloadResponse.body as never),
      outputFile.createWriteStream(),
    );
    if (options.overwrite) {
      await rename(writePath, outputPath);
    }
  } catch (error) {
    await outputFile.close().catch(() => undefined);
    await rm(writePath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    ok: true as const,
    shareId,
    outputPath,
    filename: bundle ? `dlvr-${shareId}.zip` : metadata.filename,
    size: metadata.size,
    bundle,
  };
}
