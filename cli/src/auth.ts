import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Readable, Writable } from "node:stream";
import { DLVR_API_KEY_ENV } from "@dlvr/shared";

export interface StoredAuth {
  apiKey: string;
  baseUrl?: string;
}

interface AuthDeps {
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  chmod?: typeof chmod;
  rename?: typeof rename;
  rm?: typeof rm;
  mkdir?: typeof mkdir;
  promptApiKey?: () => Promise<string>;
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  input?: Readable;
  output?: Writable;
}

function getConfigPath(deps: AuthDeps = {}) {
  const home = deps.home ?? homedir();
  return join(home, ".config", "dlvr", "auth.json");
}

async function defaultPromptApiKey(deps: AuthDeps = {}) {
  const promptInput = deps.input ?? input;
  const promptOutput = deps.output ?? output;
  const rl = createInterface({ input: promptInput, output: promptOutput });
  const controller = new AbortController();
  const abortOnEnd = () => controller.abort();
  promptInput.once("end", abortOnEnd);
  try {
    return (await rl.question("API key: ", { signal: controller.signal })).trim();
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("API key input closed before a value was entered.");
    }
    throw error;
  } finally {
    promptInput.removeListener("end", abortOnEnd);
    rl.close();
  }
}

export async function readStoredAuth(deps: AuthDeps = {}): Promise<StoredAuth | null> {
  try {
    const raw = await (deps.readFile ?? readFile)(getConfigPath(deps), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    return typeof parsed.apiKey === "string" && parsed.apiKey.trim()
      ? {
          apiKey: parsed.apiKey.trim(),
          baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
            ? parsed.baseUrl.trim()
            : undefined,
        }
      : null;
  } catch {
    return null;
  }
}

export async function writeStoredAuth(auth: StoredAuth, deps: AuthDeps = {}) {
  const path = getConfigPath(deps);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await (deps.mkdir ?? mkdir)(dirname(path), { recursive: true });
  try {
    await (deps.writeFile ?? writeFile)(temporaryPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    await (deps.chmod ?? chmod)(temporaryPath, 0o600);
    await (deps.rename ?? rename)(temporaryPath, path);
    await (deps.chmod ?? chmod)(path, 0o600);
  } catch (error) {
    await (deps.rm ?? rm)(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function clearStoredAuth(deps: AuthDeps = {}) {
  await (deps.rm ?? rm)(getConfigPath(deps), { force: true });
}

export async function promptForApiKey(deps: AuthDeps = {}) {
  const value = await (deps.promptApiKey ?? (() => defaultPromptApiKey(deps)))();
  if (!value.trim()) {
    throw new Error("API key is required");
  }
  return value.trim();
}

export async function resolveApiKey(inputKey?: string, deps: AuthDeps = {}) {
  return (await resolveAuth(inputKey, deps))?.apiKey;
}

export async function resolveAuth(inputKey?: string, deps: AuthDeps = {}): Promise<StoredAuth | null> {
  const envKey = (deps.env ?? process.env)[DLVR_API_KEY_ENV]?.trim();
  const stored = await readStoredAuth(deps);
  const apiKey = inputKey?.trim() || envKey || stored?.apiKey;
  return apiKey ? { apiKey, baseUrl: stored?.baseUrl } : null;
}
