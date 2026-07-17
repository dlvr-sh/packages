import type { CliErrorShape, UploadResult } from "./types";

interface FormatOptions {
  json: boolean;
}

export function formatSuccess(result: UploadResult, options: FormatOptions) {
  if (options.json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const lines = [
    `URL: ${result.url}`,
    `File${result.files && result.files.length > 1 ? "s" : ""}: ${result.files?.map((file) => file.filename).join(", ") || result.filename}`,
    `Size: ${result.size} bytes`,
    `Expires: ${result.expires}`,
  ];

  if (result.passwordRequired) {
    lines.push("Password: required");
  }

  if (result.maxDownloads !== null) {
    lines.push(`Max downloads: ${result.maxDownloads}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatError(error: CliErrorShape, options: FormatOptions) {
  if (options.json) {
    return `${JSON.stringify(error, null, 2)}\n`;
  }

  return `Error: ${error.message}\n`;
}
