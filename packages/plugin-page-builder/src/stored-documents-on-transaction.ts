/**
 * The stored documents a removal reads under the composition graph lock,
 * read on the removing write's own transaction (`site-style-removal-lock`).
 *
 * The same documents and the same forms the remove routes' rescan reads
 * through the Direct API (`storedDocumentsOf` in `shared-styles-routes`), so
 * the walk over them (`shared-style-rescan`) is one walk: every collection
 * and live Single holding a blocks field the builder opens, each row, and
 * each row in every form it may be stored in, each of the site's languages
 * and the working draft in each.
 *
 * ## How each part is read
 *
 * Every read here is a plain one (`UNLOCKED_READ`): it takes no row lock and
 * waits for none, so the removal, holding the graph lock, never waits for a
 * row a page save holds while that save waits for the graph lock
 * (`composition-graph-lock` says why the order matters).
 *
 * - The rows of a collection, a page at a time in id order: the plugin's own
 *   read of a collection it declared (`listEntriesInTransaction`), or of a
 *   host collection holding a blocks field (`listHostEntriesInTransaction`).
 *   The page's total is a count no reader should trust, so the walk pages
 *   with a limit and stops on a short page.
 * - A row in another language, and a Single in each: the by-id and Single
 *   reads beside them, in that language with its fallback off. A Single
 *   nobody has saved answers the default document its first read would
 *   store, as the rescan reads it.
 * - The working draft of each, in each language: the plugin's stored read of
 *   its own field type (`readStored`, form `draft`), on the transaction,
 *   which answers the pending draft where one is shown, else the live row, by
 *   the rule the preview reads by. A field it cannot read (a blocks field in
 *   a group kept per language) is refused, and the removal with it. A blocks
 *   field inside a repeater's rows has no path that read can name, so its
 *   draft is not read here: the remove routes' rescan before the lock reads
 *   every draft whole (`storedDocumentsOf`), rows included, and the rows'
 *   other forms are read here whole, so only a row draft saved between the
 *   two passes goes unseen.
 *
 * What a plain read sees is the removal's isolation, a Single's write's:
 *
 * - PostgreSQL. READ COMMITTED: each read sees the latest commit.
 * - MySQL. A Single's write keeps REPEATABLE READ, so each read answers from
 *   the transaction's snapshot. A page write that committed after that
 *   snapshot changed a blocks value, so it took the graph lock and wrote the
 *   lock row, and the lock's compare-and-set has refused this removal before
 *   it reads (`holdCompositionGraph`, `isGraphSnapshotRefusal`), a refusal
 *   the remove routes read again and write once more on (`stale-retry`).
 * - SQLite. Every read runs on the one connection, inside the removal's open
 *   transaction, which `BEGIN IMMEDIATE` let in once every other writer had
 *   finished: everything committed is seen.
 *
 * Which collections and Singles hold such a field is handed in, read from
 * the registry on the same transaction by the caller.
 *
 * @module stored-documents-on-transaction
 */
