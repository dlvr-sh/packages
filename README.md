# dlvr.sh packages

Open-source clients and integrations for [dlvr.sh](https://dlvr.sh), temporary file delivery for humans, automations, and AI agents.

| Package | Purpose |
| --- | --- |
| [`@dlvr/cli`](./cli) | Interactive and automated terminal client |
| [`@dlvr/sdk`](./sdk) | Browser and server JavaScript SDK |
| [`@dlvr/mcp`](./mcp) | Local MCP server for coding agents |
| [`@dlvr/n8n-nodes-dlvr`](./n8n) | n8n workflow and AI Agent integration |
| [`@dlvr/shared`](./shared) | Unpublished protocol source bundled into public clients |

The public packages use the same resumable multipart protocol. File bytes upload directly to signed private-storage URLs; API credentials are sent only to dlvr.sh API routes.

## Development

Requirements: Bun 1.3.14 or newer and Node.js 22.14 or newer.

```bash
bun install --frozen-lockfile
bun run verify
```

`@dlvr/shared` is open source but intentionally remains an unpublished workspace package. Public release artifacts must not contain `workspace:*` dependencies or runtime references to it.

## Releases

Releases are built by `.github/workflows/publish.yml` from package-specific tags and initially published under the npm `next` tag: `cli-vX.Y.Z`, `sdk-vX.Y.Z`, `mcp-vX.Y.Z`, or `n8n-vX.Y.Z`.

After installation and live smoke tests, maintainers promote the exact version to `latest` using npm's interactive WebAuthn flow.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not open a public issue for a suspected vulnerability.

## License

MIT
