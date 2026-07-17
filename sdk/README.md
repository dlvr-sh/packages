# @dlvr/sdk

Browser and server SDK for dlvr.sh file delivery.

Programmatic API access requires a paid dlvr.sh plan and an account API key from
`https://dlvr.sh/account/api/`.

```ts
import { createDlvrClient, loginWithDlvr } from "@dlvr/sdk";

// Browser apps can send users to the hosted dlvr.sh login/API-key flow.
loginWithDlvr();

const dlvr = createDlvrClient({ apiKey: process.env.DLVR_API_KEY });
const upload = await dlvr.uploadFile({
  file: new File(["hello"], "hello.txt", { type: "text/plain" }),
  duration: "24h",
  notifyEmails: ["team@example.com"],
});

console.log(upload.url);
```

Recipient downloads do not require an API key. Single-file shares stream the file response; bundles resolve and stream a ZIP:

```ts
const response = await createDlvrClient().downloadFile({
  shareId: "a1c94e2f",
  password: "secret", // Omit when the share has no password.
});

await writeFile("./artifact.zip", new Uint8Array(await response.arrayBuffer()));
```

After Stripe Connect onboarding, owners and admins can create a paid transfer with additive options such as `paidEnabled: true`, `priceUsd: 9`, and `taxCode: "txcd_10000000"`. The tax code defaults to the general electronically supplied digital product category.

Every file uses the resumable multipart protocol and uploads directly to the configured object store. File bytes do not pass through the dlvr Worker.

Upload a bundle and persist its capability for resume:

```ts
let session;
const upload = await dlvr.uploadFiles({
  files: [{ file: firstFile }, { file: secondFile }],
  duration: "24h",
  concurrency: 4,
  onSession(value) {
    session = value; // Store securely; it contains a short-lived upload capability.
  },
  onProgress({ uploadedBytes, totalBytes }) {
    console.log(`${uploadedBytes}/${totalBytes}`);
  },
});

// After an interruption, reselect the identical files and use:
await dlvr.resumeUpload(session, [{ file: firstFile }, { file: secondFile }]);
```

`uploadFile()` is a convenience wrapper around `uploadFiles()`. Abort a local request with `signal`; call `cancelUpload(session)` only when the remote upload should be permanently aborted.

The SDK does not proxy Hanko credentials. Login stays on dlvr.sh, including
Turnstile and the Hanko session, then users create API keys for REST API, SDK,
CLI, and MCP access.

An API key can be bound to a Team workspace. Upload session, result, and summary types expose additive `workspace` information when the active key is workspace-scoped; no new upload parameter is required.
