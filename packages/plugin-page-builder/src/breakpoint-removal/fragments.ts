/**
 * What a breakpoint removal takes out of the site, kept so it can be put back.
 *
 * Every stored value a removal strips has a row in `breakpoint_removal_fragments`
 * holding what the strip took out of it (`strip`'s `DocumentFragment`), and the
 * shared styles have one for what the set's write took out of them. Each row
 * is written BEFORE the strip it records, since a strip with no row could
 * never be undone, and a row that cannot be written stops the strip. A row
 * whose write then answers that it was not made (a race, a refusal) is
 * deleted again: the value it records may since have been changed by someone
 * else, and putting it back would undo their change. A write whose outcome is
 * unknown (it threw) keeps its row.
 *
 * The removal's walk is generic (`host-rewrite/rewrite`), so this wraps the
 * two places it touches a value: its step, which sees each value and what the
 * strip takes out of it, remembers that per host and form, and its writer,
 * which keeps the remembered row before making the write.
 *
 * @module breakpoint-removal/fragments
 * @experimental
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  lt,
  ne,
  not,
  inArray,
} from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  documentKeyOf,
  formKey,
  type HostAddress,
  type HostForm,
  type StoredForm,
} from "../host-rewrite/contract";
import type { HostWriter } from "../host-rewrite/rewrite";
import { breakpointRemovalFragments } from "../schema/tables";

import type { DocumentFragment, RemovedStyles } from "./strip";

/** How long what a removal took out is kept: the window it can be undone in. */
export const FRAGMENTS_KEPT_DAYS = 30;

/** The `documentKey` the shared styles' fragment is kept under. */
const SITE_STYLE_FRAGMENT_KEY = "site-style";

/**
 * What the set's write took out of the shared styles: per class id, its
 * values under the removed breakpoints, and the code-supplied classes it
 * stored an override of (the code's class without them), which an undo takes
 * out again rather than filling.
 */
export interface ClassesFragment {
  readonly classes: Readonly<Record<string, RemovedStyles>>;
  readonly overridden: readonly string[];
  /**
   * The override each of `overridden` was stored as, by id: an undo takes out
   * a stored entry still equal to it, whatever the code says of that class
   * since. Absent on rows kept before it was recorded, where the code's class
   * as it is now stands in.
   */
  readonly overrides?: Readonly<Record<string, unknown>>;
}

/** One kept row: a stored value's fragment, or the shared styles'. */
export type FragmentRow =
  | {
      readonly runId: string;
      readonly host: HostAddress;
      readonly form: HostForm;
      readonly fragment: DocumentFragment;
    }
  | {
      readonly runId: string;
      readonly host: null;
      readonly form: "site";
      readonly fragment: ClassesFragment;
    };

/** A kept row as read back, with when it was kept. */
export type StoredFragment = FragmentRow & { readonly keptAt: Date };

/** The fragments table, through the plugin's database surface. */
export interface FragmentStore {
  /** Keep one row, answering its id. Throws when it cannot be written. */
  keep(row: FragmentRow): Promise<string>;
  /** Delete one row: its write was not made. */
  discard(id: string): Promise<void>;
  /** Delete a removal's every row: the removal was dropped. */
  forget(runId: string): Promise<void>;
  /** A removal's rows, the newest first. */
  forRun(runId: string): Promise<StoredFragment[]>;
  /**
   * A removal's rows for stored values, a page at a time: at most `limit`,
   * by document key after `after`, each document's rows the newest first.
   * The last document of a full page may be cut short.
   */
  valuesAfter(
    runId: string,
    after: string | null,
    limit: number
  ): Promise<StoredFragment[]>;
  /** A removal's rows for one document, the newest first. */
  forDocument(runId: string, documentKey: string): Promise<StoredFragment[]>;
  /** A removal's row for the shared styles, the newest; `null` for none. */
  sharedStyles(runId: string): Promise<StoredFragment | null>;
  /** Whether a removal kept anything at all. */
  keptAny(runId: string): Promise<boolean>;
  /**
   * Delete every row kept before `before`, except the rows of `keep`: the
   * removals an open undo is still putting back.
   */
  purge(before: Date, keep?: readonly string[]): Promise<void>;
}

