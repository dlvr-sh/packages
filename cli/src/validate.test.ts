import { expect, test } from "bun:test";
import { normalizeUploadOptions } from "./validate";
import type { CliConfig } from "./types";

const baseConfig: CliConfig = {
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
    durationOptions: [
      { value: "1h", label: "1 hour", enabled: true },
      { value: "24h", label: "24 hours", enabled: true },
    ],
    fixedDateMinOffsetMs: 300000,
    fixedDateMaxOffsetMs: 604800000,
  },
  limits: {
    maxUploadBytes: 1000,
    maxDownloadsMax: 10000,
    maxNotifyRecipients: 3,
  },
};

test("rejects conflicting expiry inputs", async () => {
  expect(
    normalizeUploadOptions(
      {
        filePaths: ["/tmp/example.zip"],
        emails: [],
        duration: "24h",
        expiresAt: "2026-04-21T12:00:00.000Z",
        json: false,
        quiet: false,
        yes: true,
        help: false,
        version: false,
      },
      baseConfig,
      {
        stat: async () => ({ size: 42, isFile: () => true }),
        resolvePath: (value) => value,
      },
    ),
  ).rejects.toThrow("Choose either a duration or a fixed expiry date");
});

test("normalizes emails and numeric options", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["/tmp/example.zip"],
      emails: ["TEAM@example.com,ops@example.com", "ops@example.com"],
      duration: "24h",
      maxDownloads: "7",
      baseUrl: "https://dlvr.sh/",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => `/abs${value}`,
    },
  );

  expect(normalized).toMatchObject({
    files: [{ filePath: "/abs/tmp/example.zip", fileSize: 42 }],
    emails: ["team@example.com", "ops@example.com"],
    maxDownloads: 7,
    baseUrl: "https://dlvr.sh",
    expiry: { kind: "duration", duration: "24h" },
  });
});

test("normalizes shell-escaped dropped paths before stat", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["/Users/marius/Desktop/Screenshot\\ 2026-04-08\\ at\\ 20.52.12.png "],
      emails: [],
      duration: "24h",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => value,
    },
  );

  expect(normalized.files[0]?.filePath).toBe("/Users/marius/Desktop/Screenshot 2026-04-08 at 20.52.12.png");
});

test("normalizes quoted file paths before stat", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["\"/tmp/quoted file.zip\""],
      emails: [],
      duration: "24h",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => value,
    },
  );

  expect(normalized.files[0]?.filePath).toBe("/tmp/quoted file.zip");
});

test("normalizes file urls before stat", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["file:///tmp/Screenshot%202026-04-08.png"],
      emails: [],
      duration: "24h",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => value,
    },
  );

  expect(normalized.files[0]?.filePath).toBe("/tmp/Screenshot 2026-04-08.png");
});

test("uses api default duration when duration is omitted", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["/tmp/example.zip"],
      emails: [],
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => `/abs${value}`,
    },
  );

  expect(normalized.expiry).toEqual({ kind: "duration", duration: "24h" });
});

test("accepts fixed expiry dates when enabled by the api", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["/tmp/example.zip"],
      emails: [],
      expiresAt: "2026-04-21T12:00:00.000Z",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    baseConfig,
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => `/abs${value}`,
    },
  );

  expect(normalized.expiry).toEqual({ kind: "fixedDate", expiresAt: "2026-04-21T12:00:00.000Z" });
});

test("rejects fixed expiry dates without an explicit timezone", async () => {
  expect(
    normalizeUploadOptions(
      {
        filePaths: ["/tmp/example.zip"],
        emails: [],
        expiresAt: "2026-04-21T12:00:00",
        json: false,
        quiet: false,
        yes: true,
        help: false,
        version: false,
      },
      baseConfig,
      {
        stat: async () => ({ size: 42, isFile: () => true }),
        resolvePath: (value) => `/abs${value}`,
      },
    ),
  ).rejects.toThrow("Fixed expiry date must be a valid ISO date with an explicit timezone");
});

test("preserves manual duration values so the api can enforce plan rules", async () => {
  const normalized = await normalizeUploadOptions(
    {
      filePaths: ["/tmp/example.zip"],
      emails: [],
      duration: "7d",
      json: false,
      quiet: false,
      yes: true,
      help: false,
      version: false,
    },
    {
      ...baseConfig,
      expiry: {
        ...baseConfig.expiry,
        durationOptions: [{ value: "24h", label: "24 hours", enabled: true }],
      },
    },
    {
      stat: async () => ({ size: 42, isFile: () => true }),
      resolvePath: (value) => `/abs${value}`,
    },
  );

  expect(normalized.expiry).toEqual({ kind: "duration", duration: "7d" });
});

test("honors api-required recipients", async () => {
  expect(
    normalizeUploadOptions(
      {
        filePaths: ["/tmp/example.zip"],
        emails: [],
        json: false,
        quiet: false,
        yes: true,
        help: false,
        version: false,
      },
      {
        ...baseConfig,
        fields: {
          ...baseConfig.fields,
          recipients: { enabled: true, required: true, multiple: true },
        },
      },
      {
        stat: async () => ({ size: 42, isFile: () => true }),
        resolvePath: (value) => `/abs${value}`,
      },
    ),
  ).rejects.toThrow("Recipient email is required");
});

test("rejects more than the api-configured recipient limit", async () => {
  expect(
    normalizeUploadOptions(
      {
        filePaths: ["/tmp/example.zip"],
        emails: [
          "team@example.com",
          "ops@example.com",
          "dev@example.com",
          "fourth@example.com",
        ],
        json: false,
        quiet: false,
        yes: true,
        help: false,
        version: false,
      },
      baseConfig,
      {
        stat: async () => ({ size: 42, isFile: () => true }),
        resolvePath: (value) => `/abs${value}`,
      },
    ),
  ).rejects.toThrow("No more than 3 recipient emails are allowed");
});
