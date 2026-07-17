import { expect, mock, test } from "bun:test";
import { getHelpText, isExecutedAsMain, parseMcpCliArgs } from "./main";

test("parses MCP server options", () => {
  expect(parseMcpCliArgs(["--api-key", "dlvr_test", "--url", "https://example.com"])).toEqual({
    apiKey: "dlvr_test",
    baseUrl: "https://example.com",
    help: false,
    version: false,
  });
});

test("documents the dedicated MCP binary", () => {
  expect(getHelpText()).toContain("dlvr-mcp");
  expect(getHelpText()).toContain("DLVR_API_KEY");
  expect(getHelpText()).toContain("Public downloads do not require one");
});

test("local MCP source exposes a streaming public download tool", async () => {
  const source = await Bun.file(new URL("../../cli/src/mcp-server.ts", import.meta.url)).text();
  expect(source).toContain('"dlvr_download_file"');
  expect(source).toContain("downloadShareToFile");
});

test("resolves symlinked npm bin paths", () => {
  const realpath = mock((value: string) => {
    if (value === "/usr/local/bin/dlvr-mcp") {
      return "/usr/local/lib/node_modules/@dlvr/mcp/dist/mcp.js";
    }

    return value;
  });

  expect(
    isExecutedAsMain("/usr/local/bin/dlvr-mcp", "/usr/local/lib/node_modules/@dlvr/mcp/dist/mcp.js", {
      realpath,
    }),
  ).toBe(true);
});
