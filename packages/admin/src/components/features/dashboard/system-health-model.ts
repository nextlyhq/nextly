/**
 * What the System health card draws, read from its `load` answer: one status
 * line, then eight facts (Nextly, Environment, Database, Connection,
 * Migrations, Storage, Email, Background jobs), each with its value, a status
 * chip where it has one, and what to do about a problem; and, for Details, the
 * runtime and the plugins.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * what each fact says in each state, and the rule the status line counts by.
 *
 * ## The counting rule
 *
 * **Problems:** a pending or failed migration, a failed schema change, a
 * failed storage write, and an unencrypted connection to a database on
 * another machine in production. **Warnings:** a connection whose encryption
 * could not be read, background jobs that failed in the last 24 hours, and no
 * email provider in production, where the site sends its password resets and
 * invitations. An available update, a slow database, queued jobs and a fact
 * that could not be read are shown and never counted.
 *
 * Every fact is read from the answer defensively: the answer reaches the
 * browser as plain JSON, and a fact this admin cannot read says "Couldn't
 * check", never that all is well.
 */

import { adminHref } from "@admin/constants/routes";
import { formatRelativeTime } from "@admin/lib/dashboard";

import { isRecord, isText } from "./answer-guards";

/** A status chip's tone: the status token its dot is drawn in. */
export type HealthTone = "success" | "warning" | "destructive" | "info";

/** Where a fact's action leads: inside the admin, or the documentation. */
export interface HealthAction {
  label: string;
  href: string;
  /** Opens outside the admin, in a new tab: the documentation. */
  external?: true;
}

/** Which fact a row is. */
export type HealthFactId =
  | "version"
  | "environment"
  | "database"
  | "connection"
  | "migrations"
  | "storage"
  | "email"
  | "jobs";

/** One fact of the card. */
export interface HealthFact {
  id: HealthFactId;
  label: string;
  value: string;
  /** The value could not be read: drawn quietly, and never counted. */
  unread?: true;
  /** A status chip after the value: a word with a dot in its status's colour. */
  chip?: { label: string; tone: HealthTone };
  /** A quiet note after the value, such as "Couldn't check for updates". */
  note?: string;
  /** A second line: why a write failed, and through which adapter. */
  detail?: string;
  actions: HealthAction[];
  /** How many problems and warnings the fact counts toward the status line. */
  problems: number;
  warnings: number;
}

/** The status line: what it says, and its dot's tone. */
export interface HealthSummary {
  problems: number;
  warnings: number;
  text: string;
  tone: "success" | "warning" | "destructive";
}

/** Where a failed or pending migration is explained. */
export const MIGRATIONS_DOCS =
  "https://nextlyhq.com/docs/guides/production-migrations";

/** Where encrypting the database connection is explained. */
export const ENCRYPTION_DOCS =
  "https://nextlyhq.com/docs/database/encrypted-connections";

/** What a fact says when its answer could not be read. */
export const COULD_NOT_CHECK = "Couldn't check";

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;

/** A fact with nothing to count and no action, the shape most lines take. */
function fact(
  id: HealthFactId,
  label: string,
  value: string,
  rest: Partial<Omit<HealthFact, "id" | "label" | "value">> = {}
): HealthFact {
  return { id, label, value, actions: [], problems: 0, warnings: 0, ...rest };
}

/** A fact whose answer could not be read: quiet, and never counted. */
const unread = (id: HealthFactId, label: string): HealthFact =>
  fact(id, label, COULD_NOT_CHECK, { unread: true });

/** An admin link, when the path is one the admin draws. */
function adminAction(label: string, path: string): HealthAction[] {
  const href = adminHref(path);
  return href === undefined ? [] : [{ label, href }];
}

const OK_CHIP = { label: "OK", tone: "success" } as const;

/**
 * The Nextly line: the running version, and whether it is the newest in its
 * channel. Never "Latest" without a check that succeeded.
 */
function versionFact(data: Record<string, unknown>): HealthFact {
  if (!isText(data.version)) return unread("version", "Nextly");
  const latest = isRecord(data.latest) ? data.latest : {};
  if (latest.status === "latest") {
    return fact("version", "Nextly", data.version, {
      chip: { label: "Latest", tone: "success" },
    });
  }
  if (latest.status === "update" && isText(latest.version)) {
    return fact("version", "Nextly", data.version, {
      chip: { label: `${latest.version} available`, tone: "info" },
    });
  }
  return fact("version", "Nextly", data.version, {
    note: "Couldn't check for updates",
  });
}

/** Whether the server runs in production, when the answer says. */
function production(data: Record<string, unknown>): boolean {
  return isRecord(data.environment) && data.environment.production === true;
}

/** The environment: the site's own name for it, else production or development. */
function environmentFact(data: Record<string, unknown>): HealthFact {
  const environment = data.environment;
  if (!isRecord(environment) || typeof environment.production !== "boolean") {
    return unread("environment", "Environment");
  }
  const named = isText(environment.label)
    ? environment.label
    : environment.production
      ? "Production"
      : "Development";
  return fact("environment", "Environment", named);
}

const DIALECT_NAME: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};

