/**
 * One response per person, after a form changes how it tells people apart.
 *
 * A submission's key is made under the form's one-response version
 * (`one-response`). Saving a form with another mode or another Email field
 * moves the version on (`stampOneResponseVersion`), so every earlier key stops
 * matching new ones at once, with no write to any earlier submission. The
 * earlier submissions are then given keys for the new version by a sweep
 * (`rebuildResponseKeys`): oldest first, each the key of its own answer or
 * address, or none where an earlier one holds that value already, so the
 * earliest of several with one value keeps it. The sweep runs right after the
 * save commits, and the job runner carries on with what it could not finish.
 *
 * Until it has finished, the form records the version its keys are made for
 * (`oneResponseKeyedVersion`) behind the current one, and the submission's
 * hold compares a new submission with the earlier ones' answers themselves
 * (`form-closing-hold`), so no person gets a second response in between.
 *
 * Each key written is checked again where it is stored: the hold refuses a
 * key made for a version the form has since left, so a sweep that started
 * before a second change writes nothing for the old version. Each write also
 * names the revision the sweep read, so a submission edited meanwhile keeps
 * the key its edit gave it.
 *
 * @module handlers/one-response-rebuild
 */
import {
  defineJob,
  type JobDefinition,
  NextlyError,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import type { FormSettings } from "../types";
import { normalizeFormSettings } from "../utils/form-settings";

import { heldRefusal } from "./form-closing-hold";
import {
  keysBehind,
  oneResponseIdentityOf,
  storedRowKeyOf,
} from "./one-response";
import { asPluginSubmission } from "./prepare-submission";

/** The sweep that gives earlier submissions their keys. */
export const REBUILD_KEYS_JOB = "form-builder:one-response-keys";

/** How long a save waits for the sweep after it commits, at most. */
export const REBUILD_ON_SAVE_MS = 5_000;

/**
 * How far past the start of a pass its cutoff lies. MySQL stores a row's
 * `createdAt` to the second, rounded, so a submission stored a moment before
 * the pass can read as up to a second after it; a cutoff at the start would
 * leave it out of every pass and without a key. Rows inside the margin are
 * ones stored after the change, keyed already, so reading them costs a look.
 */
const CUTOFF_MARGIN_MS = 2_000;

function passCutoff(): Date {
  return new Date(Date.now() + CUTOFF_MARGIN_MS);
}

/** Rows read at a time: forms, then one form's submissions. */
const PAGE = 100;

/**
 * The mark on the sweep's own write of a form, saying which version's keys
 * it finished. Only the plugin sets it; `stampOneResponseVersion` takes the
 * finished version from nowhere else.
 */
const FORM_KEYED = Symbol.for("nextly.plugin-form-builder.form-keyed");

interface KeyedFormMark {
  [FORM_KEYED]?: { version: number };
}

/** A form's settings as stored: an object, or a JSON string before a read decodes it. */
function settingsObjectOf(value: unknown): Record<string, unknown> | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  return parsed !== null && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * The version a save leaves the form at, and the version its keys are made
 * for, both decided here from what is stored and never taken from the
 * payload: a caller that could set them could make every earlier response
 * count again, or none.
 *
 * A save that changes the mode or the Email field moves the version on by
 * one. Its keys are up to date at once when the new mode compares nothing
 * an earlier submission stored (several responses allowed, or one per
 * browser, whose earlier tokens were never kept), or when the form has few
 * enough submissions for the save to key them itself (`rebuildInSave`);
 * otherwise they are behind until the sweep has made them.
 */
export async function stampOneResponseVersion(
  context: unknown,
  /** Whether the form's earlier submissions can be keyed inside the save. */
  fitsInSave: (formId: string) => Promise<boolean>
): Promise<void> {
  const ctx = context as {
    operation?: string;
    data?: Record<string, unknown>;
    originalData?: Record<string, unknown>;
  };
  const incoming = settingsObjectOf(ctx.data?.settings);
  if (!ctx.data || incoming === undefined) return;
  const next: Record<string, unknown> = { ...incoming };
  delete next.oneResponseKeyedVersion;
  if (ctx.operation === "create") {
    next.oneResponseVersion = 0;
    ctx.data.settings = next;
    return;
  }
  const stored = normalizeFormSettings(
    settingsObjectOf(ctx.originalData?.settings) ?? {}
  );
  const changed =
    oneResponseIdentityOf(stored) !==
    oneResponseIdentityOf(normalizeFormSettings(incoming));
  const version = (stored.oneResponseVersion ?? 0) + (changed ? 1 : 0);
  next.oneResponseVersion = version;
  // The form's id as stored: a string, or a number on an integer-keyed table.
  const storedId = ctx.originalData?.id;
  const formId =
    typeof storedId === "string" || typeof storedId === "number"
      ? String(storedId)
      : undefined;
  const keyed = keyedVersionAfterSave({
    stored,
    changed,
    version,
    mode: normalizeFormSettings(incoming).oneResponse,
    finished: (ctx.data as KeyedFormMark)[FORM_KEYED]?.version,
    inSave: changed && formId !== undefined && (await fitsInSave(formId)),
  });
  if (keyed !== undefined) next.oneResponseKeyedVersion = keyed;
  ctx.data.settings = next;
}

/** The version a form's keys are made for once a save has been stamped. */
function keyedVersionAfterSave(input: {
  stored: FormSettings;
  changed: boolean;
  version: number;
  mode: FormSettings["oneResponse"];
  finished: number | undefined;
  /** Whether the save itself gives the earlier submissions their keys. */
  inSave: boolean;
}): number | undefined {
  const { stored, changed, version } = input;
  if (changed) {
    const compared = input.mode === "ip" || input.mode === "email";
    return compared && !input.inSave
      ? (stored.oneResponseKeyedVersion ?? stored.oneResponseVersion ?? 0)
      : version;
  }
  // The sweep's own write, for the version still current.
  if (input.finished === version) return version;
  return stored.oneResponseKeyedVersion;
}

/**
 * After a save leaves the form's keys behind (a form too large to key inside
 * the save), start the sweep once the save has committed. Not awaited: the
 * save answers with the form as it committed, and the sweep's own write of
 * the form, when it finishes, comes after. What one run leaves, the job
 * runner finishes.
 */
export async function rebuildAfterSave(
  context: unknown,
  run: () => Promise<unknown>,
  warn: (message: string, context: Record<string, unknown>) => void
): Promise<void> {
  const ctx = context as {
    data?: Record<string, unknown>;
    afterCommit?: (effect: () => unknown) => Promise<void>;
  };
  const settings = normalizeFormSettings(
    settingsObjectOf(ctx.data?.settings) ?? {}
  );
  if (!keysBehind(settings) || !ctx.afterCommit) return;
  await ctx.afterCommit(() => {
    run().catch((error: unknown) =>
      warn("The one-response key sweep failed; the job runner retries it.", {
        error: error instanceof Error ? error.message : String(error),
      })
    );
  });
}

/** The plugin's one-response options, with their defaults. */
export function oneResponseOptions(
  options: { keysInSave?: number } | undefined
): { keysInSave: number } {
  const keysInSave = options?.keysInSave;
  return {
    keysInSave:
      typeof keysInSave === "number" && keysInSave >= 0
        ? Math.floor(keysInSave)
        : KEYS_IN_SAVE,
  };
}

/** Earlier submissions a form may have for the save itself to key them. */
const KEYS_IN_SAVE = 200;

/** What keying inside the save reads and writes with. */
export interface InSaveDeps {
  own: PluginContext["services"]["ownCollections"];
  collections: PluginContext["services"]["collections"];
  digests: () => PluginContext["security"]["digests"];
  submissionsSlug: string;
}

type InTransactionWrite = Parameters<
  Parameters<PluginContext["hooks"]["onInTransaction"]>[1]
>[0];

/**
 * Give a form's earlier submissions keys for its new version inside the
 * save that changed it, when the save decided they fit
 * (`stampOneResponseVersion` recorded the keys as made). Read whole first,
 * then keyed oldest first, the earliest of several with one value keeping it. The save holds the form's
 * row, so no submission to the form is stored meanwhile, and the save
 * answers with every key in place and no later write to the form.
 */
export async function rebuildInSave(
  deps: InSaveDeps,
  write: InTransactionWrite
): Promise<void> {
  if (write.operation !== "update") return;
  const after = normalizeFormSettings(
    settingsObjectOf((write.data as Row | undefined)?.settings) ?? {}
  );
  const before = normalizeFormSettings(
    settingsObjectOf((write.originalData as Row | undefined)?.settings) ?? {}
  );
  const version = after.oneResponseVersion ?? 0;
  if (version === (before.oneResponseVersion ?? 0)) return;
  if (after.oneResponseKeyedVersion !== version) return;
  if (after.oneResponse !== "ip" && after.oneResponse !== "email") return;
  const rows = await snapshotOf(
    async where =>
      (
        await deps.own.listEntriesInTransaction(
          write.transaction,
          deps.submissionsSlug,
          {
            where,
            sort: { field: "id", direction: "asc" },
            pagination: { limit: PAGE },
            depth: 0,
          },
          { lock: "none" }
        )
      ).data,
    { form: { equals: write.id }, status: { not_equals: "spam" } }
  );
  const held = new Set<string>();
  for (const row of rows) {
    await keyInSave(deps, write, after, held, row);
  }
}

/** One row keyed inside the save: its value's key unless held already. */
async function keyInSave(
  deps: InSaveDeps,
  write: InTransactionWrite,
  settings: FormSettings,
  held: Set<string>,
  row: Row
): Promise<void> {
  const own = await storedRowKeyOf(deps.digests, settings, row);
  const target = own === null || held.has(own) ? null : own;
  if (target !== null) held.add(target);
  if ((row.responseKey ?? null) === target) return;
  await deps.collections.updateEntryInTransaction(
    write.transaction,
    deps.submissionsSlug,
    String(row.id),
    asPluginSubmission(
      { responseKey: target, _overwrite: true },
      { keepAsEvidence: false, setKey: target }
    )
  );
}

/** The sweep's job, run by `run` until the deadline the runner gives it. */
export function rebuildKeysJob(
  run: (deadline: Date) => Promise<void>
): JobDefinition {
  return defineJob({
    slug: REBUILD_KEYS_JOB,
    sweep: true,
    handler: async (_input, context) => {
      await run(context.deadline);
    },
  });
}

/** What the sweep reads and writes with. */
export interface RebuildDeps {
  collections: PluginContext["services"]["collections"];
  digests: () => PluginContext["security"]["digests"];
  formsSlug: string;
  submissionsSlug: string;
}

type Row = Record<string, unknown>;

/**
 * Give every form whose keys are behind its earlier submissions' keys, until
 * `deadline`. A form is marked up to date only after a pass over all its
 * submissions in which every one took its key, with none to look at again.
 */
export async function rebuildResponseKeys(
  deps: RebuildDeps,
  deadline: Date
): Promise<void> {
  for (let page = 1; ; page++) {
    const { data } = await deps.collections.listEntries(
      deps.formsSlug,
      { pagination: { limit: PAGE, page }, depth: 0 },
      { as: "system" }
    );
    const forms = data as Row[];
    for (const form of forms) {
      if (pastDeadline(deadline)) return;
      await bringUpToDate(deps, form, deadline);
    }
    if (forms.length < PAGE) return;
  }
}

/** One form: its keys made for its current version, if they are behind. */
async function bringUpToDate(
  deps: RebuildDeps,
  form: Row,
  deadline: Date
): Promise<void> {
  const settings = normalizeFormSettings(settingsObjectOf(form.settings) ?? {});
  if (!keysBehind(settings)) return;
  if ((await rebuildForm(deps, form, settings, deadline)) === "done") {
    await markKeyed(deps, form, settings.oneResponseVersion ?? 0);
  }
}

function pastDeadline(deadline: Date): boolean {
  return Date.now() >= deadline.getTime();
}

/**
 * Passes over one form's submissions until one leaves nothing to look at
 * again: done, or `stop` when the deadline passed or the form's version moved
 * on, which leaves the rest to a later sweep. A sweep that resumes passes
 * quickly over the rows an earlier run keyed: each holds its own key, which
 * is recognised without a query.
 */
async function rebuildForm(
  deps: RebuildDeps,
  form: Row,
  settings: FormSettings,
  deadline: Date
): Promise<"done" | "stop"> {
  // Only one per email and one per network compare what earlier
  // submissions stored.
  if (settings.oneResponse !== "ip" && settings.oneResponse !== "email") {
    return "done";
  }
  for (;;) {
    const pass = await rebuildPass(deps, String(form.id), settings, deadline);
    if (pass !== "again") return pass;
  }
}

/**
 * One pass over a form's non-spam submissions, oldest first. The rows are
 * read first, whole (`snapshotOf`), then keyed in order: a submission deleted
 * or restored while the pass runs cannot move another out of a page it reads.
 * Rows stored after the pass began are left out (`passCutoff`): they were
 * keyed for the current version when they were stored. A row whose write was
 * refused, as edited since or as holding a value taken since, sends the
 * sweep round again.
 */
async function rebuildPass(
  deps: RebuildDeps,
  formId: string,
  settings: FormSettings,
  deadline: Date
): Promise<"done" | "again" | "stop"> {
  const rows = await snapshotOf(
    async where =>
      (
        await deps.collections.listEntries(
          deps.submissionsSlug,
          {
            where,
            sort: { field: "id", direction: "asc" },
            pagination: { limit: PAGE },
            depth: 0,
          },
          { as: "system" }
        )
      ).data,
    {
      form: { equals: formId },
      status: { not_equals: "spam" },
      createdAt: { less_than_equal: passCutoff() },
    }
  );
  let retries = 0;
  for (const row of rows) {
    if (pastDeadline(deadline)) return "stop";
    const outcome = await keyRow(deps, formId, settings, row);
    if (outcome === "stale-form") return "stop";
    if (outcome === "retry") retries += 1;
  }
  return retries === 0 ? "done" : "again";
}

/**
 * Every row `where` matches, oldest first. Read a page at a time by id, each
 * page after the last id read: ids are unique and fixed, so a row deleted or
 * added meanwhile never moves one that is there throughout out of reach, as
 * a page by position would. Then put in the order they were stored.
 */
async function snapshotOf(
  page: (where: Record<string, unknown>) => Promise<Row[]>,
  where: Record<string, unknown>
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let after: string | undefined; ; ) {
    const read = await page(
      after === undefined ? where : { ...where, id: { greater_than: after } }
    );
    rows.push(...read);
    if (read.length < PAGE) break;
    after = String(read[read.length - 1]?.id);
  }
  return rows.sort(storedFirst);
}

