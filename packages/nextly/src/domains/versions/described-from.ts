/**
 * What a description of a document's parts was made from: the version a move of those parts sends
 * so that it is made of what was described, and a mark of each part, to say which one changed.
 *
 * The version decides. A held draft moves the document's own counter whichever language it is
 * in, so the version alone cannot say which part a change was in; the marks can, and are never
 * judged: they are compared by whoever shows the description, between two of them.
 *
 * @module domains/versions/described-from
 * @experimental
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { encodeDocumentVersion } from "./document-revision";
import { SHARED_DRAFT_SLOT } from "./part-drafts";
import { readDocumentRevision, type RevisionReader } from "./stale-version";
import {
  type VersionRef,
  VersionsRepository,
  type WorkingDraftIdentity,
} from "./versions-repository";

/** A document's counters and the drafts it holds, none of their content. */
export interface DocumentStanding {
  /** Its own row's counter. */
  main: number;
  /** Each configured language's, 0 for one with no row; none where it has no languages to move. */
  languages: Readonly<Record<string, number>>;
  drafts: readonly WorkingDraftIdentity[];
}

/**
 * A mark of each part of a description its caller can be shown, opaque: equal in two descriptions
 * where nothing of that part was saved between them. A part is covered by what moves with it
 * alone, so a change to a component or to a live shared field, which moves the document's own
 * counter and no more, is in the version and in no mark. A language the description does not
 * describe is in no mark: its caller may not be allowed to read it, and a mark of it would tell
 * them when it was saved.
 *
 * @experimental
 */
export interface PartMarks {
  /** The languages described. */
  languages: Readonly<Record<string, string>>;
  /** The shared part's held change, which every language shows, described or not. */
  shared: string;
}

/**
 * What a description was made from.
 *
 * @experimental
 */
export interface DescribedFrom {
  /** The version a move of the described parts sends, naming each of their languages. */
  _rev: string;
  marks: PartMarks;
}

/**
 * The document as it stands, for a description read after it: a change made while the parts are
 * described leaves this one older than what is said, so a move made from it is refused rather
 * than made of something else. The drafts first, for the same reason. Undefined when the document
 * is gone.
 */
export async function readDocumentStanding(
  db: RevisionReader & ConstructorParameters<typeof VersionsRepository>[0],
  args: {
    dialect: SupportedDialect;
    ref: VersionRef;
    table: string;
    /** The translation table and every configured language, where each language moves on its own. */
    languages?: { table: string; locales: readonly string[] };
  }
): Promise<DocumentStanding | undefined> {
  const drafts = await new VersionsRepository(db).findWorkingDraftIdentities(
    args.ref
  );
  const state = await readDocumentRevision(db, {
    dialect: args.dialect,
    table: args.table,
    id: args.ref.entryId,
    ...(args.languages ? { languages: args.languages } : {}),
  });
  if (!state) return undefined;
  return {
    main: state.main.counter,
    languages: Object.fromEntries(
      Object.values(state.languages).map(part => [part.part, part.counter])
    ),
    drafts,
  };
}

/** What a description of `parts` was made from, where the document stood as `standing`. */
export function describedFrom(
  standing: DocumentStanding,
  parts: { languages: readonly string[]; shared: boolean }
): DescribedFrom {
  const described = new Set(parts.languages);
  // A document with no languages of its own is one part, whichever language a draft of it was
  // saved in.
  const whole = Object.keys(standing.languages).length === 0;
  // The marked part a draft belongs to, or undefined for a language not described.
  const partOfSlot = (slot: string | null): string | null | undefined => {
    if (whole || slot === SHARED_DRAFT_SLOT) return SHARED_DRAFT_SLOT;
    return described.has(slot) ? slot : undefined;
  };
  const marked = (
    counters: readonly (readonly [string, number])[],
    covers: (slot: string | null) => boolean
  ) =>
    markOf(
      counters,
      standing.drafts.filter(draft => covers(draft.locale))
    );
  const counters = Object.entries(standing.languages);
  const named = counters.filter(([locale]) => described.has(locale));
  return {
    _rev: encodeDocumentVersion(standing.main, Object.fromEntries(named)),
    marks: {
      languages: Object.fromEntries(
        named.map(counter => [
          counter[0],
          marked([counter], slot => partOfSlot(slot) === counter[0]),
        ])
      ),
      shared: marked([], slot => partOfSlot(slot) === SHARED_DRAFT_SLOT),
    },
  };
}

/** One mark of some counters and drafts, the same however they were read. */
function markOf(
  counters: readonly (readonly [string, number])[],
  drafts: readonly WorkingDraftIdentity[]
): string {
  const ordered = [
    ...counters.map(([locale, counter]) => `${locale}:${counter}`),
    ...drafts.map(draft => `${draft.id}:${draft.revision}`),
  ].sort();
  return createHash("sha256")
    .update(ordered.join("\n"))
    .digest("hex")
    .slice(0, 16);
}
