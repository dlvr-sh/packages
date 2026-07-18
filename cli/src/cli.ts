import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DLVR_DOWNLOAD_PASSWORD_ENV } from "@dlvr/shared";
import { formatError, formatSuccess } from "./format";
import { getHelpText, parseCliArgs } from "./args";
import { DEFAULT_BASE_URL } from "./constants";
import { fetchCliConfig } from "./config-client";
import { clearStoredAuth, promptForApiKey, resolveApiKey, resolveAuth, writeStoredAuth } from "./auth";
import { promptForMissingOptions } from "./prompts";
import { normalizeUploadOptions } from "./validate";
import { toCliErrorShape, uploadFiles } from "./upload-client";
import { runMcpServer } from "./mcp-server";
import type { CliArgs, CliConfig, UploadResult } from "./types";

interface CliDeps {
  fetchCliConfig?: typeof fetchCliConfig;
  resolveAuth?: typeof resolveAuth;
  /** Backward-compatible key-only test/dependency override. */
  resolveApiKey?: typeof resolveApiKey;
  promptForApiKey?: typeof promptForApiKey;
  writeStoredAuth?: typeof writeStoredAuth;
  clearStoredAuth?: typeof clearStoredAuth;
  runMcpServer?: typeof runMcpServer;
  promptForMissingOptions?: (args: CliArgs, config: CliConfig) => Promise<CliArgs>;
  normalizeUploadOptions?: typeof normalizeUploadOptions;
  uploadFiles?: typeof uploadFiles;
  writeStdout?: (value: string) => void;
  writeStderr?: (value: string) => void;
  env?: Record<string, string | undefined>;
}

async function getVersion() {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const contents = await readFile(fileURLToPath(packageJsonUrl), "utf8");
  const parsed = JSON.parse(contents) as { version?: string };
  return parsed.version || "0.0.0";
}

function shouldPrompt(args: CliArgs, config: CliConfig) {
  if ((args.filePaths?.length ?? 0) === 0) {
    return true;
  }

  if (config.fields.recipients.required && args.emails.length === 0) {
    return true;
  }

  if (!args.duration && !args.expiresAt && !config.expiry.defaultDuration) {
    return true;
  }

  return false;
}

export async function runCli(argv: string[], deps: CliDeps = {}) {
  const stdout = deps.writeStdout ?? ((value: string) => process.stdout.write(value));
  const stderr = deps.writeStderr ?? ((value: string) => process.stderr.write(value));
  const loadConfig = deps.fetchCliConfig ?? fetchCliConfig;
  const resolveCredentials = deps.resolveAuth ?? (deps.resolveApiKey
    ? async () => {
        const apiKey = await deps.resolveApiKey!();
        return apiKey ? { apiKey, baseUrl: undefined } : null;
      }
    : resolveAuth);
  const promptKey = deps.promptForApiKey ?? promptForApiKey;
  const storeAuth = deps.writeStoredAuth ?? writeStoredAuth;
  const clearAuth = deps.clearStoredAuth ?? clearStoredAuth;
  const startMcp = deps.runMcpServer ?? runMcpServer;
  const prompt = deps.promptForMissingOptions ?? promptForMissingOptions;
  const normalize = deps.normalizeUploadOptions ?? normalizeUploadOptions;
  const upload = deps.uploadFiles ?? uploadFiles;
  const processEnv = deps.env ?? process.env;

  try {
    let parsed = parseCliArgs(argv);

    if (parsed.help) {
      stdout(`${getHelpText()}\n`);
      return 0;
    }

    if (parsed.version) {
      stdout(`${await getVersion()}\n`);
      return 0;
    }

    if (parsed.command === "logout") {
      await clearAuth();
      stdout(parsed.json ? `${JSON.stringify({ ok: true })}\n` : "Logged out.\n");
      return 0;
    }

    const auth = parsed.command === "login" ? null : await resolveCredentials();
    const baseUrl = (parsed.baseUrl || auth?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

    if (parsed.command === "mcp") {
      await startMcp({
        baseUrl,
        apiKey: auth?.apiKey,
      });
      return 0;
    }

    const apiKey = parsed.command === "login" ? await promptKey() : auth?.apiKey;
    if (!apiKey) {
      throw new Error("API key required. Run `dlvr login` or set DLVR_API_KEY.");
    }

    const config = await loadConfig(baseUrl, apiKey);

    if (parsed.command === "login") {
      await storeAuth({ apiKey, baseUrl });
      stdout(parsed.json ? `${JSON.stringify({ ok: true, plan: config.account?.plan, workspace: config.workspace ?? null })}\n` : `Logged in${config.workspace ? ` to workspace ${config.workspace.name || config.workspace.id}` : ""}.\n`);
      return 0;
    }

    if (parsed.command === "whoami") {
      const payload = {
        baseUrl,
        plan: config.account?.plan,
        planName: config.account?.planName,
        workspace: config.workspace ?? null,
        deliveryQuota: config.deliveryQuota ?? null,
      };
      const quota = payload.deliveryQuota ? ` · ${payload.deliveryQuota.remaining}/${payload.deliveryQuota.limit} deliveries remaining` : "";
      stdout(parsed.json ? `${JSON.stringify(payload, null, 2)}\n` : `dlvr.sh ${payload.planName || "account"} access on ${baseUrl}${payload.workspace ? ` · workspace ${payload.workspace.name || payload.workspace.id}` : " · personal scope"}${quota}\n`);
      return 0;
    }

    if (shouldPrompt(parsed, config) && !parsed.yes) {
      parsed = await prompt(parsed, config);
    }

    parsed.baseUrl = baseUrl;
    parsed.password ||= processEnv[DLVR_DOWNLOAD_PASSWORD_ENV]?.trim() || undefined;

    const normalized = await normalize(parsed, config);
    normalized.apiKey = apiKey;
    const result: UploadResult = await upload(normalized, {
      onProgress: parsed.quiet || parsed.json ? undefined : (progress) => {
        const percent = progress.totalBytes === 0 ? 100 : Math.floor(progress.uploadedBytes / progress.totalBytes * 100);
        stderr(`\rUploading ${percent}% (${progress.uploadedBytes}/${progress.totalBytes} bytes)`);
      },
    });
    if (!parsed.quiet && !parsed.json) stderr("\n");
    stdout(formatSuccess(result, { json: parsed.json }));
    return 0;
  } catch (error) {
    const cliError = toCliErrorShape(error);
    stderr(formatError(cliError, { json: argv.includes("--json") }));
    return 1;
  }
}
