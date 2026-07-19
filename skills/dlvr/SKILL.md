---
name: dlvr
description: Upload, share, download, inspect, list, and delete temporary file deliveries through dlvr.sh. Use when an agent needs to send one or more local artifacts to a human or another agent, return a temporary share link, retrieve a dlvr.sh share to disk, or manage account-owned deliveries through local MCP, the CLI, or the JavaScript SDK.
---

# Deliver Files with dlvr.sh

Use dlvr.sh for temporary delivery, not permanent storage. Prefer the supported clients so file bytes stream directly to signed private-storage URLs without recreating the multipart protocol.

## Choose the Execution Surface

1. Use the local MCP tools when `dlvr_upload_file` or `dlvr_download_file` is available. This is the preferred surface for an agent handling local files.
2. If local MCP is unavailable but shell execution is available, use an installed `dlvr` command or `npx -y @dlvr/cli@latest` for uploads and account checks.
3. When changing a JavaScript or TypeScript application, read [references/javascript-sdk.md](references/javascript-sdk.md) and use `@dlvr/sdk`.
4. If no client or credential is configured, read [references/setup.md](references/setup.md). Never ask the user to paste an API key into chat.

Treat an MCP connection that exposes only list, get, and delete as hosted MCP. Hosted MCP is management-only: it cannot read local files, upload them, or download a share to the device.

## Apply Safe Defaults

- Resolve and verify the exact requested file paths before upload. Upload files only; do not archive a directory unless the user requests an archive.
- Put up to 100 files in one transfer when they should share one link.
- Honor an explicit duration or fixed expiry. Otherwise omit expiry and let the server-provided default apply; if the server requires a choice, present its allowed options.
- Add a password, download limit, or notification recipients only when the user requests them. Send notifications only to explicitly supplied addresses.
- Keep API keys out of arguments, output, logs, source, MCP configuration, and conversation text. Use stored CLI authentication or an inherited `DLVR_API_KEY`.
- Treat upload capabilities and signed storage URLs as secrets. Never attach dlvr authorization headers to signed storage URLs.
- Treat the returned share URL as a capability. Return it only in the requested response or destination.
- Do not overwrite an existing download or delete a delivery without explicit user intent.

## Upload Local Files

### Local MCP

Call `dlvr_upload_file` with:

- `filePaths`: one to 100 verified local file paths
- either `duration` or `expiresAt` when specified
- optional `password`, `maxDownloads`, and `notifyEmails` only when requested

Do not send both `duration` and `expiresAt`. Return the resulting share URL, expiry, filename or file count, and requested protection settings. Do not expose internal upload tokens or signed part URLs.

### CLI fallback

Prefer the installed command when present:

```sh
dlvr --file ./artifact.zip --duration 24h --json --yes
```

Repeat `--file` for a bundle and `--email` for explicit notification recipients:

```sh
dlvr --file ./report.pdf --file ./data.csv --email team@example.com --json --yes
```

Use `npx -y @dlvr/cli@latest` in place of `dlvr` when the CLI is not installed and downloading the official package is acceptable. Never use `--api-key` or `--password`; the CLI rejects secret-valued flags. Use an already configured `DLVR_API_KEY`, stored login, or `DLVR_DOWNLOAD_PASSWORD` without printing its value.

The CLI fetches current plan rules before validation. Surface its structured server error instead of guessing a different retention, size, quota, or recipient value.

## Download a Share

Use `dlvr_download_file` with the share URL or bare share ID and an explicit output path. Pass the password only for a protected share. Keep `overwrite` false unless the user explicitly approves replacement.

Public downloads do not require an API key. A multi-file share is saved as a ZIP. The CLI has no standalone download command; if local MCP is unavailable, use the SDK in an existing application or help configure local MCP instead of rebuilding the download protocol.

## Manage Deliveries

- Use `dlvr_list_uploads` to discover account-owned deliveries.
- Use `dlvr_get_upload` before a consequential action when the exact delivery is uncertain.
- Use `dlvr_delete_upload` only for an exact upload ID the user explicitly asked to remove. Deletion permanently removes the stored files.

Authentication is required for upload and management. Credentials are bound to either one personal scope or one Team workspace; never infer or override scope in a request.

## Handle Failures

- On `api_key_required`, stop and direct the user to [references/setup.md](references/setup.md); do not solicit the key.
- On verification, plan, quota, retention, file-size, or recipient errors, report the server code and actionable message. Do not silently upgrade, weaken protections, or change recipients.
- Let the official clients perform resumable upload retries. After a timeout, inspect the result or rerun the same client operation rather than inventing a second transfer through raw REST calls.
- If the target download exists, request a different output path or explicit overwrite approval.
- If only hosted MCP is available for a local-file task, explain the limitation and configure local MCP or use the CLI fallback.
