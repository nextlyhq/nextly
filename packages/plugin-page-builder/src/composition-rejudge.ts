/**
 * Every write that changes a blocks value is judged again inside its own
 * transaction, after it is stored and while it holds the composition graph
 * lock (`composition-graph-lock`).
 *
 * The blocks field's validation judges a write before the write's transaction
 * opens, against the graph as it then stands. Two writes made at once can each
 * pass against a graph without the other, and together store a component loop
 * or a page composed past the depth limit. Here, in core's in-transaction
 * phase, the write locks the graph and its stored value is judged against
 * every definition as last committed: a second writer waits at the lock until
 * the first commits, and then judges against what the first stored. A write
 * this refuses is rolled back whole.
 *
 * Only what depends on other documents is judged again: loops, the composed
 * nesting, depth and slot locks of the document, and for a component the
 * documents placing it (`compositionGraphIssues`). Everything else was judged by the validation
 * already, and nothing another write commits can change it.
 *
 * The lock is taken only by a write whose blocks value or status changed, so a
 * write to a collection holding no blocks field, or one leaving its blocks
 * alone, never waits on it. Collections and Singles alike.
 *
 * Blocks values inside a repeater's rows or a field-group instance are not
 * judged here: they are left to validation.
 *
 * ## The variables and shared styles a write adds
 *
 * The same holds for a reference to a variable or a shared style. The
 * validation refuses a reference the write ADDS to one the site does not
 * define, but judges it before the transaction, so a removal committing in
 * between would leave the page holding a first use of something gone. Under
 * the lock the references the write adds are judged again, against the site's
 * definitions read then, on the write's own transaction. A removal takes the
 * same lock in the site style's
 * own write (`site-style-removal-lock`), so the two are judged one after the
 * other: a removal that held the lock first committed before this write got
 * it, and is seen; one that comes after waits, then finds this page.
 *
 * @module composition-rejudge
 */
import { isPlainRecord, type BlockDocument } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type InTransactionContext,
  type PluginContext,
  type PluginFieldIssue,
  type PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import { indexHostFinder } from "./component-hosts";
import { componentUsageIndex } from "./component-usage";
import { holdCompositionGraph } from "./composition-graph-lock";
import type { JudgedField, StoredForms } from "./fields/added-undefined-ids";
import {
  compositionGraphIssues,
  type CompositionSetup,
  type HostFinder,
  type SiteDefinitions,
} from "./fields/blocks-composition";
import { isForest } from "./fields/blocks-document";
import { BLOCKS_TYPE, onceAsked } from "./fields/blocksField";
import { newClassReferenceIssues } from "./fields/class-reference-judgement";
import { readStoredForms } from "./fields/lock-baselines";
import { newTokenReferenceIssues } from "./fields/token-reference-judgement";
import { readStoredJson, sameStoredValue } from "./stored-json";
import { usageTableOf, usageTableRows } from "./usage-index-tables";
import { readWithinOrRefuse, type UnreadReason } from "./within-time";

/**
 * How long a write waits for the site's definitions under the lock before it
 * is refused. One read of one document: past this, the read is waiting for a
 * connection rather than for the database.
 */
export const SITE_DEFINITIONS_READ_MS = 5_000;

/**
 * What a write is told when the site's definitions could not be read under
 * the lock: refused, to save again, rather than let through unjudged.
 */
export const SITE_STYLES_CHANGED =
  "Site styles changed while saving. Try again.";

/** One refusal the judgement makes, as validation reports it. */
type Issue = { path: string; code: string; message: string };

/** How a Single's writes are named to the in-transaction phase. */
const SINGLE_PREFIX = "single:";

/**
 * Judge every write that changes a blocks value again in its transaction,
 * under the graph lock. `setup` is read per write: it exists once the plugin is
 * installed. `locales` are the site's configured languages, by code (empty
 * for none), read per write as every reader of them reads them: the live
 * forms a held working draft keeps a reference by are read in each
 * (`formsBeforeWrite`).
 */
