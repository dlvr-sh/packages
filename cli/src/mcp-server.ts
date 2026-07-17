import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageJson from "../package.json";
import { fetchCliConfig } from "./config-client";
import { DEFAULT_BASE_URL } from "./constants";
import { deleteUpload, getUpload, listUploads } from "./api-client";
import { downloadShareToFile } from "./download-client";
import { uploadFiles } from "./upload-client";
import { normalizeUploadOptions } from "./validate";

interface McpServerOptions {
  baseUrl?: string;
  apiKey?: string;
  version?: string;
}

function textJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function requireApiKey(apiKey?: string) {
  if (!apiKey) {
    throw new Error("API key required. Run `dlvr login` or set DLVR_API_KEY.");
  }

  return apiKey;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const apiKey = options.apiKey;
  const server = new McpServer({ name: "dlvr", version: options.version ?? packageJson.version });

  server.registerTool(
    "dlvr_download_file",
    {
      description: "Download a public dlvr.sh share to the local filesystem. Bundles are saved as ZIP files.",
      inputSchema: z.object({
        shareUrl: z.string().describe("A dlvr.sh /f/:shareId/ URL or bare share id."),
        outputPath: z.string().describe("Local path where the file or ZIP should be written."),
        password: z.string().optional().describe("Download password when the share is protected."),
        overwrite: z.boolean().optional().describe("Replace an existing output file. Defaults to false."),
      }),
    },
    async (input) => textJson(await downloadShareToFile({
      baseUrl,
      shareUrl: input.shareUrl,
      outputPath: input.outputPath,
      password: input.password,
      overwrite: input.overwrite,
    })),
  );

  server.registerTool(
    "dlvr_upload_file",
    {
      description: "Upload up to 100 local files to dlvr.sh and return one share link.",
      inputSchema: z.object({
        filePaths: z.array(z.string()).min(1).max(100).describe("Absolute or relative paths to local files."),
        duration: z.string().optional().describe("Expiry duration such as 1h, 24h, 3d, or 7d."),
        expiresAt: z.string().optional().describe("Fixed ISO 8601 expiry date with timezone."),
        password: z.string().optional().describe("Optional download password."),
        maxDownloads: z.number().int().positive().optional().describe("Optional download limit."),
        notifyEmails: z.array(z.email()).optional().describe("Optional notification recipients."),
      }),
    },
    async (input) => {
      const authenticatedApiKey = requireApiKey(apiKey);
      const config = await fetchCliConfig(baseUrl, authenticatedApiKey);
      const normalized = await normalizeUploadOptions(
        {
          command: "upload",
          filePaths: input.filePaths,
          emails: input.notifyEmails ?? [],
          duration: input.duration,
          expiresAt: input.expiresAt,
          password: input.password,
          maxDownloads: input.maxDownloads ? String(input.maxDownloads) : undefined,
          baseUrl,
          apiKey: authenticatedApiKey,
          json: true,
          quiet: true,
          yes: true,
          help: false,
          version: false,
        },
        config,
      );

      return textJson(await uploadFiles(normalized));
    },
  );

  server.registerTool(
    "dlvr_list_uploads",
    {
      description: "List recent account uploads for the authenticated dlvr.sh account.",
      inputSchema: z.object({}),
    },
    async () => textJson(await listUploads(baseUrl, requireApiKey(apiKey))),
  );

  server.registerTool(
    "dlvr_get_upload",
    {
      description: "Get metadata for one account-owned dlvr.sh upload.",
      inputSchema: z.object({
        id: z.string().describe("Account upload id."),
      }),
    },
    async ({ id }) => textJson(await getUpload(baseUrl, requireApiKey(apiKey), id)),
  );

  server.registerTool(
    "dlvr_delete_upload",
    {
      description: "Delete one account-owned dlvr.sh upload and its stored files.",
      inputSchema: z.object({
        id: z.string().describe("Account upload id."),
      }),
    },
    async ({ id }) => textJson(await deleteUpload(baseUrl, requireApiKey(apiKey), id)),
  );

  return server;
}

export async function runMcpServer(options: McpServerOptions = {}) {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
