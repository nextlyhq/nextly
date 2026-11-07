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

import type { ComponentLevel, FieldReadable } from "./binding-field-shapes";
import {
  expandedDeclaration,
  expandedFields,
  hiddenFieldPaths,
  type SourceEntity,
} from "./declared-fields";

/** A source's field definitions, components expanded, and which of them the visitor may read. */
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
 *
 * The instance is booted first. The languages are read from its registry,
 * which knows none until it boots, so on a cold process a frame opened before
 * the boot would tell the first call's rules no language at all.
 */
export async function inReadLanguage<T>(
  locale: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  await getCachedNextly();
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

/** The rules one entity files its fields' rules under, and what they judge. */
interface RuleLevel {
  registered: Record<string, FieldFunctions> | undefined;
  caller: Parameters<typeof readableWithoutEntry>[1];
}

/**
 * Whether each field along `names`, from `level`, lets the visitor read it
 * with no entry given. Only a field's own rule is asked at each step, so a
 * group with one hidden child still shows its others.
 */
async function readableAlong(
  level: RuleLevel,
  names: readonly string[]
): Promise<boolean> {
  let fields = level.registered;
  for (const name of names) {
    const field =
      fields !== undefined && Object.hasOwn(fields, name)
        ? fields[name]
        : undefined;
    const rule = field?.access?.read;
    if (
      rule !== undefined &&
      !(await readableWithoutEntry({ access: { read: rule } }, level.caller))
    ) {
      return false;
    }
    fields = field?.fields;
  }
  return true;
}

/**
 * The visitor's answer for one field path: a hidden field never, and
 * otherwise the field's rules where they are filed. A field inside a
 * component is judged by that component's own rules, from its place in the
 * component; the field holding the component was judged when it was reached.
 */
function fieldReader(
  source: SourceEntity,
  hidden: ReadonlySet<string>
): FieldReadable {
  // One grants resolver for every level, so the visitor is read once.
  const grants = callerAccessGrants(undefined);
  const levelOf = (
    kind: SourceEntity["kind"] | "fieldGroup",
    slug: string
  ) => ({
    registered: getFieldFunctions(kind, slug),
    caller: { grants, target: fieldRuleTarget(kind, slug) },
  });
  const own = levelOf(source.kind, source.slug);
  const components = new Map<string, RuleLevel>();
  const componentLevel = (slug: string): RuleLevel => {
    const known = components.get(slug);
    if (known !== undefined) return known;
    const level = levelOf("fieldGroup", slug);
    components.set(slug, level);
    return level;
  };
  return async (path: readonly string[], within?: ComponentLevel) => {
    if (hidden.has(path.join("."))) return false;
    return within === undefined
      ? readableAlong(own, path)
      : readableAlong(componentLevel(within.component), within.path);
  };
}

/**
 * The source's declared fields, expanded as a binding reads them (a group's
 * own fields, a component field's component), whoever may read them, and
 * the timestamps a read of it returns; or `undefined` when there is no such
 * source. What an editor may bind, as opposed to what a visitor may read
 * ({@link visitorFields}).
 */
export async function declaredSource(source: SourceEntity): Promise<
  | {
      readonly fields: VisitorFields["fields"];
      readonly timestamps: readonly ("createdAt" | "updatedAt")[];
    }
  | undefined
> {
  await getCachedNextly();
  return expandedDeclaration(source);
}

/**
 * The source's fields and the visitor's reader for them, or `undefined` when
 * there is no such source or the visitor may read none of it.
 */
export async function visitorFields(
  source: SourceEntity
): Promise<VisitorFields | undefined> {
  await getCachedNextly();
  const fields = await expandedFields(source);
  if (fields === undefined || !(await visitorReads(source.slug))) {
    return undefined;
  }
  const hidden = await hiddenFieldPaths(source);
  return { fields, readable: fieldReader(source, hidden) };
}
