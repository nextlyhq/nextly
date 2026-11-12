/**
 * The plain-text report System health's "Copy diagnostics" copies: the facts
 * the card and its Details show, plus how much content the site holds and how
 * many server errors it answered in the last 24 hours, ready to paste into an
 * issue or a chat.
 *
 * ## Built from an allow-list
 *
 * Each line is one named fact in a fixed format, written here by hand. Nothing
 * iterates the facts, the configuration, the environment or an error, so a
 * field added to any of them later cannot reach the report by accident.
 *
 * Each value is checked against the shape its fact has before it is written: a
 * version must read as a version, a storage type as a short word, a locale as
 * a language code. A value of any other shape is written as "unknown" (or
 * left out of a list), never copied. So free text the facts carry for the card
 * (the environment's own label, why a storage write failed, a failed
 * collection's name) is never in the report, and a database address, a key or
 * a person's name placed where a fact was expected is not either.
 *
 * Encryption is "yes", "no" or "unknown", and a database with nothing to
 * encrypt (SQLite, a file) has no encryption line, as the card has none.
 *
 * @module domains/health/diagnostics-report
 */

import type { SystemHealthData } from "../widgets/core-widgets/system-health";

import type { ServerErrorCount } from "./server-errors";

/** How much content the site holds; a count that could not be read is `null`. */
export interface ContentCounts {
  collections: number | null;
  singles: number | null;
  users: number | null;
  /**
   * The site's language codes; `[]` with localization off, `null` when they
   * could not be read.
   */
  locales: readonly string[] | null;
}

/** Everything the report is written from. */
export interface DiagnosticsFacts {
  /** When the report was built. */
  at: Date;
  health: SystemHealthData;
  content: ContentCounts;
  errors: ServerErrorCount;
}

const UNKNOWN = "unknown";

/** A release version: `1.2.3`, with an optional prerelease and build. */
const VERSION =
  /^v?\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/;

/** The leading number of a database server's version: `17.2`, `8.0.36`. */
const SERVER_VERSION = /^\d{1,4}(?:\.\d{1,6}){0,3}/;

/** A package name as npm allows it, scoped or not. */
const PACKAGE_NAME =
  /^(?:@[a-z0-9-~][a-z0-9-._~]{0,100}\/)?[a-z0-9-~][a-z0-9-._~]{0,100}$/;

/** A language code: `en`, `pt-BR`, `zh-Hant-TW`. */
const LOCALE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** A short word naming a kind of thing: a storage type such as `vercel-blob`. */
const TYPE_WORD = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A provider's label as a registry names it: `Resend`, `SMTP`, `Amazon SES`. */
const PROVIDER_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,39}$/;

/** How many language codes the content line names before it stops. */
const LOCALES_NAMED = 20;

/** `value` when it is text of `shape`, else "unknown". */
function shaped(value: unknown, shape: RegExp): string {
  return typeof value === "string" && shape.test(value) ? value : UNKNOWN;
}

/** A whole number at least zero, else undefined. */
function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** `count` with its noun, singular for one: "1 user", "3 users". */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** An instant as `2026-11-10 17:20 UTC`. */
function utcMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The Nextly line: the running version, and the newest in its channel. */
function versionLine(health: SystemHealthData): string {
  const version = shaped(health.version, VERSION);
  const { latest } = health;
  const newest =
    latest.status === "unknown" ? UNKNOWN : shaped(latest.version, VERSION);
  return `Nextly: ${version} (latest: ${newest})`;
}

/** Production or development, from the server's own mode, never a label. */
function environmentLine(health: SystemHealthData): string {
  const { production } = health.environment;
  let mode = UNKNOWN;
  if (production === true) mode = "production";
  else if (production === false) mode = "development";
  return `Environment: ${mode}`;
}

function runtimeLine(health: SystemHealthData): string {
  const { runtime } = health;
  return [
    `Runtime: Node ${shaped(runtime.node, VERSION)}`,
    `Next.js ${shaped(runtime.next, VERSION)}`,
    `React ${shaped(runtime.react, VERSION)}`,
  ].join(" · ");
}

const DIALECT_NAME: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

/** The database's kind and version, and how long one query took. */
function databaseLine(database: SystemHealthData["database"]): string {
  const kind = Object.hasOwn(DIALECT_NAME, database.dialect)
    ? DIALECT_NAME[database.dialect]
    : UNKNOWN;
  const version =
    typeof database.serverVersion === "string"
      ? SERVER_VERSION.exec(database.serverVersion)?.[0]
      : undefined;
  const ms = whole(database.roundTripMs);
  return [
    version === undefined ? kind : `${kind} ${version}`,
    ms === undefined ? "round trip unknown" : `${ms} ms round trip`,
  ].join(" · ");
}

const ENCRYPTED: Readonly<Record<string, string>> = {
  encrypted: "yes",
  unencrypted: "no",
};

/**
 * Whether the connection is encrypted: yes, no or unknown; no line at all for
 * a database with nothing to encrypt.
 */
function encryptionLines(database: SystemHealthData["database"]): string[] {
  if (database.encryption === "not-applicable") return [];
  const answer = Object.hasOwn(ENCRYPTED, database.encryption)
    ? ENCRYPTED[database.encryption]
    : UNKNOWN;
  return [`Database connection encrypted: ${answer}`];
}

const MIGRATION_STATE: Readonly<Record<string, string>> = {
  ok: "up to date",
  pending: "pending",
  failed: "failed",
};

