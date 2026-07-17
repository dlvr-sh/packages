import { expect, mock, test } from "bun:test";
import { runCli } from "./cli";
import type { CliArgs, CliConfig, NormalizedUploadOptions, UploadResult } from "./types";

const config: CliConfig = {
  ui: { title: "dlvr", submitLabel: "Upload" },
  fields: {
    filePath: { enabled: true, required: true },
    recipients: { enabled: true, required: false, multiple: true },
    duration: { enabled: true, required: false },
    expiresAt: { enabled: true, required: false },
    password: { enabled: true, required: false },
    maxDownloads: { enabled: true, required: false },
  },
  expiry: {
    allowDuration: true,
    allowFixedDate: true,
    modeDefault: "duration",
    defaultDuration: "24h",
    durationOptions: [{ value: "24h", label: "24 hours", enabled: true }],
    fixedDateMinOffsetMs: 300000,
    fixedDateMaxOffsetMs: 604800000,
  },
  limits: {
    maxUploadBytes: 1000,
    maxDownloadsMax: 10000,
    maxNotifyRecipients: 3,
  },
};

test("prompts when no args are provided", async () => {
  const prompt = mock(async (): Promise<CliArgs> => ({
    filePaths: ["./artifact.zip"],
    emails: ["team@example.com"],
    duration: "24h",
    json: false,
    quiet: false,
    yes: false,
    help: false,
    version: false,
  }));

  const normalize = mock(async (): Promise<NormalizedUploadOptions> => ({
    files: [{ filePath: "/abs/artifact.zip", filename: "artifact.zip", fileSize: 42, mtimeMs: 0 }],
    expiry: { kind: "duration", duration: "24h" },
    emails: ["team@example.com"],
    baseUrl: "https://dlvr.sh",
    json: false,
    quiet: false,
  }));

  const upload = mock(async (): Promise<UploadResult> => ({
    id: "abc123",
    url: "https://dlvr.sh/f/abc123/",
    expires: "2026-04-20T12:00:00.000Z",
    filename: "artifact.zip",
    size: 42,
    downloads: 0,
    maxDownloads: null,
    passwordRequired: false,
  }));

  const writes: string[] = [];

  const exitCode = await runCli([], {
    fetchCliConfig: async () => config,
    resolveApiKey: async () => "dlvr_test",
    promptForMissingOptions: prompt,
    normalizeUploadOptions: normalize,
    uploadFiles: upload,
    writeStdout: (value) => {
      writes.push(value);
    },
  });

  expect(exitCode).toBe(0);
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(writes.join("")).toContain("https://dlvr.sh/f/abc123/");
});

test("prints help without uploading", async () => {
  const writes: string[] = [];
  const upload = mock(async () => {
    throw new Error("should not upload on --help");
  });

  const exitCode = await runCli(["--help"], {
    fetchCliConfig: async () => config,
    uploadFiles: upload,
    writeStdout: (value) => {
      writes.push(value);
    },
  });

  expect(exitCode).toBe(0);
  expect(upload).not.toHaveBeenCalled();
  expect(writes.join("")).toContain("Usage:");
});

test("uses api default duration when duration is omitted", async () => {
  const normalize = mock(async (): Promise<NormalizedUploadOptions> => ({
    files: [{ filePath: "/abs/artifact.zip", filename: "artifact.zip", fileSize: 42, mtimeMs: 0 }],
    expiry: { kind: "duration", duration: "24h" },
    emails: [],
    baseUrl: "https://dlvr.sh",
    json: false,
    quiet: false,
  }));

  const upload = mock(async (): Promise<UploadResult> => ({
    id: "abc123",
    url: "https://dlvr.sh/f/abc123/",
    expires: "2026-04-20T12:00:00.000Z",
    filename: "artifact.zip",
    size: 42,
    downloads: 0,
    maxDownloads: null,
    passwordRequired: false,
  }));

  const exitCode = await runCli(["--file", "./artifact.zip"], {
    fetchCliConfig: async () => config,
    resolveApiKey: async () => "dlvr_test",
    normalizeUploadOptions: normalize,
    uploadFiles: upload,
  });

  expect(exitCode).toBe(0);
  expect(normalize).toHaveBeenCalled();
});

