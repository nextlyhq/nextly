/**
 * The readable name of the document a comparison belongs to.
 *
 * A comparison page carries an opaque id in its URL and the dashboard header
 * shows no breadcrumbs, so without this the page announces itself only as
 * "Version history" and a reader cannot tell which entry or Single the
 * snapshots belong to without navigating away.
 *
 * One hook rather than a derivation in each wrapper. The collection and Single
 * routes ask the same question of different schemas, and answering it twice is
 * how the two pages come to name a document differently.
 *
 * @module components/features/versions/useVersionDocumentTitle
 */

import { pickTitleFieldName } from "@admin/components/features/entries/EntryList/EntryTableColumns";
import { useCollection } from "@admin/hooks/queries/useCollections";
import { useEntry } from "@admin/hooks/queries/useEntry";
import { useSingleSchema } from "@admin/hooks/queries/useSingles";
/**
 * What naming a document actually depends on.
 *
 * Narrower than `VersionScope` on purpose: a Single's title comes from its
 * schema, which is reached by slug alone, and the Single route cannot name its
 * scope until it has read the document's id. Asking for the whole scope would
 * make this hook uncallable exactly where it is needed, or force a placeholder
 * id through it.
 */
export type TitleScope =
  | { kind: "collection"; slug: string; entryId: string }
  | { kind: "single"; slug: string };

/** A value is a usable title only if it is text with something in it. */
function readableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Both queries are asked unconditionally and gated by `enabled`, because a hook
 * cannot be called on one branch and skipped on the other. The disabled one
 * fetches nothing.
 */
export function useVersionDocumentTitle(scope: TitleScope): string | undefined {
  const isCollection = scope.kind === "collection";

  const collection = useCollection(isCollection ? scope.slug : undefined);
  const entry = useEntry<Record<string, unknown>>({
    collectionSlug: scope.slug,
    entryId: isCollection ? scope.entryId : "",
    enabled: isCollection,
  });
  const single = useSingleSchema(isCollection ? undefined : scope.slug);

  if (!isCollection) {
    // A Single's label is its name, and the slug is what a reader sees in the
    // URL when it has none.
    return readableText(single.data?.label) ?? scope.slug;
  }

  // Which field names an entry is the collection's decision, and the entry list
  // already makes it — through `useAsTitle` where the author set one, and a
  // conventional field otherwise. Reused rather than restated so a comparison
  // names an entry the way its list does.
  // Which field names an entry is the collection's decision, and the entry list
  // already makes it — `useAsTitle` where the author set one, a conventional
  // field otherwise. The rule is shared rather than restated, so a comparison
  // names an entry the way its list does.
  const fields = collection.data?.fields;
  const titleField = fields
    ? pickTitleFieldName(
        collection.data?.admin?.useAsTitle,
        fields.map(field => field.name)
      )
    : undefined;
  const fromField = titleField
    ? readableText(entry.data?.[titleField])
    : undefined;

  // The id is the fallback rather than the slug alone: a slug names the
  // collection, and every entry in it would then share one title. It is also
  // what the URL already shows, so a reader can at least match the two while
  // the entry loads or when its title field is empty.
  return fromField ?? `${scope.slug} · ${scope.entryId}`;
}
