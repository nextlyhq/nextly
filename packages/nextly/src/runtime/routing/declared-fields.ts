/**
 * A collection's or a Single's declared fields, from the registry, and the
 * fields among them a public read must never return.
 *
 * A field declared hidden (`hidden` or `admin.hidden`) is kept out of every
 * webhook payload by core's sensitive-field rule, `sensitiveFieldPaths`, but
 * the read pipeline returns it to any caller its field rules allow, the
 * anonymous visitor included. A published page is that visitor, so the public
 * reads strip what that rule names, and a list may not filter or sort on it.
 * The rule is core's, asked here rather than restated, so the two cannot
 * disagree about which fields are hidden.
 *
 * Only the service lookups are imported, so the public reader can load this
 * inside its reads without loading the registry's own graph.
 *
 * @module runtime/routing/declared-fields
 */
import type { FieldConfig } from "../../collections/fields/types";
import { getService, isServicesRegistered } from "../../di/service-access";
import { sensitiveFieldPaths } from "../../domains/webhooks/sensitive-fields";
import { defineOwnProperty } from "../../shared/lib/own-property";

/** A collection or a Single, by its slug. */
export interface SourceEntity {
  kind: "collection" | "single";
  slug: string;
}

/** The fields the registry holds for the source, or `undefined` when it has no such source. */
export async function declaredFields(
  source: SourceEntity
): Promise<readonly FieldConfig[] | undefined> {
  const record =
    source.kind === "collection"
      ? await getService("collectionRegistryService").getCollectionBySlug(
          source.slug
        )
      : await getService("singleRegistryService").getSingleBySlug(source.slug);
  return record?.fields;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The dotted paths of the source's hidden and password fields, by core's
 * sensitive-field rule.
 *
 * None when no services are registered. A Direct API reads through the
 * registered services, so a reader with none behind it is not reading this
 * site's content, and there is no declaration to consult. None, too, for a
 * source the registry does not hold: the read itself answers for that.
 */
export async function hiddenFieldPaths(
  source: SourceEntity
): Promise<ReadonlySet<string>> {
  if (!isServicesRegistered()) return NONE;
  const fields = await declaredFields(source);
  return fields === undefined ? NONE : new Set(sensitiveFieldPaths(fields));
}

/**
 * A copy of `value` without the keys whose dotted path is in `hidden`. An
 * array's elements add no segment, so one path covers every row of a
 * repeater, as the sensitive-field rule writes it. Dates are values.
 */
function strip(
  value: unknown,
  hidden: ReadonlySet<string>,
  prefix: string
): unknown {
  if (Array.isArray(value)) return value.map(row => strip(row, hidden, prefix));
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  return stripObject(value, hidden, prefix);
}

function stripObject(
  value: object,
  hidden: ReadonlySet<string>,
  prefix: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (hidden.has(path)) continue;
    // Defined, not assigned, so a stored `__proto__` key stays a key.
    defineOwnProperty(out, key, strip(child, hidden, path));
  }
  return out;
}

/** The document without its hidden fields; the same object when there are none. */
export function withoutHidden(
  document: Record<string, unknown>,
  hidden: ReadonlySet<string>
): Record<string, unknown> {
  return hidden.size === 0 ? document : stripObject(document, hidden, "");
}
