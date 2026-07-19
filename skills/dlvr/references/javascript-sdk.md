# JavaScript SDK

Read this reference only when implementing dlvr.sh delivery inside a JavaScript or TypeScript application. Prefer local MCP or the CLI for a one-off agent transfer.

## Create a Client

Install `@dlvr/sdk` and keep API keys in the runtime's secret storage:

```sh
npm install @dlvr/sdk
```

```ts
import { createDlvrClient } from "@dlvr/sdk";

const dlvr = createDlvrClient({ apiKey: process.env.DLVR_API_KEY });
```

Use `loginWithDlvr()` or `getDlvrLoginUrl()` only for a browser flow that sends the user to hosted dlvr.sh login and API-key creation. Never bundle a shared server credential into browser code.

## Upload

Upload one file:

```ts
const result = await dlvr.uploadFile({
  file,
  duration: "24h",
  notifyEmails: ["team@example.com"],
});

console.log(result.url);
```

Upload one delivery containing multiple files:

```ts
const result = await dlvr.uploadFiles({
  files: [{ file: report }, { file: data }],
  duration: "24h",
  onProgress({ uploadedBytes, totalBytes }) {
    console.log(`${uploadedBytes}/${totalBytes}`);
  },
  onSession(session) {
    persistSecurely(session);
  },
});
```

The session contains a short-lived upload capability. Store it as a secret and pass it with the identical files to `resumeUpload()` after interruption. Use `AbortSignal` to stop a local request; call `cancelUpload(session)` only when the remote upload should be permanently aborted.

Use either `duration` or `expiresAt`, never both. Add `password`, `maxDownloads`, notification recipients, concurrency, or callbacks only as required by the application.

## Download

Recipient downloads need no API key:

```ts
const publicDlvr = createDlvrClient();
const response = await publicDlvr.downloadFile({
  shareId: "a1c94e2f",
  password: suppliedPassword,
});

const bytes = new Uint8Array(await response.arrayBuffer());
```

The SDK resolves multi-file shares to a ZIP response. Stream the response when possible instead of buffering large downloads as shown in the compact example.

## Manage Account Deliveries

Use the authenticated client:

```ts
const { uploads } = await dlvr.listUploads();
const { upload } = await dlvr.getUpload(uploadId);
await dlvr.deleteUpload(uploadId);
```

Require explicit deletion intent before `deleteUpload()`. Catch `DlvrApiError` and surface its `status`, `code`, and message without logging credentials, upload sessions, or signed URLs.
