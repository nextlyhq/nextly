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

import { readableTitleText } from "nextly/config";

import { entryTitleValue } from "@admin/components/features/entries/entry-title";
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

/**
 * A value is a usable title only if it is a scalar with something in it.
 *
 * Asked of core rather than spelled again here. For every value this hook can
 * actually receive the two answers are identical -- `ApiSingle.label` is typed
 * `string`, and this is the only place the rule is used -- so the convergence
 * buys no behaviour today. It buys the guarantee that the same question keeps
 * one answer: a fourth private copy is how the other three came to disagree
 * about whitespace, numbers and bigints in the first place.
 */
const readableText = readableTitleText;

/**
 * Both queries are asked unconditionally and gated by `enabled`, because a hook
 * cannot be called on one branch and skipped on the other. The disabled one
 * fetches nothing.
 */
export function useVersionDocumentTitle(
  scope: TitleScope,
  locale?: string
): string | undefined {
  const isCollection = scope.kind === "collection";

  const collection = useCollection(isCollection ? scope.slug : undefined);
  const entry = useEntry<Record<string, unknown>>({
    collectionSlug: scope.slug,
    entryId: isCollection ? scope.entryId : "",
    enabled: isCollection,
    // The working draft, where the collection has one. The editor overlays it,
    // so without this a comparison opened from an editor showing an unpublished
    // title change is headed by the OLD published title — two surfaces naming
    // one document by different states of it.
    draft: collection.data?.draftsEnabled === true,
    // The language the comparison is about. A localized entry holds a title
    // per language, so reading without one names a French comparison by its
    // English title — the editor's own read passes its active locale, and the
    // two must agree about which state of the document they describe.
    locale,
  });
  const single = useSingleSchema(isCollection ? undefined : scope.slug);

  if (!isCollection) {
    // A Single's label is its name, and the slug is what a reader sees in the
    // URL when it has none.
    return readableText(single.data?.label) ?? scope.slug;
  }

  // What an entry is called is one question with one answer, shared with the
  // editor's heading: a document named one thing by its editor and another by
  // the page comparing its versions is worse than either name on its own.
  const fromField = entryTitleValue(
    entry.data,
    collection.data?.admin?.useAsTitle
  );

  // The id is the fallback rather than the slug alone: a slug names the
  // collection, and every entry in it would then share one title. It is also
  // what the URL already shows, so a reader can at least match the two while
  // the entry loads or when its title field is empty.
  return fromField ?? `${scope.slug} · ${scope.entryId}`;
}
