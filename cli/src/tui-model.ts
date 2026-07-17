import type { CliArgs, CliConfig, Duration } from "./types";

export type FormFieldId =
  | "filePath"
  | "recipients"
  | "expiryMode"
  | "duration"
  | "expiresAt"
  | "password"
  | "maxDownloads"
  | "submit";

export interface TuiFormState {
  filePath: string;
  recipientsInput: string;
  expiryMode: "duration" | "fixedDate";
  duration: Duration;
  expiresAt: string;
  password: string;
  maxDownloads: string;
  activeFieldId: FormFieldId;
  editing: boolean;
}

export function getVisibleFieldIds(state: TuiFormState, config: CliConfig): FormFieldId[] {
  const fields: FormFieldId[] = ["filePath"];

  if (config.fields.recipients.enabled) {
    fields.push("recipients");
  }

  if (config.expiry.allowDuration || config.expiry.allowFixedDate) {
    fields.push("expiryMode");
  }

  if (state.expiryMode === "duration" && config.fields.duration.enabled && config.expiry.allowDuration) {
    fields.push("duration");
  }

  if (state.expiryMode === "fixedDate" && config.fields.expiresAt.enabled && config.expiry.allowFixedDate) {
    fields.push("expiresAt");
  }

  if (config.fields.password.enabled) {
    fields.push("password");
  }

  if (config.fields.maxDownloads.enabled) {
    fields.push("maxDownloads");
  }

  fields.push("submit");
  return fields;
}

export function createFormState(initial: CliArgs, config: CliConfig): TuiFormState {
  const defaultDuration = config.expiry.defaultDuration ?? config.expiry.durationOptions[0]?.value ?? "24h";

  return {
    filePath: initial.filePaths?.[0] ?? "",
    recipientsInput: initial.emails.join(","),
    expiryMode: initial.expiresAt ? "fixedDate" : config.expiry.modeDefault,
    duration: (initial.duration as Duration | undefined) ?? defaultDuration,
    expiresAt: initial.expiresAt ?? "",
    password: initial.password ?? "",
    maxDownloads: initial.maxDownloads ?? "",
    activeFieldId: "filePath",
    editing: false,
  };
}

export function moveActiveField(state: TuiFormState, config: CliConfig, direction: 1 | -1) {
  const visible = getVisibleFieldIds(state, config);
  const currentIndex = visible.indexOf(state.activeFieldId);
  const nextIndex = (currentIndex + direction + visible.length) % visible.length;
  state.activeFieldId = visible[nextIndex] ?? state.activeFieldId;
}

export function cycleActiveFieldOption(state: TuiFormState, config: CliConfig, direction: 1 | -1) {
  if (state.activeFieldId === "expiryMode") {
    const modes: Array<"duration" | "fixedDate"> = [];
    if (config.expiry.allowDuration) {
      modes.push("duration");
    }
    if (config.expiry.allowFixedDate) {
      modes.push("fixedDate");
    }

    const currentIndex = modes.indexOf(state.expiryMode);
    const nextIndex = (currentIndex + direction + modes.length) % modes.length;
    state.expiryMode = modes[nextIndex] ?? state.expiryMode;

    const visible = getVisibleFieldIds(state, config);
    if (!visible.includes(state.activeFieldId)) {
      state.activeFieldId = visible[0] ?? "filePath";
    }
    return;
  }

  if (state.activeFieldId === "duration") {
    const options = config.expiry.durationOptions.filter((value) => value.enabled);
    const currentIndex = options.findIndex((value) => value.value === state.duration);
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    state.duration = (options[nextIndex]?.value ?? state.duration) as Duration;
  }
}

export function buildCliArgsFromForm(state: TuiFormState): CliArgs {
  return {
    filePaths: state.filePath ? [state.filePath] : [],
    emails: state.recipientsInput ? [state.recipientsInput] : [],
    duration: state.expiryMode === "duration" ? state.duration : undefined,
    expiresAt: state.expiryMode === "fixedDate" ? state.expiresAt || undefined : undefined,
    password: state.password || undefined,
    maxDownloads: state.maxDownloads || undefined,
    json: false,
    quiet: false,
    yes: false,
    help: false,
    version: false,
  };
}
