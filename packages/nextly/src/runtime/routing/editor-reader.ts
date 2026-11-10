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
import type { Nextly } from "../../direct-api/nextly";
import type {
  FindArgs,
  FindByIDArgs,
} from "../../direct-api/types/collections";
import type { UserContext } from "../../direct-api/types/shared";

import { isMissOrDenied } from "./miss-or-denied";
import {
  assertCountKeys,
  assertNotHidden,
  createPublicReader,
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
 * One entry read by its id, as the editor's canvas reads the page's own entry
 * and each entry a binding follows a relation to.
 *
 * @experimental
 */
export interface EditorByIdQuery {
  collection: string;
  id: string | number;
  locale?: string;
  /** The fields to keep, beside the id. Absent, the whole entry. */
  select?: readonly string[];
}

/**
 * What an editor reader reads through: the public reader's source, and core's
 * by-id read where the host has one, which alone returns an entry's pending
 * working draft.
 *
 * @experimental
 */
export type EditorReaderSource = PublicReaderSource &
  Partial<Pick<Nextly, "findByID">>;

/**
 * An editor reader: the public reader's reads, made as the person editing,
 * and one entry by its id with its working draft.
 *
 * @experimental
 */
export interface EditorSourceReader extends PublicSourceReader {
  findById(query: EditorByIdQuery): Promise<PublicSingleResult>;
}

/**
 * Core's by-id arguments for an editor's read of one entry: as the person,
 * every state, and the working draft in place of the live row where one is
 * pending and they may edit it (core decides that, so a person who may only
 * read the entry gets its published values).
 *
 * @experimental
 */
export function toEditorFindById(
  query: EditorByIdQuery,
  person: EditorReaderPerson,
  binding: PublicReaderBinding = {}
): FindByIDArgs {
  if (typeof query.collection !== "string" || query.collection === "") {
    refuse("collection-missing", "A by-id read must name a collection.");
  }
  if (typeof query.id !== "string" && typeof query.id !== "number") {
    refuse("query-invalid", "A by-id read must name an id.");
  }
  const locale = binding.locale ?? query.locale;
  return {
    collection: query.collection,
    id: String(query.id),
    ...(locale === undefined ? {} : { locale }),
    // Only the fields asked for, with the id, so a large field nothing binds
    // is not loaded; the answer is narrowed again to the same fields.
    ...(query.select === undefined || query.select.length === 0
      ? {}
      : {
          select: Object.fromEntries(
            ["id", ...query.select].map(field => [field, true])
          ),
        }),
    // Relationships come back as ids: nothing related is read here.
    depth: 0,
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
  nextly: EditorReaderSource,
  person: EditorReaderPerson,
  binding: PublicReaderBinding = {}
): EditorSourceReader {
  const read = (args: FindArgs) =>
    // `null` is a frame of its own, so it clears a person an enclosing
    // operation was made as rather than inheriting it; the person named in
    // the arguments is the only one who judges the read.
    runDetachedFromRequest(() => runAsPrincipal(null, () => nextly.find(args)));
  const reader: EditorSourceReader = Object.freeze({
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
    async findById(query: EditorByIdQuery): Promise<PublicSingleResult> {
      const findByID = nextly.findByID;
      if (findByID === undefined) {
        // No by-id read: the entry's live row, as a list read finds it.
        const { items } = await reader.find({
          collection: query.collection,
          filters: [{ field: "id", op: "equals", value: query.id }],
          limit: 1,
          ...(query.locale === undefined ? {} : { locale: query.locale }),
          ...(query.select === undefined ? {} : { select: query.select }),
        });
        return items[0] ?? null;
      }
      const args = toEditorFindById(query, person, binding);
      // Missing and refused read as nothing, as a Single's read does, so the
      // answer does not tell them apart.
      try {
        const document = await runDetachedFromRequest(() =>
          runAsPrincipal(null, () => findByID.call(nextly, args))
        );
        return document === null || document === undefined
          ? null
          : selectedFrom(document, query.select);
      } catch (error) {
        if (isMissOrDenied(error)) return null;
        throw error;
      }
    },
  });
  return reader;
}
