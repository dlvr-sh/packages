import type { Duration } from "./types";

export const DEFAULT_BASE_URL = "https://dlvr.sh";
export const DURATIONS: readonly Duration[] = ["1h", "24h", "3d", "7d"];
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isDuration(value: string): value is Duration {
  return DURATIONS.includes(value as Duration);
}