/** Older first, by when each was stored; ties by id, the same every time. */
function storedFirst(a: Row, b: Row): number {
  const at = (row: Row) => new Date(row.createdAt as string | Date).getTime();
  return at(a) - at(b) || (String(a.id) < String(b.id) ? -1 : 1);
}

/**
 * Give one submission the key of its answer or address, or none where
 * another submission of the form holds that value already.
 */
async function keyRow(
  deps: RebuildDeps,
  formId: string,
  settings: FormSettings,
  row: Row
): Promise<"unchanged" | "written" | "retry" | "stale-form"> {
  const target = await targetKeyOf(deps, formId, settings, row);
  if (target === undefined) return "unchanged";
  if ((row.responseKey ?? null) === target) return "unchanged";
  return writeKey(deps, row, target);
}

/**
 * The key a row should hold: its own value's, or none (null) where another
 * submission holds that value; undefined when it holds its own already.
 */
async function targetKeyOf(
  deps: RebuildDeps,
  formId: string,
  settings: FormSettings,
  row: Row
): Promise<string | null | undefined> {
  const own = await storedRowKeyOf(deps.digests, settings, row);
  if (own === null) return null;
  // Holding its own value's key already: the holder, with nothing to ask.
  // Most rows of a sweep that resumes are these, so they cost no query.
  if (row.responseKey === own) return undefined;
  return (await heldByAnother(deps, formId, row, own)) ? null : own;
}

