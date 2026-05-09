import type { ErrorCode } from "./events.js";

export type ClassifyScope =
  | "install"
  | "template-download"
  | "template-parse"
  | "config"
  | "db"
  | "migration"
  | "other";

interface ErrorLike {
  code?: string;
  message?: string;
}

function isErrorLike(v: unknown): v is ErrorLike {
  return typeof v === "object" && v !== null;
}

// Map Node fs/net error codes to telemetry error_code enum values. Never
// reads the error message except to look for a tiny set of known stable
// signals (we currently use none). Raw messages never leave this function.
export function classifyError(err: unknown, scope: ClassifyScope): ErrorCode {
  const e = isErrorLike(err) ? err : {};
  const code = typeof e.code === "string" ? e.code : "";

  if (scope === "install") {
    if (code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNRESET")
      return "install_network";
    if (code === "EACCES" || code === "EPERM") return "install_permission";
    if (code === "ENOSPC") return "install_disk_full";
    return "install_failed";
  }
  if (scope === "template-download") return "template_download_failed";
  if (scope === "template-parse") return "template_parse_failed";
  if (scope === "config") return "config_generation_failed";
  if (scope === "db") return "db_connection_failed";
  if (scope === "migration") return "migration_conflict";

  return "unknown";
}
