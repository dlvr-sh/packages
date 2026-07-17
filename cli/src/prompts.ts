import { runTerminalForm } from "./tui";
import type { CliArgs, CliConfig } from "./types";

export async function promptForMissingOptions(initial: CliArgs, config: CliConfig): Promise<CliArgs> {
  return runTerminalForm(initial, config);
}
