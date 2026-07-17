import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveApiKey } from "../../cli/src/auth";
import { DEFAULT_BASE_URL } from "../../cli/src/constants";
import { runMcpServer } from "../../cli/src/mcp-server";
import packageJson from "../package.json";

interface McpCliArgs {
  apiKey?: string;
  baseUrl?: string;
  help: boolean;
  version: boolean;
}

interface MainDetectionDeps {
  realpath?: (path: string) => string;
}

export function getHelpText() {
  return `Usage:
  dlvr-mcp
  dlvr-mcp --api-key dlvr_...

Options:
  --api-key <value>  API key for upload/management tools; defaults to DLVR_API_KEY or stored auth. Public downloads do not require one.
  -u, --url <value>  Base URL, defaults to https://dlvr.sh
  -h, --help         Show help
  -v, --version      Show version`;
}

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function parseMcpCliArgs(argv: string[]): McpCliArgs {
  const parsed: McpCliArgs = {
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--api-key":
        parsed.apiKey = takeValue(argv, index, arg);
        index += 1;
        break;
      case "-u":
      case "--url":
        parsed.baseUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

async function getVersion() {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const contents = await readFile(fileURLToPath(packageJsonUrl), "utf8");
  const parsed = JSON.parse(contents) as { version?: string };
  return parsed.version || "0.0.0";
}

export async function runMcpCli(argv: string[]) {
  try {
    const parsed = parseMcpCliArgs(argv);

    if (parsed.help) {
      process.stdout.write(`${getHelpText()}\n`);
      return 0;
    }

    if (parsed.version) {
      process.stdout.write(`${await getVersion()}\n`);
      return 0;
    }

    await runMcpServer({
      baseUrl: (parsed.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""),
      apiKey: await resolveApiKey(parsed.apiKey),
      version: packageJson.version,
    });

    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function isExecutedAsMain(
  argvPath: string | undefined,
  modulePath: string,
  deps: MainDetectionDeps = {},
) {
  if (!argvPath) {
    return false;
  }

  const resolveRealPath = deps.realpath ?? realpathSync;
  return resolveRealPath(argvPath) === resolveRealPath(modulePath);
}

if (isExecutedAsMain(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = await runMcpCli(process.argv.slice(2));
}
