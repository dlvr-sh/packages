import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  test("parses day-one flags", () => {
    expect(
      parseCliArgs([
        "--file",
        "./artifact.zip",
        "--email",
        "team@example.com,ops@example.com",
        "--email",
        "hello@example.com",
        "--duration",
        "24h",
        "--expires-at",
        "2026-04-30T12:00:00.000Z",
        "--max-downloads",
        "5",
        "--url",
        "https://example.com/",
        "--json",
        "--quiet",
        "--yes",
      ]),
    ).toEqual({
      command: "upload",
      filePaths: ["./artifact.zip"],
      emails: ["team@example.com,ops@example.com", "hello@example.com"],
      duration: "24h",
      expiresAt: "2026-04-30T12:00:00.000Z",
      maxDownloads: "5",
      baseUrl: "https://example.com/",
      json: true,
      quiet: true,
      yes: true,
      help: false,
      version: false,
    });
  });

  test("treats no args as interactive mode candidate", () => {
    expect(parseCliArgs([])).toEqual({
      command: "upload",
      emails: [],
      filePaths: [],
      json: false,
      quiet: false,
      yes: false,
      help: false,
      version: false,
    });
  });

  test("parses auth commands and rejects secrets in process arguments", () => {
    expect(parseCliArgs(["login"])).toMatchObject({ command: "login" });
    expect(parseCliArgs(["mcp"])).toMatchObject({ command: "mcp" });
    expect(() => parseCliArgs(["--api-key", "dlvr_test"])).toThrow("unsafe");
    expect(() => parseCliArgs(["--password", "secret"])).toThrow("unsafe");
  });
});
