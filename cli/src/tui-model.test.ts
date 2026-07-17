import { expect, test } from "bun:test";
import { buildCliArgsFromForm, createFormState, cycleActiveFieldOption, moveActiveField } from "./tui-model";
import type { CliConfig } from "./types";

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
    durationOptions: [
      { value: "1h", label: "1 hour", enabled: true },
      { value: "24h", label: "24 hours", enabled: true },
      { value: "3d", label: "3 days", enabled: true },
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

test("cycles duration options with arrow-key style movement", () => {
  const state = createFormState(
    {
      filePaths: ["./artifact.zip"],
      emails: [],
      json: false,
      quiet: false,
      yes: false,
      help: false,
      version: false,
    },
    config,
  );

  state.activeFieldId = "duration";
  cycleActiveFieldOption(state, config, 1);

  expect(state.duration).toBe("3d");
});

test("switches to fixed-date mode and preserves multiple recipients", () => {
  const state = createFormState(
    {
      filePaths: ["./artifact.zip"],
      emails: ["a@example.com,b@example.com"],
      json: false,
      quiet: false,
      yes: false,
      help: false,
      version: false,
    },
    config,
  );

  state.activeFieldId = "expiryMode";
  cycleActiveFieldOption(state, config, 1);
  state.expiresAt = "2026-04-21T12:00:00.000Z";

  expect(buildCliArgsFromForm(state)).toMatchObject({
    emails: ["a@example.com,b@example.com"],
    expiresAt: "2026-04-21T12:00:00.000Z",
    duration: undefined,
  });
});

test("moves across visible fields", () => {
  const state = createFormState(
    {
      filePaths: [],
      emails: [],
      json: false,
      quiet: false,
      yes: false,
      help: false,
      version: false,
    },
    config,
  );

  moveActiveField(state, config, 1);

  expect(state.activeFieldId).toBe("recipients");
});
