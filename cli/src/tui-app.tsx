import { useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import {
  buildCliArgsFromForm,
  createFormState,
  cycleActiveFieldOption,
  getVisibleFieldIds,
  moveActiveField,
  type FormFieldId,
  type TuiFormState,
} from "./tui-model";
import type { CliArgs, CliConfig } from "./types";

interface TerminalFormAppProps {
  initial: CliArgs;
  config: CliConfig;
  onSubmit: (value: CliArgs) => void;
  onCancel: (error: Error) => void;
}

function getFieldLabel(fieldId: FormFieldId, config: CliConfig) {
  if (fieldId === "submit") {
    return "Action";
  }

  if (fieldId === "expiryMode") {
    return "Expiry mode";
  }

  return config.fields[fieldId as keyof CliConfig["fields"]]?.label ?? fieldId;
}

function getFieldValue(fieldId: FormFieldId, state: TuiFormState, config: CliConfig) {
  switch (fieldId) {
    case "filePath":
      return state.filePath || "(required)";
    case "recipients":
      return state.recipientsInput || "(optional, comma-separated)";
    case "expiryMode":
      return state.expiryMode === "duration" ? "Duration" : "Fixed date";
    case "duration":
      return config.expiry.durationOptions.find((value) => value.value === state.duration)?.label ?? state.duration;
    case "expiresAt":
      return state.expiresAt || "(ISO 8601 with timezone)";
    case "password":
      return state.password ? "•".repeat(state.password.length) : "(optional)";
    case "maxDownloads":
      return state.maxDownloads || "(optional)";
    case "submit":
      return config.ui.submitLabel;
  }
}

function getRawFieldValue(fieldId: FormFieldId, state: TuiFormState) {
  switch (fieldId) {
    case "filePath":
      return state.filePath;
    case "recipients":
      return state.recipientsInput;
    case "expiresAt":
      return state.expiresAt;
    case "password":
      return state.password;
    case "maxDownloads":
      return state.maxDownloads;
    default:
      return "";
  }
}

function setFieldValue(fieldId: FormFieldId, state: TuiFormState, value: string) {
  switch (fieldId) {
    case "filePath":
      state.filePath = value;
      break;
    case "recipients":
      state.recipientsInput = value;
      break;
    case "expiresAt":
      state.expiresAt = value;
      break;
    case "password":
      state.password = value;
      break;
    case "maxDownloads":
      state.maxDownloads = value;
      break;
    default:
      break;
  }
}

function isTextField(fieldId: FormFieldId) {
  return fieldId === "filePath" || fieldId === "recipients" || fieldId === "expiresAt" || fieldId === "password" || fieldId === "maxDownloads";
}

export function TerminalFormApp({ initial, config, onSubmit, onCancel }: TerminalFormAppProps) {
  const [state, setState] = useState(() => createFormState(initial, config));
  const stateRef = useRef(state);
  stateRef.current = state;

  const visibleFieldIds = useMemo(() => getVisibleFieldIds(state, config), [state, config]);

  const patchState = (mutate: (next: TuiFormState) => void) => {
    setState((previous) => {
      const next = { ...previous };
      mutate(next);
      return next;
    });
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onCancel(new Error("Prompt cancelled"));
      return;
    }

    if (stateRef.current.editing) {
      if (key.return) {
        patchState((next) => {
          next.editing = false;
        });
        return;
      }

      if (key.escape) {
        patchState((next) => {
          next.editing = false;
        });
        return;
      }

      return;
    }

    if (key.upArrow) {
      patchState((next) => {
        moveActiveField(next, config, -1);
      });
      return;
    }

    if (key.downArrow || key.tab) {
      patchState((next) => {
        moveActiveField(next, config, 1);
      });
      return;
    }

    if (key.leftArrow) {
      patchState((next) => {
        cycleActiveFieldOption(next, config, -1);
      });
      return;
    }

    if (key.rightArrow) {
      patchState((next) => {
        cycleActiveFieldOption(next, config, 1);
      });
      return;
    }

    if (key.return) {
      const current = stateRef.current;

      if (current.activeFieldId === "submit") {
        onSubmit({
          ...initial,
          ...buildCliArgsFromForm(current),
        });
        return;
      }

      if (current.activeFieldId === "expiryMode" || current.activeFieldId === "duration") {
        patchState((next) => {
          cycleActiveFieldOption(next, config, 1);
        });
        return;
      }

      if (isTextField(current.activeFieldId)) {
        patchState((next) => {
          next.editing = true;
        });
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{config.ui.title}</Text>
      {config.ui.note ? <Text dimColor>{config.ui.note}</Text> : null}
      <Text />
      {visibleFieldIds.map((fieldId) => {
        const active = state.activeFieldId === fieldId;
        const editing = active && state.editing ? " [editing]" : "";
        const showInput = editing && isTextField(fieldId);

        return (
          <Box key={fieldId}>
            <Text color={active ? "green" : undefined}>
              {active ? ">" : " "} {getFieldLabel(fieldId, config)}:{" "}
            </Text>
            {showInput ? (
              <>
                <TextInput
                  value={getRawFieldValue(fieldId, state)}
                  focus
                  mask={fieldId === "password" ? "•" : undefined}
                  onChange={(value) => {
                    patchState((next) => {
                      setFieldValue(fieldId, next, value);
                    });
                  }}
                  onSubmit={() => {
                    patchState((next) => {
                      next.editing = false;
                    });
                  }}
                />
                <Text color={active ? "green" : undefined}>{editing}</Text>
              </>
            ) : (
              <Text color={active ? "green" : undefined}>
                {getFieldValue(fieldId, state, config)}
                {editing}
              </Text>
            )}
          </Box>
        );
      })}
      <Text />
      <Text dimColor>Use Up/Down to move, Left/Right to change options, Enter to edit or submit.</Text>
    </Box>
  );
}
