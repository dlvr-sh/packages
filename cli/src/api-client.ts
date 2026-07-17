import { buildAuthorizationHeader, type DlvrUploadSummary } from "@dlvr/shared";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ApiClientDeps {
  fetch?: ApiFetch;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error || `Request failed with status ${response.status}`);
}

function authHeaders(apiKey: string) {
  return {
    authorization: buildAuthorizationHeader(apiKey)!,
  };
}

export async function listUploads(baseUrl: string, apiKey: string, deps: ApiClientDeps = {}) {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as ApiFetch);
  const response = await fetchImpl(`${baseUrl}/api/account/uploads`, {
    headers: authHeaders(apiKey),
  });
  return parseResponse<{ uploads: DlvrUploadSummary[] }>(response);
}

export async function getUpload(baseUrl: string, apiKey: string, id: string, deps: ApiClientDeps = {}) {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as ApiFetch);
  const response = await fetchImpl(`${baseUrl}/api/account/uploads/${encodeURIComponent(id)}`, {
    headers: authHeaders(apiKey),
  });
  return parseResponse<{ upload: DlvrUploadSummary }>(response);
}

export async function deleteUpload(baseUrl: string, apiKey: string, id: string, deps: ApiClientDeps = {}) {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as ApiFetch);
  const response = await fetchImpl(`${baseUrl}/api/account/uploads/${encodeURIComponent(id)}`, {
    method: "DELETE",
    // Astro's origin protection treats bodyless mutations without an explicit media type
    // as form-like requests. Mark API-key deletes as JSON so non-browser MCP/CLI clients
    // reach the bearer-authenticated route without weakening cookie-session CSRF checks.
    headers: {
      ...authHeaders(apiKey),
      "content-type": "application/json",
    },
  });
  return parseResponse<{ ok: boolean }>(response);
}
