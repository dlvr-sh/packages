# @dlvr/cli

Terminal-first uploads for `dlvr.sh`.

## Install

```sh
npm install -g @dlvr/cli
```

## Usage

CLI access requires a verified dlvr.sh account with a permanent email and an API key. Free personal accounts include 10 deliveries in a rolling 24-hour window shared with browser and other API clients.

```sh
dlvr login
dlvr whoami
```

```sh
dlvr --file ./artifact.zip --email team@example.com --duration 24h
```

Create one transfer containing multiple files by repeating `--file`:

```sh
dlvr --file ./photo-1.jpg --file ./photo-2.jpg --duration 24h
```

```sh
dlvr --file ./artifact.zip \
  --email team@example.com \
  --email ops@example.com \
  --expires-at 2026-04-25T18:00:00.000Z
```

## Interactive mode

Run `dlvr` with no arguments to open the full terminal form. The form shows all active fields at once and lets you move with arrow keys, switch duration options inline, or change the expiry mode to a fixed date.

Current form fields are controlled by `GET /api/cli/config`, so the API decides which options are enabled or required.

## Auth

Create an API key in the dlvr.sh dashboard under **API Access**. Credential precedence is:

1. `DLVR_API_KEY`
2. the key stored by `dlvr login`

```sh
DLVR_API_KEY=dlvr_... dlvr --file ./artifact.zip --duration 24h --json --yes
```

Each key is bound to either your personal scope or one Team workspace. `dlvr login` and `dlvr whoami` report the active scope; uploads automatically use the scope stored on the key.

## Flags

- `-f, --file <path>` (repeatable, up to 100 files)
- `-e, --email <value>`
- `-d, --duration <value>`
- `--expires-at <value>`
- `-m, --max-downloads <number>`
- `-u, --url <value>`
- `--json`
- `--quiet`
- `--yes`
- `-h, --help`
- `-v, --version`

For scripted password-protected uploads, set `DLVR_DOWNLOAD_PASSWORD`. Secret-valued flags are intentionally rejected so credentials do not appear in process listings or shell history.

## Direct and resumable uploads

All files use direct multipart uploads. The CLI streams 64 MiB ranges from disk, uploads four parts concurrently, and never buffers a complete large file. Interrupted sessions are stored with mode `0600` under `~/.config/dlvr/uploads.json` and automatically resume when the base URL, paths, sizes, and modification times still match.

Interactive mode accepts one file. Use repeated `--file` flags for multi-file transfers.

## MCP

The same package includes a local stdio MCP server:

```sh
dlvr mcp
```

It exposes multi-file local upload, list, inspect, and delete tools for account-owned uploads.

## Dynamic validation

The CLI fetches configuration from the API before prompting or validating inputs. Upload failures surface the server error message directly, which lets the service change plan rules without shipping a new CLI first.
