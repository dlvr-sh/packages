import { buildAuthorizationHeader } from "@dlvr/shared";
import type { CliConfig } from "./types";

type ConfigFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ConfigClientDeps {
  fetch?: ConfigFetch;
}

export async function fetchCliConfig(baseUrl: string, apiKey?: string, deps: ConfigClientDeps = {}): Promise<CliConfig> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as ConfigFetch);
  const authorization = buildAuthorizationHeader(apiKey);
  const response = await fetchImpl(`${baseUrl}/api/cli/config`, {
    headers: authorization ? { authorization } : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Could not load CLI config (${response.status})`);
  }

  return (await response.json()) as CliConfig;
}
