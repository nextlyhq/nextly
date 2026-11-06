/**
 * The fields the status lifecycle writes on its own, and whether a write
 * edits anything else: ONE reading for the trail's writer and its readers.
 *
 * @module domains/audit/lifecycle-fields
 */

import {
  SYSTEM_COLUMNS,
  type SystemColumnEntity,
} from "../../lib/system-columns";
import {
  differingFields,
  type SharedViews,
} from "../versions/shared-publish-base";

/**
 * The fields the status lifecycle stamps on its own: `updatedAt`, which every
 * write stamps, and every system column that exists only with Draft/Published,
 * by the name a document carries it under. Taken from the declarations rather
 * than listed, so a lifecycle column added there is one here too.
 */
export const LIFECYCLE_FIELDS: ReadonlySet<string> = new Set([
  "updatedAt",
  ...SYSTEM_COLUMNS.filter(
    column => column.presence === "withStatusLifecycle"
  ).map(column => column.camelName),
]);

/**
 * Every field the system writes rather than a person on one kind of document:
 * the lifecycle's, and the system columns every such document carries (`id`,
 * `createdAt`, and on a collection `createdBy`), which a write ignores whatever
 * a request says. By entity, as the columns declare it: a Single has no
 * `createdBy` column, so a field an author names that is theirs to write. Not
 * `title` or `slug`: they are system columns only until an author declares
 * their own, and a person writes them either way.
 */
function systemFieldsOf(entity: SystemColumnEntity): ReadonlySet<string> {
  return new Set([
    ...LIFECYCLE_FIELDS,
    ...SYSTEM_COLUMNS.filter(
      column =>
        column.presence === "always" && column.appliesTo.includes(entity)
    ).map(column => column.camelName),
  ]);
}

const SYSTEM_FIELDS: Readonly<Record<SystemColumnEntity, ReadonlySet<string>>> =
  {
    collection: systemFieldsOf("collection"),
    single: systemFieldsOf("single"),
  };

/**
 * Whether a publish edits what it promotes: whether `promoted`, the draft as
 * persisted with the request's own values written over it, holds a field a
 * person writes at a value other than the `draft`'s. What a publish states as
 * `requestEdits`.
 *
 * ONE comparison of two whole documents built from the same persisted draft,
 * so a value the request left alone is the draft's own on both sides, and a
 * component patch is judged merged, as it is written, not as the fragment
 * sent. Values are compared as a stored snapshot holds them
 * (`differingFields`): a date sent as a `Date` is the ISO string the draft
 * keeps, and a field named in `views`, a junction's ids, is compared through
 * that view. A system field of the `entity`, which no write takes from a
 * request, is no edit.
 */
export function editsOver(args: {
  entity: SystemColumnEntity;
  draft: Record<string, unknown>;
  promoted: Record<string, unknown>;
  views?: SharedViews;
}): boolean {
  const system = SYSTEM_FIELDS[args.entity];
  return (
    differingFields(
      Object.keys(args.promoted).filter(name => !system.has(name)),
      args.draft,
      args.promoted,
      args.views
    ).length > 0
  );
}