export function registerCompositionRejudge(
  ctx: Pick<PluginContext, "hooks" | "dialect">,
  setup: () => CompositionSetup | undefined,
  locales: () => readonly string[]
): void {
  ctx.hooks.onInTransaction("*", async write => {
    const judging = setup();
    if (judging === undefined) return;
    const issues = await rejudgedIssues(write, judging, ctx.dialect, locales);
    if (issues.length > 0) throw NextlyError.validation({ errors: issues });
  });
}

/** The issues one stored write raises, judged under the lock. */
async function rejudgedIssues(
  write: InTransactionContext,
  setup: CompositionSetup,
  dialect: PluginContext["dialect"],
  locales: () => readonly string[]
): Promise<Issue[]> {
  if (write.operation === "delete" || write.data === undefined) return [];
  const data = write.data;
  const original = write.originalData;
  const statusChanged = !sameStoredValue(data.status, original?.status);
  // Every blocks field the collection declares, from its schema: a value
  // shaped like a document in another field is no blocks value.
  const changed = (await write.fieldPaths(BLOCKS_TYPE)).filter(
    path =>
      statusChanged ||
      !sameStoredValue(valueAt(data, path), valueAt(original, path))
  );
  if (changed.length === 0) return [];

  const single = write.collection.startsWith(SINGLE_PREFIX);
  const fieldWrite: PluginFieldWrite = single
    ? {
        kind: "single",
        slug: write.collection.slice(SINGLE_PREFIX.length),
        inTransaction: true,
        readStored: target => write.readStored(BLOCKS_TYPE, target),
      }
    : {
        kind: "collection",
        slug: write.collection,
        id: write.id,
        inTransaction: true,
        readStored: target => write.readStored(BLOCKS_TYPE, target),
      };

  await holdCompositionGraph(write.db, dialect);
  const judging: CompositionSetup = {
    ...setup,
    hostsOf: hostsOnTransaction(write),
    hostsInTransaction: true,
    // Said by the validation already, which judged every host it could not
    // vouch for before the transaction opened.
    onUnjudged: undefined,
    // Lists are judged by their shape here: their schema is read on another
    // connection, and nothing another write commits changes it.
    listFields: undefined,
  };
  // A held working draft is the only form the write changed.
  const nextStatus =
    data._isWorkingDraft === true || typeof data.status !== "string"
      ? undefined
      : data.status;
  const issues: Issue[] = [];
  for (const path of changed) {
    issues.push(
      ...(await compositionGraphIssues(
        readStoredJson(valueAt(data, path)),
        {
          write: fieldWrite,
          path,
          nextStatus,
          before: readStoredJson(valueAt(original, path)),
        },
        judging
      ))
    );
  }
  // Under the lock too, and only now: the site's definitions are never read
  // in this path before the lock is held.
  issues.push(
    ...(await addedReferenceIssues(write, fieldWrite, changed, setup, locales))
  );
  return issues;
}

/**
 * The variables and shared styles the write's blocks values ADD that the site
 * does not define, judged as the validation judges them (the same checks,
 * codes and words), against the site's definitions read now, under the lock.
 * A reference the stored forms already held is kept, so a page holding one
 * to something the site has since dropped stays savable.
 *
 * Costs nothing for a write naming no variable and no class: the definitions
 * are read only once a value names one, and the stored forms only once one of
 * those is undefined. One read of each serves every field and both checks.
 *
 * A field's label is not part of what this phase is handed, so a refusal
 * names the field by its path, as the validation does for a field without
 * one.
 */
