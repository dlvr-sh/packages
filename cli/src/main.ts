import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli";

interface RunMainDeps {
  runCli?: (argv: string[]) => Promise<number>;
  setExitCode?: (code: number) => void;
}

interface MainDetectionDeps {
  realpath?: (path: string) => string;
}

export async function runMain(argv: string[] = process.argv.slice(2), deps: RunMainDeps = {}) {
  const execute = deps.runCli ?? runCli;
  const setExitCode = deps.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  const exitCode = await execute(argv);
  setExitCode(exitCode);
  return exitCode;
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

const isMain = isExecutedAsMain(process.argv[1], fileURLToPath(import.meta.url));

if (isMain) {
  await runMain();
}
