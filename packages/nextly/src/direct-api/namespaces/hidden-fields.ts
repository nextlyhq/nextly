/**
 * Hidden fields at the Direct API boundary.
 *
 * A field is hidden by core's sensitive-field rule (`sensitiveFieldPaths`):
 * `admin.hidden`, or a password. `admin.hidden` is a UI flag, not a secret:
 * it keeps a field out of the admin's forms, and the field is often public
 * data a site renders. So a read returns hidden fields unless it passes
 * `showHiddenFields: false`, trusted or judged as a caller alike. What keeps a
 * value from a caller is the field's own read rule (`access.read`).
 *
 * Password values are a separate, stricter matter: the read services strip
 * them from every read, whatever this option says.
 *
 * The paths and the strip are the public reader's own pipeline
 * (`runtime/routing/declared-fields`), so the Direct API, the public reader
 * and the webhooks cannot disagree about which fields are hidden.
 *
 * @module direct-api/namespaces/hidden-fields
 */

import { parseSortKeys } from "../../domains/collections/query/filter-shape";
import { NextlyError } from "../../errors/nextly-error";
import type { SourceEntity } from "../../runtime/routing/declared-fields";
import { filterKeys, spellings } from "../../shared/lib/filterable-fields";

/** The option that decides whether a read leaves hidden fields out. */
interface HiddenFieldOptions {
  readonly showHiddenFields?: boolean;
}

/** Whether this read leaves hidden fields out: only when it says so. */
function stripsHiddenFields(config: HiddenFieldOptions): boolean {
  return config.showHiddenFields === false;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The hidden paths this read leaves out: none when it keeps them. Loaded on
 * demand, as the public reader loads them, so a read that keeps them never
 * loads the registry's graph for it.
 */
export async function hiddenPathsFor(
  config: HiddenFieldOptions,
  source: SourceEntity
): Promise<ReadonlySet<string>> {
  if (!stripsHiddenFields(config)) return NONE;
  const { hiddenFieldPaths } = await import(
    "../../runtime/routing/declared-fields"
  );
  return hiddenFieldPaths(source);
}

/**
 * A hidden path as a query names it: a dynamic zone's member carries its
 * component type as a `#type` segment in the declared path, which a filter or
 * a sort does not spell.
 */
function queriedPath(path: string): string {
  return path.replace(/#[^.]*/g, "");
}

/**
 * Whether `key` names a hidden field, a field inside a hidden one, or a
 * container holding one: filtering a container probes what it holds. Every
 * spelling the query resolver accepts for a name is tried (`spellings`), so a
 * snake_case alias of a camelCase field is refused with it.
 */
function namesHidden(key: string, hidden: ReadonlySet<string>): boolean {
  const asked = spellings(key);
  for (const declared of hidden) {
    for (const path of spellings(queriedPath(declared))) {
      for (const name of asked) {
        if (name === path || name.startsWith(`${path}.`)) return true;
        if (path.startsWith(`${name}.`)) return true;
      }
    }
  }
  return false;
}

/**
 * Refuse a filter or a sort naming a hidden field, before anything is read:
 * the rows a filter keeps, and the order a sort puts them in, would reveal the
 * value every row is stripped of.
 */
export function refuseHiddenQuery(
  query: {
    readonly where?: unknown;
    readonly sort?: string | readonly string[];
  },
  hidden: ReadonlySet<string>
): void {
  if (hidden.size === 0) return;
  const errors = [
    ...[...filterKeys(query.where)]
      .filter(key => namesHidden(key, hidden))
      .map(key => ({
        path: `where.${key}`,
        code: "FIELD_NOT_FILTERABLE",
        message: `"${key}" is hidden, so this read cannot filter on it.`,
      })),
    ...parseSortKeys(query.sort)
      .map(key => key.field)
      .filter(key => namesHidden(key, hidden))
      .map(key => ({
        path: `sort.${key}`,
        code: "FIELD_NOT_SORTABLE",
        message: `"${key}" is hidden, so this read cannot sort by it.`,
      })),
  ];
  if (errors.length === 0) return;
  throw NextlyError.validation({
    errors,
    logContext: { reason: "direct-api-hidden-field-queried" },
  });
}

/** The document without its hidden fields; the same object when none are left out. */
export async function withoutHiddenFields<T>(
  document: T,
  hidden: ReadonlySet<string>
): Promise<T> {
  if (hidden.size === 0 || typeof document !== "object" || document === null) {
    return document;
  }
  const { withoutHidden } = await import(
    "../../runtime/routing/declared-fields"
  );
  return withoutHidden(document as Record<string, unknown>, hidden) as T;
}
