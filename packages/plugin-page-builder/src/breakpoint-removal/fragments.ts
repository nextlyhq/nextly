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
import { desc, eq, lt } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  documentKeyOf,
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
  /** Delete every row kept before `before`. */
  purge(before: Date): Promise<void>;
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
      return rows.map(
        row =>
          ({
            runId: row.runId,
            host: row.host,
            form: row.form,
            fragment: row.fragment,
            keptAt: row.createdAt,
          }) as StoredFragment
      );
    },
    purge: async before => {
      await db
        .delete(breakpointRemovalFragments)
        .where(lt(columns().createdAt, before));
    },
  };
}

/** A host and form as one key: what the step saw is what the writer writes. */
function formKey(host: HostAddress, form: HostForm): string {
  return JSON.stringify([
    host.kind,
    host.slug,
    host.id ?? "",
    host.path,
    host.locale ?? "",
    form,
  ]);
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
