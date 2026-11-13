import type { DatabaseType, PackageManager, ProjectApproach } from "../types";

/**
 * The values each choice flag accepts, defined once: the flag checks, the
 * prompts and the missing-answers message all read them, so they cannot
 * name different sets.
 */
export const DATABASES: readonly DatabaseType[] = [
  "sqlite",
  "postgresql",
  "mysql",
];

/** The databases that run on a server, so need a connection string. */
export const SERVER_DATABASES: readonly DatabaseType[] = DATABASES.filter(
  database => database !== "sqlite"
);

export const APPROACHES: readonly ProjectApproach[] = ["code-first", "visual"];

export const PACKAGE_MANAGERS: readonly PackageManager[] = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
];

/**
 * The database a connection string is for, from its scheme, or undefined for
 * a scheme none of them uses.
 */
export function databaseOfUrl(url: string): DatabaseType | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === "postgres" || scheme === "postgresql") return "postgresql";
  if (scheme === "mysql") return "mysql";
  if (scheme === "file") return "sqlite";
  return undefined;
}