/** The database: its kind and version, and how long one query took. */
function databaseFact(database: Record<string, unknown>): HealthFact {
  const kind =
    typeof database.dialect === "string" &&
    Object.hasOwn(DIALECT_NAME, database.dialect)
      ? DIALECT_NAME[database.dialect]
      : undefined;
  if (kind === undefined) return unread("database", "Database");
  const named = isText(database.serverVersion)
    ? `${kind} ${database.serverVersion}`
    : kind;
  const time =
    typeof database.roundTripMs === "number" &&
    Number.isFinite(database.roundTripMs)
      ? ` · ${Math.max(0, Math.round(database.roundTripMs))} ms`
      : "";
  return fact("database", "Database", `${named}${time}`);
}

/**
 * The connection: encrypted, not encrypted, or not checked. Not drawn at all
 * for a connection with nothing to encrypt (SQLite, a file). Not encrypted is
 * a problem only where it is exposed (production, another machine); not
 * checked is always a warning, and is never read as encrypted.
 */
function connectionFact(
  database: Record<string, unknown>
): HealthFact | undefined {
  const exposed = database.exposed === true;
  const howToFix: HealthAction[] = exposed
    ? [{ label: "How to fix", href: ENCRYPTION_DOCS, external: true }]
    : [];
  switch (database.encryption) {
    case "not-applicable":
      return undefined;
    case "encrypted":
      return fact("connection", "Connection", "Encrypted", { chip: OK_CHIP });
    case "unencrypted":
      return exposed
        ? fact("connection", "Connection", "Not encrypted", {
            chip: { label: "Risk", tone: "destructive" },
            actions: howToFix,
            problems: 1,
          })
        : fact("connection", "Connection", "Not encrypted");
    default:
      return fact("connection", "Connection", COULD_NOT_CHECK, {
        chip: { label: "Warning", tone: "warning" },
        actions: howToFix,
        warnings: 1,
      });
  }
}

/** The schema-change result, as the answer gave it. */
interface SchemaChanges {
  /** How many collections' last schema change failed, listed or not. */
  failed: number;
  /** One link per listed collection, then one for the rest. */
  links: HealthAction[];
}

/**
 * The schema-change result, when the answer holds one: its failed list and
 * how many more. Absent or malformed, it is undefined: no result was read,
 * which is not zero failures.
 */
function schemaChanges(schema: unknown): SchemaChanges | undefined {
  if (!isRecord(schema) || !Array.isArray(schema.failed)) return undefined;
  const { more } = schema;
  if (typeof more !== "number" || !Number.isInteger(more) || more < 0) {
    return undefined;
  }
  const links = schema.failed.flatMap((entry: unknown) =>
    isRecord(entry) && isText(entry.slug)
      ? adminAction(
          `Fix ${isText(entry.label) ? entry.label : entry.slug}`,
          `builder/collections/${encodeURIComponent(entry.slug)}`
        )
      : []
  );
  return {
    failed: schema.failed.length + more,
    links:
      more > 0
        ? [...links, ...adminAction(`${more} more`, "builder/collections")]
        : links,
  };
}

/** What a pending migrations line says: how many, when the answer counted them. */
function pendingValue(pending: unknown): string {
  const count = whole(pending);
  return count > 0 ? `${count} pending` : "Pending";
}

const RESOLVE: HealthAction = {
  label: "How to resolve",
  href: MIGRATIONS_DOCS,
  external: true,
};

/**
 * The migrations line: failed when a migration file did not apply, or a
 * collection's schema change did not (each a problem of its own); pending
 * while migrations are still applying (a problem); up to date only when the
 * answer says "ok" AND holds a schema-change result; and not checked
 * otherwise.
 */
function migrationsFact(data: Record<string, unknown>): HealthFact {
  const migrations = isRecord(data.migrations) ? data.migrations : {};
  const schema = schemaChanges(data.schemaChanges);
  const failedFiles = migrations.status === "failed";
  const failedSchema = (schema?.failed ?? 0) > 0;
  if (failedFiles || failedSchema) {
    return fact("migrations", "Migrations", "Failed", {
      chip: { label: "Failed", tone: "destructive" },
      actions: [...(failedFiles ? [RESOLVE] : []), ...(schema?.links ?? [])],
      problems: Number(failedFiles) + Number(failedSchema),
    });
  }
  if (migrations.status === "pending") {
    return fact("migrations", "Migrations", pendingValue(migrations.pending), {
      chip: { label: "Pending", tone: "destructive" },
      actions: [RESOLVE],
      problems: 1,
    });
  }
  if (migrations.status !== "ok" || schema === undefined) {
    return unread("migrations", "Migrations");
  }
  return fact("migrations", "Migrations", "Up to date");
}

const STORAGE_NAME: Readonly<Record<string, string>> = {
  local: "Local disk",
  s3: "S3",
  "vercel-blob": "Vercel Blob",
  uploadthing: "UploadThing",
};

/** A storage adapter's type as people name it, or the type itself. */
function storageName(type: unknown): string | undefined {
  if (!isText(type)) return undefined;
  return Object.hasOwn(STORAGE_NAME, type) ? STORAGE_NAME[type] : type;
}