test("stores api key on login after validating config", async () => {
  const writes: string[] = [];
  const store = mock(async () => {});

  const exitCode = await runCli(["login"], {
    fetchCliConfig: async () => ({ ...config, account: { plan: "pro", planName: "Pro" } }),
    promptForApiKey: async () => "dlvr_test",
    writeStoredAuth: store,
    writeStdout: (value) => {
      writes.push(value);
    },
  });

  expect(exitCode).toBe(0);
  expect(store).toHaveBeenCalledWith({ apiKey: "dlvr_test", baseUrl: "https://dlvr.sh" });
  expect(writes.join("")).toContain("Logged in.");
});

test("uses the base URL persisted by login for later commands", async () => {
  let storedAuth: { apiKey: string; baseUrl?: string } | null = null;
  const getStoredAuth = () => storedAuth;
  const configUrls: string[] = [];
  const fetchConfig = mock(async (baseUrl: string) => {
    configUrls.push(baseUrl);
    return { ...config, account: { plan: "pro" as const, planName: "Pro" } };
  });

  expect(await runCli(["login", "--url", "https://staging.dlvr.sh///"], {
    fetchCliConfig: fetchConfig,
    promptForApiKey: async () => "staging-key",
    writeStoredAuth: async (auth) => {
      storedAuth = auth;
    },
    writeStdout: () => undefined,
  })).toBe(0);
  expect(getStoredAuth()).toEqual({ apiKey: "staging-key", baseUrl: "https://staging.dlvr.sh" });

  const normalize = mock(async (args: CliArgs): Promise<NormalizedUploadOptions> => ({
    files: [{ filePath: "/abs/artifact.bin", filename: "artifact.bin", fileSize: 5, mtimeMs: 0 }],
    emails: [],
    baseUrl: args.baseUrl!,
    json: false,
    quiet: true,
    expiry: { kind: "duration", duration: "24h" },
  }));
  const upload = mock(async (_options: NormalizedUploadOptions): Promise<UploadResult> => ({
    id: "share-1",
    url: "https://staging.dlvr.sh/f/share-1/",
    expires: "2099-01-01T00:00:00.000Z",
    filename: "artifact.bin",
    size: 5,
    downloads: 0,
    maxDownloads: null,
    passwordRequired: false,
  }));
  expect(await runCli(["--file", "./artifact.bin", "--yes", "--quiet"], {
    fetchCliConfig: fetchConfig,
    resolveAuth: async () => getStoredAuth(),
    normalizeUploadOptions: normalize,
    uploadFiles: upload,
    writeStdout: () => undefined,
  })).toBe(0);

  expect(configUrls).toEqual(["https://staging.dlvr.sh", "https://staging.dlvr.sh"]);
  expect(normalize.mock.calls[0]?.[0].baseUrl).toBe("https://staging.dlvr.sh");
  expect(upload.mock.calls[0]?.[0].baseUrl).toBe("https://staging.dlvr.sh");
});

test("reads scripted download passwords from the environment", async () => {
  const normalize = mock(async (args: CliArgs) => ({
    files: [{ filePath: "/tmp/file.zip", filename: "file.zip", fileSize: 1, mtimeMs: 0 }],
    emails: [],
    password: args.password,
    baseUrl: "https://dlvr.sh",
    json: false,
    quiet: false,
    expiry: { kind: "duration" as const, duration: "24h" },
  }));
  const upload = mock(async (): Promise<UploadResult> => ({
    id: "share-1",
    url: "https://dlvr.sh/f/share-1/",
    expires: "2026-07-11T00:00:00.000Z",
    filename: "file.zip",
    size: 1,
    downloads: 0,
    maxDownloads: null,
    passwordRequired: true,
  }));

  const exitCode = await runCli(["--file", "/tmp/file.zip", "--yes"], {
    env: { DLVR_DOWNLOAD_PASSWORD: "secret-from-env" },
    fetchCliConfig: async () => config,
    resolveApiKey: async () => "dlvr_test",
    normalizeUploadOptions: normalize,
    uploadFiles: upload,
    writeStdout: () => undefined,
  });

  expect(exitCode).toBe(0);
  expect(normalize.mock.calls[0]?.[0].password).toBe("secret-from-env");
});