async function addedReferenceIssues(
  write: InTransactionContext,
  fieldWrite: PluginFieldWrite,
  paths: readonly string[],
  setup: CompositionSetup,
  locales: () => readonly string[]
): Promise<Issue[]> {
  const read = setup.siteDefinitions;
  // Where the site's definitions cannot be read at all, the validation judges
  // no reference either.
  if (read === undefined) return [];
  const definitions = onceAsked(() =>
    definitionsUnderLock(() => read(write.transaction))
  );
  // As the checks answer them; each names its field and code, normalized below.
  const issues: PluginFieldIssue[] = [];
  for (const path of paths) {
    const value = readStoredJson(valueAt(write.data, path));
    const field: JudgedField = { path, write: fieldWrite };
    const storedForms = onceAsked(() =>
      formsBeforeWrite(write, fieldWrite, path, locales())
    );
    const site = { limits: setup.limits, storedForms };
    issues.push(
      ...(await newClassReferenceIssues(value, field, path, {
        ...site,
        classIds: async () => (await definitions()).classIds,
      })),
      ...(await newTokenReferenceIssues(value, field, path, {
        ...site,
        tokenIds: async () => (await definitions()).tokenIds,
      }))
    );
  }
  return issues.map(issue => ({
    path: issue.path ?? "",
    code: issue.code ?? "CUSTOM",
    message: issue.message,
  }));
}

/**
 * The site's definitions, read once the lock is held, bounded in time, and
 * refused with {@link SITE_STYLES_CHANGED} when they cannot be read: a read
 * that fails or does not answer never lets the write through and never holds
 * it open.
 *
 * Read on the write's own transaction: the Site Style Single as stored, by
 * the plugin's own read of a Single it declared (`getSingleInTransaction`),
 * resolved over the code's defaults by the same reading the validation uses
 * (`site-definitions`). On the transaction's connection, so on a pool of one
 * connection the read takes none of its own while the write holds the only
 * one.
 *
 * A plain read, taking no row lock (`UNLOCKED_READ`). A removal holds the
 * Single's row, from its UPDATE, before it asks for the graph lock; this
 * write holds the graph lock, so a row-locking read of the Single here would
 * wait for the removal's row while the removal waits for the graph lock, and
 * the two would wait on each other until the database refused one. What the
 * plain read sees is this write's isolation. Per dialect:
 *
 * - PostgreSQL. READ COMMITTED: the read sees the latest commit and waits on
 *   no row lock. A removal that held the graph lock before this write
 *   committed before the lock was granted, so what it removed is gone here;
 *   one that comes after waits at the lock, and then finds this page.
 * - MySQL. A collection's write opens at READ COMMITTED, so its read is as
 *   fresh as PostgreSQL's. A Single's write keeps REPEATABLE READ, so its
 *   read answers from the transaction's snapshot: a removal that committed
 *   after that snapshot took the graph lock and wrote the lock row, and the
 *   lock's compare-and-set has refused this write, to save again, before the
 *   read is made (`holdCompositionGraph`).
 * - SQLite. One connection, on which the read runs inside this write's open
 *   transaction. It sees everything committed before the transaction began,
 *   which `BEGIN IMMEDIATE` lets in only once every other writer has
 *   finished, and this write's own: so a removal is either committed and
 *   seen, or still waiting behind this write.
 *
 * Bounded all the same: a read that does not answer is refused rather than
 * left holding every write waiting at the lock.
 */
function definitionsUnderLock(
  read: () => Promise<SiteDefinitions>
): Promise<SiteDefinitions> {
  return readWithinOrRefuse(read, SITE_DEFINITIONS_READ_MS, siteStylesChanged);
}

/** The retryable refusal of a write whose definitions could not be read. */
function siteStylesChanged(why: UnreadReason, error?: unknown): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: SITE_STYLES_CHANGED,
    ...(error instanceof Error ? { cause: error } : {}),
    logContext: { cause: `site-definitions-read-${why}` },
  });
}