/** Write `key` to a row as the plugin's own key write. */
async function writeKey(
  deps: RebuildDeps,
  row: Row,
  key: string | null
): Promise<"written" | "retry" | "stale-form"> {
  try {
    await deps.collections.updateEntry(
      deps.submissionsSlug,
      String(row.id),
      asPluginSubmission(
        // The revision read: a submission edited since keeps its own key.
        { responseKey: key, _rev: row._rev },
        { keepAsEvidence: false, setKey: key }
      ),
      { as: "system" }
    );
  } catch (error) {
    if (heldRefusal(error) === "changed") return "stale-form";
    // Edited since it was read, or its value taken a moment ago: another
    // pass reads it again.
    const code = codeOf(error);
    if (code === "STALE_VERSION" || code === "DUPLICATE") return "retry";
    throw error;
  }
  return "written";
}

function codeOf(error: unknown): unknown {
  return error instanceof NextlyError ? error.code : undefined;
}

/** Whether a submission of the form other than `row` holds `key`. */
async function heldByAnother(
  deps: RebuildDeps,
  formId: string,
  row: Row,
  key: string
): Promise<boolean> {
  return (
    (await deps.collections.count(
      deps.submissionsSlug,
      {
        where: {
          form: { equals: formId },
          responseKey: { equals: key },
          id: { not_equals: String(row.id) },
        },
      },
      { as: "system" }
    )) > 0
  );
}

/**
 * Record that the form's keys are made for `version`, by a write that names
 * the revision the sweep read: a form saved meanwhile is left for the next
 * sweep to judge.
 */
async function markKeyed(
  deps: RebuildDeps,
  form: Row,
  version: number
): Promise<void> {
  const payload: Row & KeyedFormMark = {
    settings: settingsObjectOf(form.settings) ?? {},
    _rev: form._rev,
  };
  Object.defineProperty(payload, FORM_KEYED, {
    value: { version },
    enumerable: true,
    configurable: true,
  });
  try {
    await deps.collections.updateEntry(
      deps.formsSlug,
      String(form.id),
      payload,
      { as: "system" }
    );
  } catch (error) {
    if (codeOf(error) === "STALE_VERSION") return;
    throw error;
  }
}
