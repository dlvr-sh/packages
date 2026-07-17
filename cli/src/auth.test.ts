import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, test } from "bun:test";
import { promptForApiKey, resolveAuth, writeStoredAuth } from "./auth";

test("login fails cleanly when API key input reaches EOF", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end();

  const error = await promptForApiKey({ input, output }).catch((caught) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe("API key input closed before a value was entered.");
});

test("login accepts a piped API key before stdin closes", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end("dlvr_test\n");

  expect(await promptForApiKey({ input, output })).toBe("dlvr_test");
});

test("writeStoredAuth replaces permissive credentials with a mode-0600 file", async () => {
  const home = await mkdtemp(join(tmpdir(), "dlvr-auth-"));
  const path = join(home, ".config", "dlvr", "auth.json");

  try {
    await mkdir(join(home, ".config", "dlvr"), { recursive: true });
    await writeFile(path, '{"apiKey":"old-key"}\n');
    await chmod(path, 0o644);

    await writeStoredAuth({ apiKey: "new-key", baseUrl: "https://staging.dlvr.sh" }, { home });

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      apiKey: "new-key",
      baseUrl: "https://staging.dlvr.sh",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolveAuth returns the persisted base URL with the resolved API key", async () => {
  const home = await mkdtemp(join(tmpdir(), "dlvr-auth-"));

  try {
    await writeStoredAuth({ apiKey: "staging-key", baseUrl: "https://staging.dlvr.sh/" }, { home });

    expect(await resolveAuth(undefined, { home, env: {} })).toEqual({
      apiKey: "staging-key",
      baseUrl: "https://staging.dlvr.sh/",
    });
    expect(await resolveAuth(undefined, { home, env: { DLVR_API_KEY: "environment-key" } })).toEqual({
      apiKey: "environment-key",
      baseUrl: "https://staging.dlvr.sh/",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