/** How many collections' last schema change failed, listed or not. */
function failedSchemaChanges(
  schemaChanges: SystemHealthData["schemaChanges"]
): number | undefined {
  const more = whole(schemaChanges.more);
  return Array.isArray(schemaChanges.failed) && more !== undefined
    ? schemaChanges.failed.length + more
    : undefined;
}

/** Migrations by state and count, and schema changes by count alone. */
function migrationLines(health: SystemHealthData): string[] {
  const { migrations } = health;
  const state = Object.hasOwn(MIGRATION_STATE, migrations.status)
    ? MIGRATION_STATE[migrations.status]
    : UNKNOWN;
  const pending = whole(migrations.pending) ?? UNKNOWN;
  const failed = whole(migrations.failed) ?? UNKNOWN;
  const changes = failedSchemaChanges(health.schemaChanges) ?? UNKNOWN;
  return [
    `Migrations: ${state} · ${pending} pending · ${failed} failed`,
    `Failed schema changes: ${changes}`,
  ];
}

const STORAGE_NAME: Readonly<Record<string, string>> = {
  local: "Local disk",
  s3: "S3",
  "vercel-blob": "Vercel Blob",
  uploadthing: "UploadThing",
};

/** A storage adapter's type as people name it, or the type word itself. */
function storageName(type: unknown): string {
  if (typeof type === "string" && Object.hasOwn(STORAGE_NAME, type)) {
    return STORAGE_NAME[type];
  }
  return shaped(type, TYPE_WORD);
}

/** The storage adapter, and whether its last write worked: never why it failed. */
function storageLine(storage: SystemHealthData["storage"]): string {
  const name = storageName(storage.type);
  if (storage.status === "ok") return `Storage: ${name} · last write OK`;
  if (storage.status !== "failed") return `Storage: ${name} · ${UNKNOWN}`;
  const at =
    typeof storage.failedAt === "string" &&
    !Number.isNaN(Date.parse(storage.failedAt))
      ? ` ${utcMinute(new Date(storage.failedAt))}`
      : "";
  return `Storage: ${name} · last write failed${at}`;
}

/** The email provider by its label, or none set up. */
function emailLine(email: SystemHealthData["email"]): string {
  if (email === null) return `Email: ${UNKNOWN}`;
  if (email.provider === null) return "Email: not set up";
  return `Email: ${shaped(email.provider, PROVIDER_LABEL)}`;
}

function jobsLine(jobs: SystemHealthData["jobs"]): string {
  if (jobs === null) return `Background jobs: ${UNKNOWN}`;
  const of = (n: unknown) => whole(n) ?? UNKNOWN;
  return `Background jobs: ${of(jobs.queued)} queued · ${of(jobs.running)} running · ${of(jobs.failed)} failed in 24 h`;
}

/** Each plugin by its package name and version, indented under a count. */
function pluginLines(plugins: SystemHealthData["plugins"]): string[] {
  const listed = Array.isArray(plugins) ? plugins : [];
  return [
    `Plugins (${listed.length}):`,
    ...listed.map(
      plugin =>
        `  ${shaped(plugin.name, PACKAGE_NAME)} ${shaped(plugin.version, VERSION)}`
    ),
  ];
}

/** The languages: how many, and their codes; localization off when none. */
function localesPart(locales: readonly string[] | null): string {
  if (!Array.isArray(locales)) return `${UNKNOWN} locales`;
  if (locales.length === 0) return "localization off";
  const codes = locales
    .filter(code => typeof code === "string" && LOCALE_CODE.test(code))
    .slice(0, LOCALES_NAMED);
  const more = locales.length > LOCALES_NAMED ? ", …" : "";
  const named = codes.length > 0 ? ` (${codes.join(", ")}${more})` : "";
  return `${counted(locales.length, "locale", "locales")}${named}`;
}

/** How much content: collections, Singles, users and languages. */
function contentLine(content: ContentCounts): string {
  const of = (n: number | null, one: string, many: string) => {
    const count = whole(n);
    return count === undefined
      ? `${UNKNOWN} ${many}`
      : counted(count, one, many);
  };
  const parts = [
    of(content.collections, "collection", "collections"),
    of(content.singles, "Single", "Singles"),
    of(content.users, "user", "users"),
    localesPart(content.locales),
  ];
  return `Content: ${parts.join(" · ")}`;
}

function errorsLine(errors: ServerErrorCount): string {
  const count = whole(errors.count);
  if (count === undefined) return `Errors in the last 24 h: ${UNKNOWN}`;
  const floor = errors.capped ? " or more" : "";
  return `Errors in the last 24 h: ${count}${floor} (server errors, this server process)`;
}

/** The report, one fact per line, as "Copy diagnostics" copies it. */
export function buildDiagnosticsReport(facts: DiagnosticsFacts): string {
  const { health } = facts;
  return [
    `Nextly diagnostics, ${utcMinute(facts.at)}`,
    versionLine(health),
    environmentLine(health),
    runtimeLine(health),
    `Database: ${databaseLine(health.database)}`,
    ...encryptionLines(health.database),
    ...migrationLines(health),
    storageLine(health.storage),
    emailLine(health.email),
    jobsLine(health.jobs),
    ...pluginLines(health.plugins),
    contentLine(facts.content),
    errorsLine(facts.errors),
  ].join("\n");
}
