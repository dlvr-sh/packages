import { expect, mock, test } from "bun:test";
import { isExecutedAsMain, runMain } from "./main";

test("runMain forwards argv and exits with the cli exit code", async () => {
  const runCli = mock(async () => 7);
  const setExitCode = mock(() => undefined);

  const result = await runMain(["--version"], {
    runCli,
    setExitCode,
  });

  expect(runCli).toHaveBeenCalledWith(["--version"]);
  expect(setExitCode).toHaveBeenCalledWith(7);
  expect(result).toBe(7);
});

test("isExecutedAsMain resolves symlinked bin paths", () => {
  const realpath = mock((value: string) => {
    if (value === "/usr/local/bin/dlvr") {
      return "/usr/local/lib/node_modules/@dlvr/cli/dist/cli.js";
    }

    return value;
  });

  expect(
    isExecutedAsMain("/usr/local/bin/dlvr", "/usr/local/lib/node_modules/@dlvr/cli/dist/cli.js", {
      realpath,
    }),
  ).toBe(true);
});