/**
 * The storage line: its adapter and working, or when, where and why its last
 * write failed (a problem); not checked for anything else.
 */
function storageFact(data: Record<string, unknown>, now: number): HealthFact {
  const storage = isRecord(data.storage) ? data.storage : {};
  if (storage.status === "ok") {
    return fact("storage", "Storage", storageName(storage.type) ?? "Working", {
      chip: OK_CHIP,
    });
  }
  if (storage.status !== "failed") return unread("storage", "Storage");
  const when = isText(storage.failedAt)
    ? ` ${formatRelativeTime(storage.failedAt, now)}`
    : "";
  const detail = [storage.reason, storage.adapter].filter(isText).join(" · ");
  return fact("storage", "Storage", `Last write failed${when}`, {
    chip: { label: "Failed", tone: "destructive" },
    ...(detail === "" ? {} : { detail }),
    actions: adminAction("Open media", "media"),
    problems: 1,
  });
}

/**
 * The email line: the provider by its label, or none set up, which is a
 * warning in production; in development, where mail is written to the
 * server's log, it is only said.
 */
function emailFact(data: Record<string, unknown>): HealthFact {
  const email = data.email;
  if (!isRecord(email) || !("provider" in email))
    return unread("email", "Email");
  if (isText(email.provider)) {
    return fact("email", "Email", email.provider, { chip: OK_CHIP });
  }
  if (email.provider !== null) return unread("email", "Email");
  return production(data)
    ? fact("email", "Email", "Not set up", {
        chip: { label: "Warning", tone: "warning" },
        actions: adminAction("Set up", "email/sending"),
        warnings: 1,
      })
    : fact("email", "Email", "Not set up", {
        note: "Written to the server log",
      });
}

/**
 * The background jobs line: how many wait, and how many failed in the last
 * 24 hours, which is a warning. Queued jobs are only said.
 */
function jobsFact(data: Record<string, unknown>): HealthFact {
  const jobs = data.jobs;
  if (
    !isRecord(jobs) ||
    typeof jobs.queued !== "number" ||
    typeof jobs.failed !== "number"
  ) {
    return unread("jobs", "Background jobs");
  }
  const failed = whole(jobs.failed);
  const value = `${whole(jobs.queued)} queued · ${failed} failed (24 h)`;
  return failed > 0
    ? fact("jobs", "Background jobs", value, {
        chip: { label: "Failed", tone: "warning" },
        warnings: 1,
      })
    : fact("jobs", "Background jobs", value);
}

/** The card's facts, in their order, from whatever the answer holds. */
export function systemHealthFacts(
  data: unknown,
  now: number = Date.now()
): HealthFact[] {
  const answer = isRecord(data) ? data : {};
  const database = isRecord(answer.database) ? answer.database : {};
  const connection = connectionFact(database);
  return [
    versionFact(answer),
    environmentFact(answer),
    databaseFact(database),
    ...(connection === undefined ? [] : [connection]),
    migrationsFact(answer),
    storageFact(answer, now),
    emailFact(answer),
    jobsFact(answer),
  ];
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The status line, counted from the facts: "Everything is working" with
 * neither problems nor warnings, else how many problems need attention, how
 * many things to check, or both.
 */
export function healthSummary(facts: readonly HealthFact[]): HealthSummary {
  const problems = facts.reduce((sum, item) => sum + item.problems, 0);
  const warnings = facts.reduce((sum, item) => sum + item.warnings, 0);
  const parts = [
    ...(problems > 0
      ? [plural(problems, "problem needs", "problems need") + " attention"]
      : []),
    ...(warnings > 0
      ? [plural(warnings, "thing", "things") + " to check"]
      : []),
  ];
  if (parts.length === 0) {
    return {
      problems,
      warnings,
      text: "Everything is working",
      tone: "success",
    };
  }
  return {
    problems,
    warnings,
    text: parts.join(" · "),
    tone: problems > 0 ? "destructive" : "warning",
  };
}

/** One name and value of Details' runtime or plugins. */
export interface HealthDetail {
  name: string;
  value: string;
}

/** Details' runtime: Node, Next.js and React, each as the answer gave it. */
export function runtimeDetails(data: unknown): HealthDetail[] {
  const runtime = isRecord(data) && isRecord(data.runtime) ? data.runtime : {};
  const named: [string, unknown][] = [
    ["Node", runtime.node],
    ["Next.js", runtime.next],
    ["React", runtime.react],
  ];
  return named.map(([name, value]) => ({
    name,
    value: isText(value) ? value : COULD_NOT_CHECK,
  }));
}

/** Details' plugins, by name (without the `@nextlyhq/` scope) and version. */
export function pluginDetails(data: unknown): HealthDetail[] {
  const plugins =
    isRecord(data) && Array.isArray(data.plugins) ? data.plugins : [];
  return plugins.flatMap((plugin: unknown) =>
    isRecord(plugin) && isText(plugin.name) && isText(plugin.version)
      ? [
          {
            name: plugin.name.replace(/^@nextlyhq\//, ""),
            value: plugin.version,
          },
        ]
      : []
  );
}
