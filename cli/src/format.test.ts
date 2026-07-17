import { expect, test } from "bun:test";
import { formatError, formatSuccess } from "./format";

test("formats plain output", () => {
  const output = formatSuccess(
    {
      id: "abc123",
      url: "https://dlvr.sh/f/abc123/",
      expires: "2026-04-20T12:00:00.000Z",
      filename: "artifact.zip",
      size: 123,
      downloads: 0,
      maxDownloads: 5,
      passwordRequired: true,
    },
    { json: false },
  );

  expect(output).toContain("https://dlvr.sh/f/abc123/");
  expect(output).toContain("artifact.zip");
  expect(output).not.toContain("Upload mode");
});

test("formats json errors", () => {
  const output = formatError(
    { message: "Upload failed", error: "Upload failed", status: 500 },
    { json: true },
  );

  expect(JSON.parse(output)).toEqual({
    message: "Upload failed",
    error: "Upload failed",
    status: 500,
  });
});
