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

/**
 * Why `url` cannot be `database`'s connection string, or undefined when it
 * can. A connection string is for one database, and the scaffold writes the
 * dialect beside it, so the two must agree; the database is asked for rather
 * than inferred, so a URL never silently picks it. One check for the command
 * line and a direct `createNextly` call alike.
 */
export function connectionMismatch(
  database: DatabaseType | undefined,
  url: string
): string | undefined {
  const urlDatabase = databaseOfUrl(url);
  if (!urlDatabase) {
    return (
      `--database-url is not a connection string for ${DATABASES.join(", ")}: ` +
      "it should start with postgresql://, mysql:// or file:."
    );
  }
  if (!database) {
    return `--database-url needs --database too. Pass -d ${urlDatabase}.`;
  }
  if (urlDatabase !== database) {
    return (
      `--database-url is a ${urlDatabase} connection string, but --database is ${database}. ` +
      `Pass -d ${urlDatabase}, or a ${database} URL.`
    );
  }
  return undefined;
}
