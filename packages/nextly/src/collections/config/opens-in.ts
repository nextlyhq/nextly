/**
 * The boot's judgement of where a collection's entries open.
 *
 * `admin.opensIn` names `"form"` or the path of a document view. A path no
 * view answers would leave every link to the collection's entries pointing at
 * a page that is not found, and a view offered on a field type the collection
 * holds nowhere at its top level would open its entries on nothing; nothing in
 * the admin can tell either from a mistyped path. Boot is where the config and
 * the plugins' views meet, so the refusal is here and names both.
 *
 * Judged against every plugin's views, disabled ones included, so switching a
 * plugin off never stops a start: the admin opens the form while the view is
 * not published. Schema Builder collections never carry the option.
 *
 * @module collections/config/opens-in
 */
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import {
  declaredDocumentViews,
  type ContributedDocumentView,
} from "../../plugins/validate-document-views";

/** The value that keeps a collection's entries in the form. */
export const OPENS_IN_FORM = "form";

/** A collection as the merged configuration holds it. */
interface ConfiguredCollection {
  slug: string;
  fields?: readonly unknown[];
  admin?: unknown;
}

/** A collection's declared `admin.opensIn`, read through `unknown`. */
function declaredOpensIn(collection: ConfiguredCollection): unknown {
  const admin = collection.admin;
  if (typeof admin !== "object" || admin === null) return undefined;
  return "opensIn" in admin ? admin.opensIn : undefined;
}

/**
 * The field types a collection holds at its top level: its own fields and,
 * as the form lays them out, those of an unnamed group, which adds nothing to
 * a field's path. A named group or a repeater moves its fields down a level.
 */
function topLevelFieldTypes(
  fields: readonly unknown[] | undefined,
  within: readonly unknown[] = []
): Set<string> {
  const types = new Set<string>();
  for (const field of fields ?? []) {
    if (typeof field !== "object" || field === null) continue;
    const type = "type" in field ? field.type : undefined;
    if (typeof type === "string") types.add(type);
    const named = "name" in field && typeof field.name === "string";
    const children = "fields" in field ? field.fields : undefined;
    // A cycle in raw config would otherwise recurse until the stack ran out.
    if (type !== "group" || named || within.includes(field)) continue;
    if (!Array.isArray(children)) continue;
    for (const inner of topLevelFieldTypes(children, [...within, field])) {
      types.add(inner);
    }
  }
  return types;
}

/** Why one collection's `opensIn` is refused, or `undefined` when it is not. */
function opensInProblem(
  collection: ConfiguredCollection,
  views: readonly ContributedDocumentView[]
): string | undefined {
  const opensIn = declaredOpensIn(collection);
  if (opensIn === undefined || opensIn === OPENS_IN_FORM) return undefined;
  const named = `The collection "${collection.slug}" opens its entries in`;
  if (typeof opensIn !== "string") {
    return `${named} ${JSON.stringify(opensIn)}, which is not "form" or a view's path.`;
  }
  const own = views.find(
    view =>
      view.path === opensIn && "slug" in view && view.slug === collection.slug
  );
  if (own !== undefined) return undefined;
  const offered = views.find(
    view => view.path === opensIn && "fieldType" in view
  );
  if (offered === undefined || !("fieldType" in offered)) {
    return `${named} "${opensIn}", a view no plugin declares on it.`;
  }
  if (topLevelFieldTypes(collection.fields).has(offered.fieldType)) {
    return undefined;
  }
  return (
    `${named} "${opensIn}", a view of "${offered.fieldType}" fields, and ` +
    `has no "${offered.fieldType}" field at its top level.`
  );
}

/**
 * Throw where a collection's `admin.opensIn` names a view it does not have,
 * naming every such collection and view.
 *
 * @throws NextlyError (INVALID_INPUT) naming each problem, with the remedy.
 */
export function assertCollectionOpensIn(
  collections: readonly ConfiguredCollection[] | undefined,
  plugins: PluginDefinition[]
): void {
  const views = declaredDocumentViews(plugins);
  const problems = (collections ?? []).flatMap(collection => {
    const problem = opensInProblem(collection, views);
    return problem === undefined ? [] : [problem];
  });
  if (problems.length === 0) return;
  throw NextlyError.invalidInput({
    message:
      `${problems.join(" ")} Set \`admin.opensIn\` to "form" or to the path ` +
      "of a view the collection has, or remove it.",
    logContext: { problems },
  });
}
