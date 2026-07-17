import { resolve } from "node:path";
import { stat as nodeStat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_BASE_URL, EMAIL_PATTERN } from "./constants";
import type { CliArgs, CliConfig, NormalizedUploadOptions, UploadExpirySelection } from "./types";

interface FileLikeStat {
  size: number;
  mtimeMs?: number;
  isFile(): boolean;
}

interface ValidationDeps {
  stat?: (path: string) => Promise<FileLikeStat>;
  resolvePath?: (path: string) => string;
}

const FIXED_DATE_WITH_TIMEZONE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function normalizeEmails(values: string[]) {
  const unique = new Set<string>();

  for (const raw of values) {
    for (const part of raw.split(",")) {
      const email = part.trim().toLowerCase();
      if (!email) {
        continue;
      }

      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`Invalid email: ${part.trim()}`);
      }

      unique.add(email);
    }
  }

  return Array.from(unique);
}

function normalizeBaseUrl(value?: string) {
  const url = (value || DEFAULT_BASE_URL).trim();
  if (!url) {
    return DEFAULT_BASE_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function normalizeMaxDownloads(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("maxDownloads must be a positive integer");
  }

  return Math.min(parsed, 10000);
}

function trimMatchingQuotes(value: string) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeFilePathInput(value: string) {
  const trimmed = trimMatchingQuotes(value.trim());
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("file://")) {
    return fileURLToPath(trimmed);
  }

  return trimmed.replace(/\\([ !"#$&'()*,;<=>?@[\\\]^`{|}~])/g, "$1");
}

function normalizeExpiry(args: CliArgs, config: CliConfig): UploadExpirySelection {
  if (args.duration && args.expiresAt) {
    throw new Error("Choose either a duration or a fixed expiry date");
  }

  if (args.expiresAt) {
    const normalized = args.expiresAt.trim();
    if (!FIXED_DATE_WITH_TIMEZONE_PATTERN.test(normalized)) {
      throw new Error("Fixed expiry date must be a valid ISO date with an explicit timezone");
    }

    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) {
      throw new Error("Fixed expiry date must be a valid ISO date with an explicit timezone");
    }

    return {
      kind: "fixedDate",
      expiresAt: new Date(parsed).toISOString(),
    };
  }

  const duration = args.duration || config.expiry.defaultDuration;
  if (!duration) {
    throw new Error("Expiry is required");
  }

  return {
    kind: "duration",
    duration,
  };
}

export async function normalizeUploadOptions(
  args: CliArgs,
  config: CliConfig,
  deps: ValidationDeps = {},
): Promise<NormalizedUploadOptions> {
  const requestedPaths = args.filePaths ?? [];
  if (requestedPaths.length === 0) {
    throw new Error("At least one file path is required");
  }
  if (requestedPaths.length > 100) {
    throw new Error("No more than 100 files are allowed per transfer");
  }

  const resolvePath = deps.resolvePath ?? resolve;
  const stat = deps.stat ?? nodeStat;
  const expiry = normalizeExpiry(args, config);
  const files = await Promise.all(requestedPaths.map(async (value) => {
    const filePath = resolvePath(normalizeFilePathInput(value));
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`File path must point to a file: ${value}`);
    return {
      filePath,
      filename: filePath.split(/[\\/]/).pop() || "upload.bin",
      fileSize: fileStat.size,
      mtimeMs: fileStat.mtimeMs ?? 0,
    };
  }));
  const totalSize = files.reduce((sum, file) => sum + file.fileSize, 0);
  if (totalSize > config.limits.maxUploadBytes) {
    throw new Error(`Transfer exceeds the ${config.limits.maxUploadBytes} byte plan limit`);
  }

  const emails = normalizeEmails(args.emails);
  if (config.fields.recipients.required && emails.length === 0) {
    throw new Error("Recipient email is required");
  }

  if (emails.length > config.limits.maxNotifyRecipients) {
    throw new Error(`No more than ${config.limits.maxNotifyRecipients} recipient emails are allowed`);
  }

  return {
    files,
    emails,
    password: args.password?.trim() || undefined,
    maxDownloads: normalizeMaxDownloads(args.maxDownloads),
    baseUrl: normalizeBaseUrl(args.baseUrl),
    apiKey: args.apiKey,
    json: args.json,
    quiet: args.quiet,
    expiry,
  };
}
