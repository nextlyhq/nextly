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

/** The version line: the running Nextly, never a problem. */
function versionLine(data: Record<string, unknown>): HealthLine {
  const version = isText(data.version) ? data.version : "unknown";
  return {
    id: "version",
    label: "Version",
    value: `Nextly ${version}`,
    severity: "ok",
    links: [],
  };
}

/** One link per collection whose last schema change failed, then the rest. */
function schemaChangeLinks(schema: unknown): HealthLink[] {
  if (!isRecord(schema)) return [];
  const failed = Array.isArray(schema.failed) ? schema.failed : [];
  const links = failed.flatMap(entry =>
    isRecord(entry) && isText(entry.slug)
      ? adminLink(
          `Fix ${isText(entry.label) ? entry.label : entry.slug}`,
          `builder/collections/${encodeURIComponent(entry.slug)}`
        )
      : []
  );
  const more = whole(schema.more);
  return more > 0
    ? [...links, ...adminLink(`${more} more`, "builder/collections")]
    : links;
}

/**
 * The migrations line: failed when a migration or a collection's schema
 * change did not apply, pending while migrations are still applying, up to
 * date only when the answer says "ok", and unchecked otherwise: a missing
 * line or an unknown status is not a healthy one.
 */
function migrationsLine(data: Record<string, unknown>): HealthLine {
  const migrations = isRecord(data.migrations) ? data.migrations : {};
  const schemaLinks = schemaChangeLinks(data.schemaChanges);
  const failedFiles = migrations.status === "failed";
  if (failedFiles || schemaLinks.length > 0) {
    return {
      id: "migrations",
      label: "Migrations",
      value: "Failed",
      severity: "critical",
      links: [
        ...(failedFiles
          ? [
              {
                label: "How to resolve",
                href: MIGRATIONS_DOCS,
                external: true as const,
              },
            ]
          : []),
        ...schemaLinks,
      ],
    };
  }
  if (migrations.status === "pending") {
    const pending = whole(migrations.pending);
    return {
      id: "migrations",
      label: "Migrations",
      value: pending > 0 ? `${pending} pending` : "Pending",
      severity: "warning",
      links: [],
    };
  }
  if (migrations.status !== "ok")
    return uncheckedLine("migrations", "Migrations");
  return {
    id: "migrations",
    label: "Migrations",
    value: "Up to date",
    severity: "ok",
    links: [],
  };
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
