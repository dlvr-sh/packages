import { expect, mock, test } from "bun:test";
import { fetchCliConfig } from "./config-client";

test("loads dynamic cli config from the api", async () => {
  const fetchMock = mock(async () =>
    new Response(
      JSON.stringify({
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
          fixedDateMaxOffsetMs: 604800000,
          fixedDateMinOffsetMs: 300000,
        },
        limits: {
          maxUploadBytes: 100,
          maxDownloadsMax: 10000,
          maxNotifyRecipients: 3,
        },
      }),
      { status: 200 },
    ),
  );

  const config = await fetchCliConfig("https://dlvr.sh", "dlvr_test", { fetch: fetchMock });

  expect(config.expiry.defaultDuration).toBe("24h");
  expect(config.fields.recipients.multiple).toBe(true);
  expect(config.limits.maxNotifyRecipients).toBe(3);
  expect(fetchMock).toHaveBeenCalledWith("https://dlvr.sh/api/cli/config", {
    headers: {
      authorization: "Bearer dlvr_test",
    },
  });
});
