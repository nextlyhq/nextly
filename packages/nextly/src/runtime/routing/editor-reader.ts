/**
 * The reader a page builder's canvas reads a list with: the same queries a
 * published page's list makes, read AS THE PERSON EDITING, drafts included.
 *
 * The published page reads every list as an anonymous visitor
 * (`createPublicReader`): published entries and the fields the public may
 * read. While a page is being edited, its author should see the content they
 * could see in the admin: their drafts, the rows their access lets them read
 * and the fields their field rules allow, never more. This reader takes the
 * public reader's query, with the same keys, the same refusals and the same
 * limits, so a list cannot read differently on the canvas because of how it
 * was asked, and changes only who reads and which states are read:
 *
 * - every read is `overrideAccess: false` as the given person (their user,
 *   and an API key's own scope when the request carried one), so core's one
 *   access gate decides, exactly as for that person's own reads. A collection
 *   they may not read is refused, and rows and fields their rules deny are
 *   left out;
 * - `status: "all"`, so a draft the person may read is listed with the rest;
 * - a filter or sort on a field the PUBLIC may not read is refused before
 *   anything is read, as on the published page, so a list the published page
 *   would refuse never looks right on the canvas. "May not read" is the
 *   visitor's own answer (a field declared hidden, or one whose read rule
 *   denies the anonymous visitor), never this person's access. The rows themselves are not stripped of such fields:
 *   the person may read them, and what the public could not is the canvas's
 *   to mark, not this reader's to hide.
 *
 * Each read runs detached from the request being served and from any person
 * an enclosing operation is made as, so only the person named here judges
 * it. Nothing it reads is cached or tagged: the result goes to the one
 * person who asked, and never into anything a published page reads.
 *
 * @module runtime/routing/editor-reader
 * @experimental
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { runDetachedFromRequest } from "../../auth/caller-scope";
import { runAsPrincipal } from "../../auth/principal-scope";
import type { FindArgs } from "../../direct-api/types/collections";
import type { UserContext } from "../../direct-api/types/shared";

import {
  assertCountKeys,
  assertNotHidden,
  createPublicReader,
  hiddenOf,
  refuse,
  sortKeys,
  toPublicFind,
  type PublicCountQuery,
  type PublicReader,
  type PublicReaderBinding,
  type PublicReaderSource,
  type PublicReadQuery,
  type PublicReadResult,
} from "./public-reader";
import { readAsVisitor } from "./read-as-visitor";

/**
 * Who an editor reader reads as: the signed-in person, and an API key's own
 * scope when the request was made with one, so the key is judged on its
 * grants rather than its owner's.
 *
 * @experimental
 */
export interface EditorReaderPerson {
  readonly user: UserContext | undefined;
  readonly actor?: AuthenticatedScope;
}

/**
 * The read a public list query becomes when the person editing makes it:
 * the public read's arguments, with who reads and which states replaced.
 * Pure: every refusal `toPublicFind` makes happens here too, before
 * anything is read.
 *
 * @experimental
 */
export function toEditorFind(
  query: PublicReadQuery,
  person: EditorReaderPerson,
  binding: PublicReaderBinding = {}
): FindArgs {
  return {
    ...toPublicFind(query, binding),
    // Drafts with the rest; the person's own access still bounds every row.
    status: "all",
    overrideAccess: false,
    user: person.user,
    actor: person.actor,
  };
}

/** The fields a list's filter and sort name, the id aside: every row has it. */
function namedFields(
  query: Pick<PublicReadQuery, "filters" | "sort">
): string[] {
  return [
    ...new Set([
      ...(query.filters ?? []).map(row => row.field),
      ...sortKeys(query.sort).map(key => key.replace(/^-/, "")),
    ]),
  ].filter(name => name !== "id");
}

