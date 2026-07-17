import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { CliArgs, CliConfig } from "./types";
import { TerminalFormApp } from "./tui-app";

const config: CliConfig = {
  ui: { title: "dlvr", submitLabel: "Upload", note: "Use arrows to move." },
  fields: {
    filePath: { enabled: true, required: true, label: "File" },
    recipients: { enabled: true, required: false, multiple: true, label: "Recipients" },
    duration: { enabled: true, required: false, label: "Duration" },
    expiresAt: { enabled: true, required: false, label: "Expires at" },
    password: { enabled: true, required: false, label: "Password" },
    maxDownloads: { enabled: true, required: false, label: "Max downloads" },
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

const initial: CliArgs = {
  filePaths: [],
  emails: [],
  json: false,
  quiet: false,
  yes: false,
  help: false,
  version: false,
};

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("renders the full form and moves the active row", async () => {
  const { lastFrame, stdin, unmount } = render(
    <TerminalFormApp
      initial={initial}
      config={config}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );

  expect(lastFrame()).toContain("dlvr");
  expect(lastFrame()).toContain("> File:");
  expect(lastFrame()).toContain("Recipients:");
  expect(lastFrame()).toContain("Duration:");
  expect(lastFrame()).toContain("Action:");

  stdin.write("\u001B[B");
  await flush();

  expect(lastFrame()).toContain("> Recipients:");
  unmount();
});

test("cycles duration options and switches expiry mode", async () => {
  const { lastFrame, stdin, unmount } = render(
    <TerminalFormApp
      initial={initial}
      config={config}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );

  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  await flush();
  expect(lastFrame()).toContain("> Duration: 24 hours");

  stdin.write("\u001B[C");
  await flush();
  expect(lastFrame()).toContain("> Duration: 3 days");

  stdin.write("\u001B[A");
  stdin.write("\u001B[C");
  await flush();

  expect(lastFrame()).toContain("> Expiry mode: Fixed date");
  expect(lastFrame()).toContain("Expires at:");
  unmount();
});

test("submits the current form values", async () => {
  let submitted: CliArgs | undefined;

  const { lastFrame, stdin, unmount } = render(
    <TerminalFormApp
      initial={{
        ...initial,
        emails: ["team@example.com,ops@example.com"],
      }}
      config={config}
      onSubmit={(value) => {
        submitted = value;
      }}
      onCancel={() => {}}
    />,
  );

  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  stdin.write("\u001B[B");
  await flush();
  expect(lastFrame()).toContain("team@example.com,ops@example.com");
  expect(lastFrame()).toContain("> Action:");
  stdin.write("\r");
  await flush();

  expect(submitted).toMatchObject({
    emails: ["team@example.com,ops@example.com"],
    duration: "24h",
    expiresAt: undefined,
  });
  unmount();
});
