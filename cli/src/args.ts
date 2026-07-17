import type { CliArgs } from "./types";

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function getHelpText() {
  return `Usage:
  dlvr --file ./artifact.zip --email team@example.com --duration 24h
  dlvr login
  dlvr logout
  dlvr whoami
  dlvr mcp
  dlvr

Options:
  -f, --file <path>            File to upload, repeatable (up to 100)
  -e, --email <value>          Notification email, repeatable or comma-separated
  -d, --duration <value>       One of 1h, 24h, 3d, 7d
  --expires-at <value>         Fixed expiry date in ISO 8601 format
  -m, --max-downloads <value>  Optional download limit
  -u, --url <value>            Base URL, defaults to https://dlvr.sh
  --json                       Print JSON output
  --quiet                      Suppress progress text
  --yes                        Never prompt for missing values
  -h, --help                   Show help
  -v, --version                Show version`;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    command: "upload",
    filePaths: [],
    emails: [],
    json: false,
    quiet: false,
    yes: false,
    help: false,
    version: false,
  };

  if (argv[0] === "login" || argv[0] === "logout" || argv[0] === "whoami" || argv[0] === "mcp") {
    parsed.command = argv[0];
    argv = argv.slice(1);
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-f":
      case "--file":
        parsed.filePaths.push(takeValue(argv, index, arg));
        index += 1;
        break;
      case "-e":
      case "--email":
        parsed.emails.push(takeValue(argv, index, arg));
        index += 1;
        break;
      case "-d":
      case "--duration":
        parsed.duration = takeValue(argv, index, arg);
        index += 1;
        break;
      case "-p":
      case "--password":
        throw new Error("Password flags are unsafe. Use DLVR_DOWNLOAD_PASSWORD or the interactive form.");
      case "--expires-at":
        parsed.expiresAt = takeValue(argv, index, arg);
        index += 1;
        break;
      case "-m":
      case "--max-downloads":
        parsed.maxDownloads = takeValue(argv, index, arg);
        index += 1;
        break;
      case "-u":
      case "--url":
        parsed.baseUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--api-key":
        throw new Error("API key flags are unsafe. Use `dlvr login` or DLVR_API_KEY.");
      case "--json":
        parsed.json = true;
        break;
      case "--quiet":
        parsed.quiet = true;
        break;
      case "--yes":
        parsed.yes = true;
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
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}
