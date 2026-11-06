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

import { isMissOrDenied } from "./miss-or-denied";
import {
  assertCountKeys,
  assertNotHidden,
  hiddenOf,
  refuse,
  selectedFrom,
  sortKeys,
  toPublicFind,
  toPublicFindSingle,
  type PublicCountQuery,
  type PublicSingleQuery,
  type PublicSingleResult,
  type PublicSourceReader,
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
 *   process's Nextly, the declarations answer, as they answer the public
 *   reader: a field they declare hidden is refused;
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
  binding: PublicReaderBinding
): Promise<void> {
  const named = namedFields(query);
  // Nothing named, nothing to judge: no instance or declaration is asked.
  if (named.length === 0) return;
  if (binding.declarations !== undefined) {
    assertNotHidden(
      query,
      await hiddenOf(binding, { kind: "collection", slug: query.collection })
    );
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
 * The read a public Single query becomes when the person editing makes it:
 * the public read's arguments, read as the person, with the working draft in
 * place of the live document where one is pending and they may edit it (a
 * person who may only read it gets the published values, as core decides).
 *
 * @experimental
 */
export function toEditorFindSingle(
  query: PublicSingleQuery,
  person: EditorReaderPerson,
  binding: PublicReaderBinding = {}
): ReturnType<typeof toPublicFindSingle> {
  return {
    ...toPublicFindSingle(query, binding),
    status: "all",
    draft: true,
    overrideAccess: false,
    user: person.user,
    actor: person.actor,
  };
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
): PublicSourceReader {
  const read = (args: FindArgs) =>
    // `null` is a frame of its own, so it clears a person an enclosing
    // operation was made as rather than inheriting it; the person named in
    // the arguments is the only one who judges the read.
    runDetachedFromRequest(() => runAsPrincipal(null, () => nextly.find(args)));
  return Object.freeze({
    async find(query: PublicReadQuery): Promise<PublicReadResult> {
      // The published page's refusals first, so a query it refuses reads
      // nothing here either.
      await assertListFieldsPublic(query, binding);
      return read(toEditorFind(query, person, binding));
    },
    async count(query: PublicCountQuery): Promise<number> {
      // Only what narrows a count, as the public reader's count takes, and
      // the published page's refusals, before anything is read.
      assertCountKeys(query);
      await assertListFieldsPublic(query, binding);
      const result = await read(
        toEditorFind({ ...query, limit: 1, select: ["id"] }, person, binding)
      );
      return result.meta.total;
    },
    async findSingle(query: PublicSingleQuery): Promise<PublicSingleResult> {
      const args = toEditorFindSingle(query, person, binding);
      const findSingle = nextly.findSingle;
      if (findSingle === undefined) {
        // As the public reader answers a reader made without a Single's read.
        return refuse(
          "single-unsupported",
          "This reader was made over a reader with no findSingle, so it cannot read a Single."
        );
      }
      // Missing, never published and refused all read as nothing, as the
      // public reader's Single does, so the answer does not tell them apart.
      const document = await (async () => {
        try {
          return await runDetachedFromRequest(() =>
            runAsPrincipal(null, () => findSingle.call(nextly, args))
          );
        } catch (error) {
          if (isMissOrDenied(error)) return null;
          throw error;
        }
      })();
      if (document === null) return null;
      return selectedFrom(document, query.select);
    },
  });
}