/**
 * Refuse a filter or sort naming a field the anonymous visitor may not read,
 * as the published page's read refuses it, BEFORE anything is read: a query
 * the page refuses runs no read and no read hook on the canvas either.
 *
 * Who answers "may the visitor read it" follows the public reader:
 * - given `binding.declarations`, a reader over something other than this
 *   process's Nextly, the SAME source answers, asked as the visitor: the
 *   public reader's own read of the query (one row, its id only), over the
 *   source this reader reads, refuses what the published page refuses, the
 *   declared hidden fields and the source's own field rules alike. The
 *   query's values never come back from it;
 * - otherwise this process's instance answers, through core's visitor field
 *   reader (`visitorFields`), judged as no one in the read's language: a
 *   field declared hidden and a field whose read rule denies the visitor are
 *   both refused. Where the visitor may read nothing of the collection, the
 *   published page shows nothing of the list at all, and its fields are not
 *   judged: the canvas marks such a list, and this reader still answers the
 *   person.
 */
async function assertListFieldsPublic(
  query: Pick<PublicReadQuery, "collection" | "filters" | "sort" | "locale">,
  binding: PublicReaderBinding,
  source: PublicReaderSource
): Promise<void> {
  const named = namedFields(query);
  // Nothing named, nothing to judge: no instance or declaration is asked.
  if (named.length === 0) return;
  if (binding.declarations !== undefined) {
    // What the declarations say is hidden is refused without a read; what
    // only the source's field rules decide is asked of the source.
    assertNotHidden(
      query,
      await hiddenOf(binding, { kind: "collection", slug: query.collection })
    );
    await createPublicReader(source, binding).find({
      collection: query.collection,
      ...(query.filters === undefined ? {} : { filters: query.filters }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.locale === undefined ? {} : { locale: query.locale }),
      limit: 1,
      select: ["id"],
    });
    return;
  }
  const { inReadLanguage, visitorFields } = await import("./visitor-fields");
  const refused = await readAsVisitor(() =>
    inReadLanguage(binding.locale ?? query.locale, async () => {
      const visible = await visitorFields({
        kind: "collection",
        slug: query.collection,
      });
      if (visible === undefined) return [];
      const denied: string[] = [];
      for (const name of named) {
        if (!(await visible.readable([name]))) denied.push(name);
      }
      return denied.sort();
    })
  );
  if (refused.length > 0) {
    refuse(
      "field-not-public",
      `A list cannot filter or sort by ${refused.map(name => `"${name}"`).join(", ")}: visitors may not read it, so the published page refuses the list.`,
      { fields: refused }
    );
  }
}

/**
 * A reader over a Direct API's `find`, reading as `person`. A person with no
 * user is no one: their reads are refused by core as an anonymous read of a
 * draft would be, never widened.
 *
 * @experimental
 */
export function createEditorReader(
  nextly: PublicReaderSource,
  person: EditorReaderPerson,
  binding: PublicReaderBinding = {}
): PublicReader {
  const read = (args: FindArgs) =>
    // `null` is a frame of its own, so it clears a person an enclosing
    // operation was made as rather than inheriting it; the person named in
    // the arguments is the only one who judges the read.
    runDetachedFromRequest(() => runAsPrincipal(null, () => nextly.find(args)));
  return Object.freeze({
    async find(query: PublicReadQuery): Promise<PublicReadResult> {
      // The query's own shape first (the public reader's refusals, before
      // anything is asked of its fields), then the published page's refusals
      // of its fields, so a query either refuses reads nothing as the person.
      const args = toEditorFind(query, person, binding);
      await assertListFieldsPublic(query, binding, nextly);
      return read(args);
    },
    async count(query: PublicCountQuery): Promise<number> {
      // Only what narrows a count, as the public reader's count takes, and
      // the published page's refusals, before anything is read.
      assertCountKeys(query);
      const args = toEditorFind(
        { ...query, limit: 1, select: ["id"] },
        person,
        binding
      );
      await assertListFieldsPublic(query, binding, nextly);
      const result = await read(args);
      return result.meta.total;
    },
  });
}
