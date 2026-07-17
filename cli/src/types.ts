export type Duration = string;

export interface CliConfig {
  ui: {
    title: string;
    submitLabel: string;
    note?: string;
  };
  fields: {
    filePath: CliFieldConfig;
    recipients: CliFieldConfig;
    duration: CliFieldConfig;
    expiresAt: CliFieldConfig;
    password: CliFieldConfig;
    maxDownloads: CliFieldConfig;
  };
  expiry: {
    allowDuration: boolean;
    allowFixedDate: boolean;
    modeDefault: "duration" | "fixedDate";
    defaultDuration?: string;
    durationOptions: Array<{
      value: string;
      label: string;
      enabled: boolean;
    }>;
    fixedDateMinOffsetMs: number;
    fixedDateMaxOffsetMs: number;
  };
  limits: {
    maxUploadBytes: number;
    maxDownloadsMax: number;
    maxNotifyRecipients: number;
  };
  account?: {
    plan: "pro" | "team";
    planName: string;
  };
  workspace?: {
    id: string;
    name?: string;
    role?: "owner" | "admin" | "member" | null;
  } | null;
  activeDelivery?: {
    includedBytes: number;
    baseIncludedBytes: number;
    additionalSeatBytes: number;
    seatQuantity: number;
    billingModel: "billing_period_peak";
    overageCentsPer100GB: number;
    effectiveUploadCeilingBytes: number;
    spendCapCents: number | null;
    billingEnabled: boolean;
  };
}

export interface CliFieldConfig {
  enabled: boolean;
  required: boolean;
  multiple?: boolean;
  label?: string;
  description?: string;
}

export interface CliArgs {
  command?: "upload" | "login" | "logout" | "whoami" | "mcp";
  filePaths: string[];
  emails: string[];
  duration?: string;
  expiresAt?: string;
  password?: string;
  maxDownloads?: string;
  baseUrl?: string;
  /** Internal resolved credential; command-line parsing never populates this field. */
  apiKey?: string;
  json: boolean;
  quiet: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
}

export interface NormalizedUploadOptions {
  files: NormalizedUploadFile[];
  emails: string[];
  password?: string;
  maxDownloads?: number;
  baseUrl: string;
  apiKey?: string;
  json: boolean;
  quiet: boolean;
  expiry: UploadExpirySelection;
}

export interface NormalizedUploadFile {
  filePath: string;
  filename: string;
  fileSize: number;
  mtimeMs: number;
}

export interface UploadResult {
  id: string;
  url: string;
  expires: string;
  filename: string;
  size: number;
  downloads: number;
  maxDownloads: number | null;
  passwordRequired: boolean;
  files?: Array<{ id?: string; filename: string; size: number; contentType?: string }>;
  workspace?: { id: string; name?: string } | null;
}

export interface CliErrorShape {
  message: string;
  error: string;
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
}

export type UploadExpirySelection =
  | { kind: "duration"; duration: string }
  | { kind: "fixedDate"; expiresAt: string };
