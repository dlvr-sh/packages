import React from "react";
import { render } from "ink";
import { stdin, stdout } from "node:process";
import { TerminalFormApp } from "./tui-app";
import type { CliArgs, CliConfig } from "./types";

async function fallbackPrompt(initial: CliArgs, config: CliConfig): Promise<CliArgs> {
  return {
    ...initial,
    duration: initial.duration ?? config.expiry.defaultDuration,
  };
}

export async function runTerminalForm(initial: CliArgs, config: CliConfig): Promise<CliArgs> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return fallbackPrompt(initial, config);
  }

  return await new Promise<CliArgs>((resolve, reject) => {
    let settled = false;

    const instance = render(
      React.createElement(TerminalFormApp, {
        initial,
        config,
        onSubmit: (value) => {
          if (settled) {
            return;
          }

          settled = true;
          instance.unmount();
          resolve(value);
        },
        onCancel: (error) => {
          if (settled) {
            return;
          }

          settled = true;
          instance.unmount();
          reject(error);
        },
      }),
      {
        stdin,
        stdout,
        exitOnCtrlC: false,
      },
    );
  });
}
