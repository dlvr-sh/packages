# @dlvr/mcp

The full local MCP server for dlvr.sh file delivery. Use it with Codex, Claude Code, and other agents that can run a stdio server to upload local files, download shares to disk, and manage existing deliveries.

`@dlvr/mcp` is the recommended MCP integration whenever an agent needs to send or receive files. It reads local paths and streams file bytes directly instead of encoding complete files into the MCP conversation.

## Codex

```bash
codex mcp add dlvr \
  --env DLVR_API_KEY=$DLVR_API_KEY \
  -- npx -y @dlvr/mcp
```

## Claude Code

```bash
claude mcp add dlvr \
  -e DLVR_API_KEY=$DLVR_API_KEY \
  -- npx -y @dlvr/mcp
```

`DLVR_API_KEY` must be an API key from a verified dlvr.sh account with a permanent email. Free personal accounts include 10 deliveries in a rolling 24-hour window shared with browser and other API clients. Public recipient downloads do not require an API key.

## Tools

- `dlvr_upload_file` uploads 1–100 local files with expiry, password, download-limit, and notification options, then returns one share link.
- `dlvr_download_file` streams a public share—or a ZIP for a bundle—to the local filesystem.
- `dlvr_list_uploads`, `dlvr_get_upload`, and `dlvr_delete_upload` manage account-owned deliveries.

## Hosted MCP for AI chats

dlvr.sh also provides `https://dlvr.sh/mcp` for Claude Chat and other hosted AI chats that support remote MCP but cannot run a local stdio server. It uses OAuth and is intentionally limited to listing, inspecting, and deleting existing uploads.

The hosted endpoint cannot read local files, upload a new file, or download a share to the device. It is a management companion, not a replacement for `@dlvr/mcp`.

API keys and hosted OAuth grants are bound to either the personal scope or one Team workspace and cannot cross into another scope.
