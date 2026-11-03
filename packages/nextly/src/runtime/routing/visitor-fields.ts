/**
 * What an anonymous visitor may read of a collection's or a Single's fields,
 * asked of the decisions every public read is judged by: the access gate, as
 * a visitor is judged there, each field's read rule, asked as a query asks it
 * before it filters, with no entry, and core's hidden-field rule.
 *
 * A module of its own because the registry, the gate and the field rules
 * reach the service container: `binding-field-shapes` imports this inside the
 * call, so importing `nextly/runtime` loads none of it.
 *
 * @module runtime/routing/visitor-fields
 */
import { routeVisitorVerdict } from "../../auth/access/route-gate-adapters";
import {
  everyLanguage,
  registeredReadLanguagesFor,
  withRuleLanguage,
} from "../../auth/access/rule-language";
import { getRBACService } from "../../auth/code-access";
import { getCachedNextly } from "../../init";
import {
  callerAccessGrants,
  fieldRuleTarget,
  getFieldFunctions,
  readableWithoutEntry,
  type FieldFunctions,
} from "../../shared/lib/field-level-registry";

import type { FieldReadable } from "./binding-field-shapes";
import {
  declaredFields,
  hiddenFieldPaths,
  type SourceEntity,
} from "./declared-fields";

/** A source's stored field definitions, and which of them the visitor may read. */
export interface VisitorFields {
  fields: readonly unknown[];
  readable: FieldReadable;
}

/**
 * Runs `operation` with its rules told the language the shapes are for: the
 * one a read in `locale` involves, as a read in it is judged, or every
 * configured language when none is named, as core tells an operation that
 * names none. Set here rather than inherited, so the answer is the same
 * whatever frame the caller happens to be running in.
 */
export function inReadLanguage<T>(
  locale: string | undefined,
  operation: () => T
): T {
  const language =
    locale === undefined ? everyLanguage() : registeredReadLanguagesFor(locale);
  return withRuleLanguage(language, operation);
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
 * The visitor's answer for one field path: a hidden field never, and
 * otherwise each field along the path must let the visitor read it with no
 * entry given. Only a field's own rule is asked at each step, so a group with
 * one hidden child still shows its others.
 */
function fieldReader(
  source: SourceEntity,
  hidden: ReadonlySet<string>
): FieldReadable {
  const caller = {
    grants: callerAccessGrants(undefined),
    target: fieldRuleTarget(source.kind, source.slug),
  };
  const registered = getFieldFunctions(source.kind, source.slug);
  return async path => {
    if (hidden.has(path.join("."))) return false;
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
  const hidden = await hiddenFieldPaths(source);
  return { fields, readable: fieldReader(source, hidden) };
}