/**
 * The field's stored forms as they stood before this write: what a reference
 * the write keeps is judged against, as the validation judged it against both
 * stored forms before the transaction opened.
 *
 * Inside the transaction `readStored` answers this write's own stored value
 * for every form the write wrote, and judged against that every reference
 * would read as held. So a form the write wrote is taken from `originalData`,
 * the document the write replaced: the prior working draft where the edit
 * accumulated onto one, else the stored document. Only a form the write did
 * not write is read on the transaction, which for a held working draft is the
 * live one: such a write stores the draft alone. Any other write wrote the
 * live row, a publish consuming the draft into it, so `originalData` is the
 * one form before it; a reference only the live form held while a pending
 * draft had dropped it then reads as added, which refuses more, never less.
 * A create replaced nothing.
 *
 * The live form is read in every one of the site's languages, as well as in
 * the default one a target naming none reads: this phase is told neither the
 * write's language nor whether the field is kept per language, and a draft
 * written in one language, judged against another's live form alone, would
 * read a reference its own live form holds as added and refuse a valid save.
 * A field not kept per language has one value, which each language reads.
 *
 * Counting a reference any language's live form holds as held never lets a
 * first use through. The removal's walk under the same lock reads every
 * stored form in every language (`stored-documents-on-transaction`), so a
 * reference held in any of them is a use the removal already sees, and is
 * refused for: a removal committed before this write took the lock found it
 * and was refused; one coming after waits, then finds it. So reading more
 * languages can only keep a save that holds the reference already, never
 * keep one bringing it for the first time.
 */
async function formsBeforeWrite(
  write: InTransactionContext,
  fieldWrite: PluginFieldWrite,
  path: string,
  locales: readonly string[]
): Promise<StoredForms> {
  if (write.operation === "create" || write.originalData === undefined) {
    return { forms: [], readable: true };
  }
  const replaced = readStoredJson(valueAt(write.originalData, path));
  const forms: BlockDocument[] = isForest(replaced)
    ? [replaced as BlockDocument]
    : [];
  if (write.data?._isWorkingDraft !== true) return { forms, readable: true };
  const live = await liveFormsInEveryLocale(fieldWrite, path, locales);
  return { forms: [...forms, ...live.forms], readable: live.readable };
}

/**
 * The field's live form in the default language, then in each of `locales`.
 * The default language's read is the one it always was: a failure there
 * fails the write. A language whose store is not ready yet holds no form
 * this can read, and is left out, which only reads fewer references as held
 * and refuses more, never less; its unreadable answer is never the whole
 * answer, which would judge no reference at all.
 */
async function liveFormsInEveryLocale(
  fieldWrite: PluginFieldWrite,
  path: string,
  locales: readonly string[]
): Promise<StoredForms> {
  const base = await readStoredForms(fieldWrite, path, [false]);
  const forms = [...base.forms];
  for (const locale of locales) {
    const read = await readStoredForms(
      { ...fieldWrite, locale },
      path,
      [false],
      true
    );
    if (read.readable) forms.push(...read.forms);
  }
  return { forms, readable: base.readable };
}

/** The value at a dotted path, or undefined where the path holds none. */
function valueAt(
  data: Record<string, unknown> | undefined,
  path: string
): unknown {
  let at: unknown = data;
  for (const segment of path.split(".")) {
    const record = readStoredJson(at);
    if (!isPlainRecord(record)) return undefined;
    at = record[segment];
  }
  return at;
}

/**
 * The documents placing a component, as the usage index lists them, read on
 * the write's own transaction. Whether the index lists every document was the
 * validation's to warn about; under the lock only what it lists is judged.
 */
function hostsOnTransaction(write: InTransactionContext): HostFinder {
  const listed = indexHostFinder({
    rows: () => usageTableRows(write.db, usageTableOf(componentUsageIndex)),
    health: () =>
      Promise.reject(
        NextlyError.internal({
          logContext: { reason: "usage-health-read-under-graph-lock" },
        })
      ),
  });
  return {
    whole: () => Promise.resolve(true),
    placing: ids => listed.placing(ids),
  };
}
