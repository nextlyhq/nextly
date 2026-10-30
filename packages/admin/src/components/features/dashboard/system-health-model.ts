/**
 * What the System health card draws, read from its `load` answer: three
 * lines, Version, Migrations and Storage, each with a severity and a link per
 * problem.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * which state each line is in, what it says, and where each problem leads.
 */

import { adminHref } from "@admin/constants/routes";
import { formatRelativeTime } from "@admin/lib/dashboard";

import { isRecord, isText } from "./answer-guards";

/**
 * How a line stands: all well, waiting, broken, or unknown, when the answer
 * did not say: a line absent, or a status this admin does not know.
 */
export type HealthSeverity = "ok" | "warning" | "critical" | "unknown";

/** One place a problem leads. */
export interface HealthLink {
  label: string;
  href: string;
  /** Opens outside the admin, in a new tab: the documentation. */
  external?: true;
}

/** One line of the card. */
export interface HealthLine {
  id: "version" | "migrations" | "storage";
  label: string;
  value: string;
  severity: HealthSeverity;
  /** A second line of detail: why a write failed, and through which adapter. */
  detail?: string;
  links: HealthLink[];
}

/** Where a failed migration is explained: how to find and resolve it. */
export const MIGRATIONS_DOCS =
  "https://nextlyhq.com/docs/guides/production-migrations";

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;

/** What a line says when its answer gave no status this admin knows. */
export const COULD_NOT_CHECK = "Couldn't check";

/** A line whose status is unknown: never read as healthy. */
function uncheckedLine(id: HealthLine["id"], label: string): HealthLine {
  return {
    id,
    label,
    value: COULD_NOT_CHECK,
    severity: "unknown",
    links: [],
  };
}

/** An admin link, when the path is one the admin draws. */
function adminLink(label: string, path: string): HealthLink[] {
  const href = adminHref(path);
  return href === undefined ? [] : [{ label, href }];
}

/**
 * The version line: the running Nextly, never a problem; unchecked when the
 * answer carried no version, since a version not read is not confirmed.
 */
function versionLine(data: Record<string, unknown>): HealthLine {
  if (!isText(data.version)) return uncheckedLine("version", "Version");
  return {
    id: "version",
    label: "Version",
    value: `Nextly ${data.version}`,
    severity: "ok",
    links: [],
  };
}

/** The schema-change result, as the answer gave it. */
interface SchemaChanges {
  /** How many collections' last schema change failed, listed or not. */
  failed: number;
  /** One link per listed collection, then one for the rest. */
  links: HealthLink[];
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
      ? adminLink(
          `Fix ${isText(entry.label) ? entry.label : entry.slug}`,
          `builder/collections/${encodeURIComponent(entry.slug)}`
        )
      : []
  );
  return {
    failed: schema.failed.length + more,
    links:
      more > 0
        ? [...links, ...adminLink(`${more} more`, "builder/collections")]
        : links,
  };
}

/** A migrations line in one state, with its links. */
function migrationsState(
  value: string,
  severity: HealthSeverity,
  links: HealthLink[] = []
): HealthLine {
  return { id: "migrations", label: "Migrations", value, severity, links };
}

/**
 * The links of a failed migrations line, when it failed: a migration file
 * did not apply (the guide on resolving it), or a collection's schema change
 * did not (each collection, then the rest). Undefined when nothing failed.
 */
function failureLinks(
  status: unknown,
  schema: SchemaChanges | undefined
): HealthLink[] | undefined {
  const failedFiles = status === "failed";
  const schemaLinks = schema?.links ?? [];
  if (!failedFiles && (schema?.failed ?? 0) === 0) return undefined;
  const docs: HealthLink[] = failedFiles
    ? [{ label: "How to resolve", href: MIGRATIONS_DOCS, external: true }]
    : [];
  return [...docs, ...schemaLinks];
}

/** What a pending migrations line says: how many, when the answer counted them. */
function pendingValue(pending: unknown): string {
  const count = whole(pending);
  return count > 0 ? `${count} pending` : "Pending";
}

/**
 * The migrations line: failed when a migration or a collection's schema
 * change did not apply, pending while migrations are still applying, up to
 * date only when the answer says "ok" AND holds a schema-change result, and
 * unchecked otherwise: a missing line, an unknown status or a schema-change
 * result not read is not a healthy one.
 */
function migrationsLine(data: Record<string, unknown>): HealthLine {
  const migrations = isRecord(data.migrations) ? data.migrations : {};
  const schema = schemaChanges(data.schemaChanges);
  const failure = failureLinks(migrations.status, schema);
  if (failure !== undefined) {
    return migrationsState("Failed", "critical", failure);
  }
  if (migrations.status === "pending") {
    return migrationsState(pendingValue(migrations.pending), "warning");
  }
  if (migrations.status !== "ok" || schema === undefined) {
    return uncheckedLine("migrations", "Migrations");
  }
  return migrationsState("Up to date", "ok");
}

/**
 * The storage line: when its last write failed, why, and where; working only
 * when the answer says "ok"; and unchecked for anything else.
 */
function storageLine(data: Record<string, unknown>, now: number): HealthLine {
  const storage = isRecord(data.storage) ? data.storage : {};
  if (storage.status !== "failed") {
    if (storage.status !== "ok") return uncheckedLine("storage", "Storage");
    return {
      id: "storage",
      label: "Storage",
      value: "Working",
      severity: "ok",
      links: [],
    };
  }
  const when = isText(storage.failedAt)
    ? ` ${formatRelativeTime(storage.failedAt, now)}`
    : "";
  const detail = [storage.reason, storage.adapter].filter(isText).join(" · ");
  return {
    id: "storage",
    label: "Storage",
    value: `Last write failed${when}`,
    severity: "critical",
    ...(detail === "" ? {} : { detail }),
    links: adminLink("Open media", "media"),
  };
}

/** The card's three lines, in their order, from whatever the answer holds. */
export function systemHealthLines(
  data: unknown,
  now: number = Date.now()
): HealthLine[] {
  const answer = isRecord(data) ? data : {};
  return [
    versionLine(answer),
    migrationsLine(answer),
    storageLine(answer, now),
  ];
}