/** The fragment store over the plugin's own `ctx.db`. */
export function fragmentStore(
  db: Pick<PluginDatabase, "select" | "table" | "insertReturning" | "delete">
): FragmentStore {
  const columns = () => db.table(breakpointRemovalFragments);
  return {
    keep: async row => {
      const kept = await db.insertReturning(breakpointRemovalFragments, {
        runId: row.runId,
        documentKey:
          row.host === null ? SITE_STYLE_FRAGMENT_KEY : documentKeyOf(row.host),
        host: row.host,
        form: row.form,
        fragment: row.fragment,
      });
      return kept.id;
    },
    discard: async id => {
      await db.delete(breakpointRemovalFragments).where(eq(columns().id, id));
    },
    forget: async runId => {
      await db
        .delete(breakpointRemovalFragments)
        .where(eq(columns().runId, runId));
    },
    forRun: async runId => {
      const t = columns();
      const rows = await db
        .select(breakpointRemovalFragments)
        .where(eq(t.runId, runId))
        // Ids are UUIDv7, so the newest row sorts last by id.
        .orderBy(desc(t.id))
        .all();
      return rows.map(storedOf);
    },
    valuesAfter: async (runId, after, limit) => {
      const t = columns();
      const rows = await db
        .select(breakpointRemovalFragments)
        .where(
          allOf(
            eq(t.runId, runId),
            ne(t.documentKey, SITE_STYLE_FRAGMENT_KEY),
            ...(after === null ? [] : [gt(t.documentKey, after)])
          )
        )
        .orderBy(asc(t.documentKey), desc(t.id))
        .limit(limit)
        .all();
      return rows.map(storedOf);
    },
    forDocument: async (runId, documentKey) => {
      const t = columns();
      const rows = await db
        .select(breakpointRemovalFragments)
        .where(allOf(eq(t.runId, runId), eq(t.documentKey, documentKey)))
        .orderBy(desc(t.id))
        .all();
      return rows.map(storedOf);
    },
    sharedStyles: async runId => {
      const t = columns();
      const row = await db
        .select(breakpointRemovalFragments)
        .where(
          allOf(eq(t.runId, runId), eq(t.documentKey, SITE_STYLE_FRAGMENT_KEY))
        )
        .orderBy(desc(t.id))
        .first();
      return row === null ? null : storedOf(row);
    },
    keptAny: async runId => {
      const t = columns();
      const row = await db
        .select(breakpointRemovalFragments)
        .where(eq(t.runId, runId))
        .limit(1)
        .first();
      return row !== null;
    },
    purge: async (before, keep = []) => {
      const t = columns();
      await db
        .delete(breakpointRemovalFragments)
        .where(
          allOf(
            lt(t.createdAt, before),
            ...(keep.length === 0 ? [] : [not(inArray(t.runId, [...keep]))])
          )
        );
    },
  };
}

/** One condition of a query. */
type Condition = ReturnType<typeof eq>;

/** Every one of `rest` and `first`: never empty, so never nothing. */
function allOf(first: Condition, ...rest: Condition[]): Condition {
  return and(first, ...rest) ?? first;
}

/** A row as read back, in the shape the store answers. */
function storedOf(row: {
  runId: string;
  host: unknown;
  form: string;
  fragment: unknown;
  createdAt: Date;
}): StoredFragment {
  return {
    runId: row.runId,
    host: row.host,
    form: row.form,
    fragment: row.fragment,
    keptAt: row.createdAt,
  } as StoredFragment;
}

/** What the strip refused when it had no fragment to keep for a write. */
const NO_FRAGMENT = "breakpoint-removal-write-without-fragment";

/**
 * The step's and the writer's halves of keeping one removal's fragments as
 * its walk strips the site: `remember`, handed to the strip step, notes what
 * each value it rewrites loses; `writer` keeps that row before each write.
 */
export function fragmentCapture(
  store: Pick<FragmentStore, "keep" | "discard">,
  runId: string
): {
  readonly remember: (form: StoredForm, fragment: DocumentFragment) => void;
  readonly writer: (inner: HostWriter) => HostWriter;
} {
  // The latest fragment the step computed for each host and form: a write
  // retried after a race reads the value again, and the step runs again.
  const remembered = new Map<string, DocumentFragment>();
  return {
    remember: (form, fragment) => {
      remembered.set(formKey(form.host, form.form), fragment);
    },
    writer: inner => async write => {
      const key = formKey(write.host, write.expected.form);
      const fragment = remembered.get(key);
      // A strip with nothing kept for it could never be undone, so it is not
      // made; the walk stops, and the host is walked again later.
      if (fragment === undefined) {
        throw NextlyError.internal({ logContext: { reason: NO_FRAGMENT } });
      }
      const id = await store.keep({
        runId,
        host: write.host,
        form: write.expected.form,
        fragment,
      });
      remembered.delete(key);
      const result = await inner(write);
      // Not made: the row records a strip that did not happen.
      if (result.kind !== "written") await store.discard(id);
      return result;
    },
  };
}
