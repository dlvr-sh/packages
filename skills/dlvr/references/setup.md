# Setup and Authentication

Read this reference only when no usable local dlvr client or credential is configured.

## Authentication Boundary

Uploads and account management require a dlvr.sh API key from an account with a verified, permanent email address. Create the key at `https://dlvr.sh/account/api/`. Free personal accounts share a rolling allowance of 10 deliveries per 24 hours across browser and programmatic clients; current server configuration remains authoritative.

Public recipient downloads do not require an API key. API keys are bound to either a personal scope or one Team workspace, and requests cannot switch that scope.

Never ask the user to paste a key into chat. Never place a key in a command argument, source file, committed environment file, screenshot, or MCP configuration. Let the user enter it into the interactive login prompt or configure it in the agent host's secret environment.

## Configure Local MCP

Prefer the standalone local server because it can stream local files without encoding them into the conversation:

```sh
npx -y @dlvr/mcp@latest
```

Configure the agent's stdio MCP entry to run that command. Let it inherit `DLVR_API_KEY` from the host environment or use the stored authentication created by the CLI. Do not interpolate the key into the MCP registration command.

For stored authentication, install the CLI and let the user enter the key interactively:

```sh
npm install -g @dlvr/cli
dlvr login
dlvr whoami
```

The same package can run an MCP server with `dlvr mcp`. The standalone `@dlvr/mcp` package is the clearer default for an agent configuration.

## Use the CLI Without a Global Install

Node.js 22.12 or newer is required. Run the official package through npx:

```sh
npx -y @dlvr/cli@latest whoami --json
npx -y @dlvr/cli@latest --file ./artifact.zip --json --yes
```

The CLI supports login, logout, account inspection, uploads, and its embedded MCP server. Use local MCP or the SDK for recipient downloads and account delivery management.

## Distinguish Hosted MCP

The hosted endpoint is `https://dlvr.sh/mcp`. It uses OAuth and supports listing, inspecting, and deleting existing deliveries. It cannot access local paths, upload files, or write downloads to the device.

## Interpret Common Errors

- `api_key_required`: configure stored authentication or an inherited secret environment.
- `verified_email_required`: verify the account email before retrying.
- `permanent_email_required`: use a permanent, non-disposable verified address.
- `free_delivery_quota_exceeded`: wait for rolling capacity or let the user choose a paid plan; never upgrade automatically.
- Retention, file-size, active-delivery, or recipient errors: follow the current values returned by the API rather than hard-coded assumptions.
