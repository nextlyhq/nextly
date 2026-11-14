/**
 * The registry rows a production start finds behind the build it runs: a
 * code-first collection or Single whose row lacks a field the build declares,
 * or that has no row at all. Logged once per start, naming each row, with
 * the command that brings it up to date.
 *
 * A production start serves the registry `nextly migrate` wrote and writes
 * none of it, so a row left behind stays behind until the next `nextly
 * migrate`: a deploy whose migrate did not run, or a start of an earlier
 * release, which rewrote every row from its own configuration, serving while
 * a new deployment migrated. The admin then shows such a type without the
 * missing field, and nothing else says why.
 *
 * Read from the rows the start has already read (`start-reads`), so the start
 * sends no statement more. Each declaration is put through the projection the
 * registry writer stores (`toCodeFirstCollectionConfig`,
 * `toCodeFirstSingleConfig`), so a field the row is compared on is one a
 * written row holds.
 *
 * @module di/registry-rows-behind-build
 */
import type { Logger } from "../shared/types";

import type { StartRegistry } from "./start-reads";

/** A declared type, as the registry writer projects it. */
export interface DeclaredRowShape {
  kind: "collection" | "single";
  slug: string;
  fields: readonly unknown[];
}

/** A row behind the build: missing, or lacking the fields named. */
export interface RowBehindBuild {
  kind: "collection" | "single";
  slug: string;
  /** The declared fields the row lacks; empty where there is no row. */
  missingFields: string[];
  row: "missing" | "lacks-fields";
}

/** The registry table each kind's rows are read from. */
const REGISTRY_TABLE = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
} as const;

/** The top-level field names of a field list, a row's stored JSON included. */
function fieldNames(fields: unknown): string[] {
  let list = fields;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap(field => {
    const name =
      typeof field === "object" && field !== null
        ? (field as { name?: unknown }).name
        : undefined;
    return typeof name === "string" && name !== "" ? [name] : [];
  });
}

/**
 * Each declared type whose row is missing or lacks a declared field. Pure:
 * `rows` is each kind's rows as read, and a kind absent from it was not read,
 * so nothing of that kind is judged.
 */
export function rowsBehindBuild(
  declared: readonly DeclaredRowShape[],
  rows: ReadonlyMap<
    DeclaredRowShape["kind"],
    readonly Record<string, unknown>[]
  >
): RowBehindBuild[] {
  const behind: RowBehindBuild[] = [];
  for (const type of declared) {
    const read = rows.get(type.kind);
    if (read === undefined) continue;
    const row = read.find(each => each.slug === type.slug);
    if (row === undefined) {
      behind.push({
        kind: type.kind,
        slug: type.slug,
        missingFields: [],
        row: "missing",
      });
      continue;
    }
    const held = new Set(fieldNames(row.fields));
    const missingFields = fieldNames(type.fields).filter(
      name => !held.has(name)
    );
    if (missingFields.length > 0) {
      behind.push({
        kind: type.kind,
        slug: type.slug,
        missingFields,
        row: "lacks-fields",
      });
    }
  }
  return behind;
}

/** The line a start logs for one row behind the build. */
export function rowBehindBuildLine(row: RowBehindBuild): string {
  if (row.row === "missing") {
    return `${row.kind} "${row.slug}": the build declares it, but it has no registry row. Run \`nextly migrate\` to write it.`;
  }
  const named = row.missingFields.map(name => `"${name}"`).join(", ");
  const noun = row.missingFields.length === 1 ? "field" : "fields";
  return `${row.kind} "${row.slug}": the build declares ${noun} ${named}, which its registry row lacks. Run \`nextly migrate\` to bring the row up to date.`;
}

/**
 * Log each row behind the build, from the rows the start read. A registry
 * the start could not read is passed over: the start reports that read's
 * failure where it happens, and this never fails a start.
 */
export async function reportRowsBehindBuild(
  registry: StartRegistry,
  declared: readonly DeclaredRowShape[],
  logger: Pick<Logger, "warn">
): Promise<void> {
  const rows = new Map<
    DeclaredRowShape["kind"],
    readonly Record<string, unknown>[]
  >();
  for (const kind of ["collection", "single"] as const) {
    if (!declared.some(type => type.kind === kind)) continue;
    try {
      const read = await registry.read(REGISTRY_TABLE[kind]);
      if (read.exists) rows.set(kind, await read.rows());
    } catch {
      // Not read: nothing of this kind is judged.
    }
  }
  for (const row of rowsBehindBuild(declared, rows)) {
    logger.warn(rowBehindBuildLine(row));
  }
}
