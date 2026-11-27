/**
 * Whether a server's version is one Nextly runs on. The same rules the
 * adapters apply when they connect (`@nextlyhq/adapter-drizzle/version-check`):
 * PostgreSQL 15.0 or later, MySQL 8.0 or later, and a MySQL-compatible server
 * (MariaDB, TiDB, Aurora, PlanetScale, Vitess) accepted with a warning. Kept
 * here rather than imported so the installer does not download an adapter to
 * ask; a test holds the two to the same numbers.
 */
import type { ServerDialect } from "./types";

export const MIN_VERSIONS: Record<
  ServerDialect,
  { major: number; minor: number }
> = {
  postgresql: { major: 15, minor: 0 },
  mysql: { major: 8, minor: 0 },
};

export const MYSQL_VARIANTS = [
  "mariadb",
  "tidb",
  "aurora",
  "planetscale",
  "vitess",
] as const;

const LABELS: Record<ServerDialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
};

const VARIANT_LABELS: Record<(typeof MYSQL_VARIANTS)[number], string> = {
  mariadb: "MariaDB",
  tidb: "TiDB",
  aurora: "Aurora MySQL",
  planetscale: "PlanetScale",
  vitess: "Vitess",
};

export type VersionVerdict =
  | { supported: true; server: string; variantWarning?: string }
  | { supported: false; server: string; required: string };

/**
 * Reads `raw`, what `SELECT version()` (PostgreSQL) or `SELECT VERSION()`
 * (MySQL) answered, and says whether Nextly runs on it.
 */
export function judgeVersion(
  dialect: ServerDialect,
  raw: string
): VersionVerdict {
  const label = LABELS[dialect];
  const min = MIN_VERSIONS[dialect];
  const required = `${label} ${min.major}.${min.minor} or later`;

  if (dialect === "mysql") {
    const lower = raw.toLowerCase();
    const variant = MYSQL_VARIANTS.find(token => lower.includes(token));
    if (variant) {
      const name = VARIANT_LABELS[variant];
      return {
        supported: true,
        server: `${name} ${raw.split("-")[0]}`,
        variantWarning: `${name} speaks MySQL's protocol, but Nextly is tested on MySQL 8.0 and later only. Most things work; some may not.`,
      };
    }
  }

  const match =
    dialect === "postgresql"
      ? /^PostgreSQL (\d+)\.(\d+)/.exec(raw)
      : /^(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!match) return { supported: false, server: label, required };

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const shown =
    dialect === "postgresql"
      ? `${label} ${major}.${minor}`
      : `${label} ${match[1]}.${match[2]}.${match[3]}`;
  const meets =
    major > min.major || (major === min.major && minor >= min.minor);
  return meets
    ? { supported: true, server: shown }
    : { supported: false, server: shown, required };
}
