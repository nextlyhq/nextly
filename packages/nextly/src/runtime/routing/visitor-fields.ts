/**
 * What an anonymous visitor may read of a collection's or a Single's fields,
 * asked of the decisions every public read is judged by: the access gate, as
 * a visitor is judged there, and each field's read rule, asked as a query
 * asks it before it filters, with no entry.
 *
 * A module of its own because the registry, the gate and the field rules
 * reach the service container: `binding-field-shapes` imports this inside the
 * call, so importing `nextly/runtime` loads none of it.
 *
 * @module runtime/routing/visitor-fields
 */
import { routeVisitorVerdict } from "../../auth/access/route-gate-adapters";
import { getRBACService } from "../../auth/code-access";
import { getService } from "../../di/service-access";
import { getCachedNextly } from "../../init";
import {
  callerAccessGrants,
  fieldRuleTarget,
  getFieldFunctions,
  readableWithoutEntry,
  type FieldFunctions,
} from "../../shared/lib/field-level-registry";

import type { FieldReadable } from "./binding-field-shapes";

/** A collection or a Single, by its slug. */
interface SourceEntity {
  kind: "collection" | "single";
  slug: string;
}

/** A source's stored field definitions, and which of them the visitor may read. */
export interface VisitorFields {
  fields: readonly unknown[];
  readable: FieldReadable;
}

/** The fields the registry holds for the source, or `undefined` when it has no such source. */
async function declaredFields(
  source: SourceEntity
): Promise<readonly unknown[] | undefined> {
  const record =
    source.kind === "collection"
      ? await getService("collectionRegistryService").getCollectionBySlug(
          source.slug
        )
      : await getService("singleRegistryService").getSingleBySlug(source.slug);
  return record?.fields;
}

/**
 * Whether the visitor may read any of the source, by the gate a visitor's
 * read is judged by. A read rule's filter lets some entries through, so the
 * visitor reads those. Access that could not be read fails the call rather
 * than answering as if the source were closed.
 */
async function visitorReads(slug: string): Promise<boolean> {
  const verdict = await routeVisitorVerdict(
    "read",
    slug,
    getRBACService(),
    true
  );
  if (verdict.allowed) return true;
  if (verdict.refusal === "failed") throw verdict.error;
  return verdict.refusal === "only-matching-entries";
}

/**
 * The visitor's answer for one field path: each field along it must let the
 * visitor read it with no entry given. Only a field's own rule is asked at
 * each step, so a group with one hidden child still shows its others.
 */
function fieldReader(source: SourceEntity): FieldReadable {
  const caller = {
    grants: callerAccessGrants(undefined),
    target: fieldRuleTarget(source.kind, source.slug),
  };
  const registered = getFieldFunctions(source.kind, source.slug);
  return async path => {
    let level: Record<string, FieldFunctions> | undefined = registered;
    for (const name of path) {
      const field =
        level !== undefined && Object.hasOwn(level, name)
          ? level[name]
          : undefined;
      const rule = field?.access?.read;
      if (
        rule !== undefined &&
        !(await readableWithoutEntry({ access: { read: rule } }, caller))
      ) {
        return false;
      }
      level = field?.fields;
    }
    return true;
  };
}

/**
 * The source's fields and the visitor's reader for them, or `undefined` when
 * there is no such source or the visitor may read none of it.
 */
export async function visitorFields(
  source: SourceEntity
): Promise<VisitorFields | undefined> {
  await getCachedNextly();
  const fields = await declaredFields(source);
  if (fields === undefined || !(await visitorReads(source.slug))) {
    return undefined;
  }
  return { fields, readable: fieldReader(source) };
}