import type {
  PluginCollectionTransaction,
  PluginContext,
  PluginStoredValue,
  PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";

import type { StoredDocumentForm } from "./class-usage-runtime";
import { UNLOCKED_READ } from "./composition-graph-lock";
import { RESCAN_PAGE_SIZE, type StoredDocuments } from "./shared-style-rescan";
import {
  isListedForm,
  rescanSelect,
  storedFormsOn,
} from "./shared-styles-routes";
import type { BuilderDocumentType } from "./site-style-route";

/** The plugin's reads on a transaction, as `ctx.services.ownCollections`. */
export type TransactionReads = Pick<
  PluginContext["services"]["ownCollections"],
  | "listEntriesInTransaction"
  | "listHostEntriesInTransaction"
  | "findEntryByIdInTransaction"
  | "findHostEntryByIdInTransaction"
  | "getSingleInTransaction"
  | "getHostSingleInTransaction"
>;

/** What the documents are read with, on one write's transaction. */
export interface TransactionDocumentSource {
  readonly reads: TransactionReads;
  /** The write's transaction (`InTransactionContext.transaction`). */
  readonly transaction: PluginCollectionTransaction;
  /** A stored blocks value on the transaction (`InTransactionContext.readStored`). */
  readonly readStored: (
    target: PluginStoredValueTarget
  ) => Promise<PluginStoredValue>;
  /** The collections the plugin declared, by their resolved slugs. */
  readonly ownCollections: ReadonlySet<string>;
  /** The Singles the plugin declared, by their resolved slugs. */
  readonly ownSingles: ReadonlySet<string>;
  /** The site's configured languages, by code; empty for none. */
  readonly locales: () => readonly string[];
  /** Every collection holding a blocks field the builder opens. */
  readonly collections: () => Promise<readonly BuilderDocumentType[]>;
  /** Every live Single holding one. */
  readonly singles: () => Promise<readonly BuilderDocumentType[]>;
}

/** How a form's language is asked for: none, or the language, fallback off. */
function localeOf(form: StoredDocumentForm): {
  locale?: string;
  fallbackLocale?: false;
} {
  return form.locale === ""
    ? {}
    : { locale: form.locale, fallbackLocale: false };
}

/**
 * A document's blocks values at `paths`, each read by `read`, put back at
 * their paths, or `undefined` where the document stores none of them in this
 * form.
 */
async function fieldsAt(
  paths: readonly string[],
  read: (path: string) => Promise<PluginStoredValue>
): Promise<Record<string, unknown> | undefined> {
  const row: Record<string, unknown> = {};
  let found = false;
  for (const path of paths) {
    const stored = await read(path);
    if (stored.kind === "absent") continue;
    found = true;
    const keys = path.split(".");
    let at = row;
    for (const key of keys.slice(0, -1)) {
      const next = at[key];
      const nested =
        typeof next === "object" && next !== null
          ? (next as Record<string, unknown>)
          : {};
      at[key] = nested;
      at = nested;
    }
    at[keys[keys.length - 1] ?? path] = stored.value;
  }
  return found ? row : undefined;
}

/** The stored documents, read on the write's transaction (see the module). */
export function storedDocumentsOnTransaction(
  source: TransactionDocumentSource
): StoredDocuments {
  const { reads, transaction: tx } = source;
  // Read per walk, as every reader of the site's languages reads them.
  const forms = () => storedFormsOn(source.locales());
  // The working draft of one field, in the form's language.
  const draftOf =
    (
      form: StoredDocumentForm,
      document: { collection: string; id: string } | { single: string }
    ) =>
    (field: string) =>
      source.readStored({
        ...document,
        field,
        form: "draft",
        ...(form.locale === "" ? {} : { locale: form.locale }),
      });
  return {
    collections: () => source.collections(),
    singles: () => source.singles(),
    rowsAfter: async (type, after) => {
      const list = source.ownCollections.has(type.slug)
        ? reads.listEntriesInTransaction
        : reads.listHostEntriesInTransaction;
      const page = await list(
        tx,
        type.slug,
        {
          // Always the first page of what is left past the cursor.
          ...(after === undefined
            ? {}
            : { where: { id: { greater_than: after } } }),
          select: rescanSelect(type.paths),
          sort: { field: "id", direction: "asc" },
          pagination: { limit: RESCAN_PAGE_SIZE, page: 1 },
          depth: 0,
        },
        UNLOCKED_READ
      );
      // A short page ends the walk: the total beside it is a count, which
      // rows committed meanwhile may already have outgrown.
      return {
        items: page.data,
        hasNext: page.data.length >= RESCAN_PAGE_SIZE,
      };
    },
    rowForms: async (type, id) => {
      const own = source.ownCollections.has(type.slug);
      const found: unknown[] = [];
      // The listed form is the row already in hand, so it is not read again.
      for (const form of forms().filter(entry => !isListedForm(entry))) {
        if (form.variant === "draft") {
          const draft = await fieldsAt(
            // A working draft is read a field at a time, and core reads none
            // inside a repeater's rows (see the module).
            type.fixedPaths,
            draftOf(form, { collection: type.slug, id })
          );
          if (draft !== undefined) found.push(draft);
          continue;
        }
        const read = own
          ? reads.findEntryByIdInTransaction
          : reads.findHostEntryByIdInTransaction;
        found.push(
          await read(tx, type.slug, id, { ...localeOf(form), ...UNLOCKED_READ })
        );
      }
      return found;
    },
    singleForms: async type => {
      const own = source.ownSingles.has(type.slug);
      const found: unknown[] = [];
      for (const form of forms()) {
        if (form.variant === "draft") {
          const draft = await fieldsAt(
            // A working draft is read a field at a time, and core reads none
            // inside a repeater's rows (see the module).
            type.fixedPaths,
            draftOf(form, { single: type.slug })
          );
          if (draft !== undefined) found.push(draft);
          continue;
        }
        const read = own
          ? reads.getSingleInTransaction
          : reads.getHostSingleInTransaction;
        found.push(
          await read(tx, type.slug, { ...localeOf(form), ...UNLOCKED_READ })
        );
      }
      return found;
    },
  };
}
