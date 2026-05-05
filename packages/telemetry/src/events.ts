// Typed event catalog. Emitting a non-catalog event is a compile error.
// Anything not listed here is NOT sent. This file is the single source of
// truth for what data leaves the machine.

export type CliName = "create-nextly-app" | "nextly";
export type OsName = "darwin" | "linux" | "win32" | "freebsd" | "other";
export type ArchName = "arm64" | "x64" | "other";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type Template = "blank" | "blog";
export type Approach = "code-first" | "visual" | "both";
export type Database = "sqlite" | "postgresql" | "mysql";
export type Adapter = "sqlite" | "postgres" | "mysql";

export type ErrorCode =
  | "install_failed"
  | "install_network"
  | "install_permission"
  | "install_disk_full"
  | "template_download_failed"
  | "template_parse_failed"
  | "config_generation_failed"
  | "db_connection_failed"
  | "migration_conflict"
  | "unknown";

export type ScaffoldStage = "scaffold" | "detect" | "install" | "config";

// Base context attached to every event. Assembled once per CLI process.
export interface BaseContext {
  cli_name: CliName;
  cli_version: string;
  node_version: string;
  os: OsName;
  arch: ArchName;
  package_manager: PackageManager;
  is_ci: boolean;
  is_docker: boolean;
  schema_version: number;
}

// Event catalog: single union of every event name + its specific properties.
export type TelemetryEvent =
  | {
      event: "scaffold_started";
      properties: {
        flags: {
          yes: boolean;
          skipInstall: boolean;
          useYalc: boolean;
        };
      };
    }
  | {
      event: "template_selected";
      properties: { template: Template; approach: Approach | null };
    }
  | { event: "database_selected"; properties: { database: Database } }
  | { event: "install_started"; properties: Record<string, never> }
  | { event: "install_completed"; properties: { duration_ms: number } }
  | {
      event: "install_failed";
      properties: { duration_ms: number; error_code: ErrorCode };
    }
  | {
      event: "scaffold_completed";
      properties: {
        total_duration_ms: number;
        template: Template;
        database: Database;
        approach: Approach | null;
      };
    }
  | {
      event: "scaffold_failed";
      properties: {
        stage: ScaffoldStage;
        error_code: ErrorCode;
        duration_ms: number;
      };
    }
  | { event: "scaffold_cancelled"; properties: { stage: string } }
  | {
      event: "command_started";
      properties: { command: string; flags_count: number };
    }
  | {
      event: "command_completed";
      properties: { command: string; duration_ms: number };
    }
  | {
      event: "command_failed";
      properties: {
        command: string;
        duration_ms: number;
        error_code: ErrorCode;
      };
    }
  | { event: "migration_generated"; properties: { adapter: Adapter } }
  | {
      event: "migration_applied";
      properties: { adapter: Adapter; migrations_count: number };
    }
  | {
      event: "db_sync_applied";
      properties: { adapter: Adapter; changes_count: number };
    };

export type EventName = TelemetryEvent["event"];
export type EventProperties<E extends EventName> = Extract<
  TelemetryEvent,
  { event: E }
>["properties"];
