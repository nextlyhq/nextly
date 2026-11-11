/**
 * A form's closing time and limit, held where a submission is stored: inside
 * the submission's own write transaction, whatever wrote it (the public route,
 * `submitForm` called from another plugin, `nextly.forms.submit()` or the
 * admin). So no way of storing a submission can outlive the form's closing.
 *
 * Past the closing time, every new submission is refused, spam included.
 *
 * Two submissions for a form's last place must not both be stored. Checking a
 * count before the write lets both read "one place left", so the check runs
 * after the submission's row is inserted, in the same transaction, under the
 * form's row locked for update: a second submission to the same form waits
 * there until the first has committed or rolled back, then counts again, its
 * own row and the first's both included, and is refused if they are more
 * than the limit. The refusal rolls the whole write back, so nothing is kept.
 *
 * Per dialect:
 *
 * - PostgreSQL and MySQL. A write that opens its own transaction and runs
 *   in-transaction handlers reads committed, so the count after the lock sees
 *   what the submission before it committed. The count takes no lock of its
 *   own: a locking read would wait on another submission's uncommitted row
 *   while that submission waits for this one's lock. The submission's `form`
 *   column is a plain column with no database foreign key, so its insert holds
 *   no lock on the form's row, and two submissions waiting on each other's
 *   insert cannot arise.
 * - SQLite. One writer at a time already, so the count sees every commit.
 *
 * One limit to this: a submission created inside a transaction its caller
 * opened (`withTransaction` with `createEntryInTransaction`) reads at that
 * transaction's isolation. On MySQL that is REPEATABLE READ, where the count
 * answers from the transaction's first read, so two such transactions racing
 * for the last place can both be stored. Every way of submitting this plugin
 * and core offer opens its own transaction.
 *
 * Spam does not count, and a submission stored as spam takes no place.
 * Marking a submission spam or not spam, deleting submissions and the
 * retention pass change the count by changing the rows it reads: there is no
 * counter to keep in step. Only a new submission is judged: marking a stored
 * one "not spam" restores a place it was entitled to when it arrived.
 *
 * @module handlers/form-closing-hold
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { closedMessageOf, pastClosingTime } from "../utils/form-closing";
import { normalizeFormSettings } from "../utils/form-settings";

import {
  ALREADY_RESPONDED,
  holdsKeyFor,
  type KeyedSubmission,
  keysBehind,
  keyVersionOf,
  responseKeyOf,
} from "./one-response";
import { asPluginSubmission } from "./prepare-submission";

/** The mark on a refusal for a closed form, for the caller to recognise it. */
const FORM_CLOSED = "form-builder:form-closed";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];
type OwnCollections = PluginContext["services"]["ownCollections"];
type Digests = PluginContext["security"]["digests"];

/** What the hold reads with. */
interface HoldDeps {
  own: OwnCollections;
  digests: Digests;
  collections: PluginContext["services"]["collections"];
}

/** The mark on a refusal for a setting changed while the write was in flight. */
const SETTINGS_CHANGED_MARK = "form-builder:settings-changed";

/** The mark on a refusal for a person who has responded already. */
const RESPONDED_MARK = "form-builder:responded";

/** Rows read at a time when earlier submissions are compared one by one. */
const COMPARE_PAGE = 200;

/** What a submission refused for a setting changed in flight is told. */
export const SETTINGS_CHANGED =
  "This form's settings changed while your response was being sent. Please send it again.";

export interface FormLimitSlugs {
  forms: string;
  submissions: string;
}

/** The id a submission's `form` names, as an id or a populated document. */
function formIdOf(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "id" in value) {
    return formIdOf(value.id);
  }
  return undefined;
}

/** The form a new submission is made to, and whether it takes a place. */
function newSubmission(
  write: InTransactionContext
): { formId: string; takesAPlace: boolean } | undefined {
  if (write.operation !== "create") return undefined;
  const data = write.data as { form?: unknown; status?: unknown } | undefined;
  const formId = formIdOf(data?.form);
  return formId === undefined
    ? undefined
    : { formId, takesAPlace: data?.status !== "spam" };
}

/** The refusal a submission to a closed form gets, and rolls back with. */
function closedRefusal(
  form: Record<string, unknown>,
  logContext: Record<string, unknown>
) {
  return NextlyError.conflict({
    reason: "state",
    message: closedMessageOf(form),
    logContext: { cause: FORM_CLOSED, ...logContext },
  });
}

/** The form, as stored, with its settings read. */
async function formOf(
  own: OwnCollections,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  formId: string,
  lock: "none" | "update"
): Promise<{
  form: Record<string, unknown>;
  settings: ReturnType<typeof normalizeFormSettings>;
}> {
  const form = (await own.findEntryByIdInTransaction(
    write.transaction,
    slugs.forms,
    formId,
    { lock }
  )) as unknown as Record<string, unknown>;
  return { form, settings: normalizeFormSettings(form.settings) };
}

/**
 * Refuse a new submission to a form past its closing time, or one that would
 * take it past its limit. A form with neither is read once, unlocked, and
 * left alone.
 */
async function holdFormClosing(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs
): Promise<void> {
  const submission = newSubmission(write);
  if (submission === undefined) return;
  const { formId } = submission;
  const stored = await formOf(deps.own, write, slugs, formId, "none");
  if (pastClosingTime(stored.settings, new Date())) {
    throw closedRefusal(stored.form, { formId, closedBy: "date" });
  }
  const limited =
    submission.takesAPlace && stored.settings.submissionLimit !== undefined;
  if (!limited && !keyInPlay(stored.settings, write.data)) return;
  // Turns, one form at a time: the next submission to this form, and a
  // change to its settings, wait here. Read again under the lock.
  const locked = await formOf(deps.own, write, slugs, formId, "update");
  if (submission.takesAPlace) {
    await holdLimit(deps.own, write, slugs, formId, locked);
  }
  await holdResponseKey(deps, write, slugs, formId, locked.settings);
}

/** Refuse a submission that takes the form past its limit, under the lock. */
async function holdLimit(
  own: OwnCollections,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  formId: string,
  { form, settings }: Awaited<ReturnType<typeof formOf>>
): Promise<void> {
  const limit = settings.submissionLimit;
  if (limit === undefined) return;
  const { pagination } = await own.listEntriesInTransaction(
    write.transaction,
    slugs.submissions,
    {
      where: { form: { equals: formId }, status: { not_equals: "spam" } },
      pagination: { limit: 1 },
    },
    { lock: "none" }
  );
  if (pagination.total > limit) {
    throw closedRefusal(form, { formId, closedBy: "limit", limit });
  }
}

/**
 * Whether one response per person bears on this submission: the form
 * compares responses, or the submission was given a key under a setting the
 * form may since have left.
 */
function keyInPlay(settings: { oneResponse?: string }, row: unknown): boolean {
  const key = (row as { responseKey?: unknown } | undefined)?.responseKey;
  return (settings.oneResponse ?? "off") !== "off" || (key ?? null) !== null;
}

/**
 * Refuse a submission whose one-response key is not the one the form's
 * setting, as stored now, gives it. The key was made before the write, from
 * the settings read then; a change of mode or Email field committed since
 * would leave a key no longer compared by anything, or none where one is
 * owed. The visitor sends it again, under the setting that applies.
 */
async function holdResponseKey(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  formId: string,
  settings: Awaited<ReturnType<typeof formOf>>["settings"]
): Promise<void> {
  const row = write.data as KeyedSubmission & { responseKey?: unknown };
  if (!(await holdsKeyFor(() => deps.digests, settings, row))) {
    throw changedRefusal(formId);
  }
  if (row.responseKey === null || row.responseKey === undefined) return;
  await refuseEarlierResponse(deps, write, slugs, formId, settings);
}

/** The refusal for a key made under a setting the form has since left. */
function changedRefusal(formId: string) {
  return NextlyError.conflict({
    reason: "state",
    message: SETTINGS_CHANGED,
    logContext: { cause: SETTINGS_CHANGED_MARK, formId },
  });
}

/**
 * Refuse a keyed submission when an earlier one holds its value without the
 * key that would show it.
 *
 * One per network compares the stored address itself, every time: a form
 * that took one response per network before keys were stored has earlier
 * submissions with an address and no key. One per email compares the earlier
 * answers while the form's keys are still being made for its current version
 * (`keysBehind`), after a change of mode or Email field. Both run under the
 * form's lock, so a submission stored meanwhile is counted.
 */
async function refuseEarlierResponse(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  formId: string,
  settings: Awaited<ReturnType<typeof formOf>>["settings"]
): Promise<void> {
  const row = write.data as KeyedSubmission & { responseKey?: unknown };
  const earlier = {
    form: { equals: formId },
    status: { not_equals: "spam" },
    id: { not_equals: write.id },
  };
  const read = (where: Record<string, unknown>, limit: number, page = 1) =>
    deps.own.listEntriesInTransaction(
      write.transaction,
      slugs.submissions,
      { where, pagination: { limit, page }, depth: 0 },
      { lock: "none" }
    );
  if (settings.oneResponse === "ip" && typeof row.ipAddress === "string") {
    const { pagination } = await read(
      { ...earlier, ipAddress: { equals: row.ipAddress } },
      1
    );
    if (pagination.total > 0) throw respondedRefusal(formId);
    return;
  }
  if (settings.oneResponse === "email" && keysBehind(settings)) {
    await refuseEarlierEmail(deps, formId, settings, row.responseKey, page =>
      read(earlier, COMPARE_PAGE, page)
    );
  }
}

/**
 * Compare a new submission's key with the key each earlier submission's
 * answer would have, a page at a time.
 */
async function refuseEarlierEmail(
  deps: HoldDeps,
  formId: string,
  settings: Awaited<ReturnType<typeof formOf>>["settings"],
  key: unknown,
  page: (n: number) => Promise<{ data: unknown[] }>
): Promise<void> {
  for (let n = 1; ; n++) {
    const { data } = await page(n);
    for (const other of data as KeyedSubmission[]) {
      if ((await responseKeyOf(() => deps.digests, settings, other)) === key) {
        throw respondedRefusal(formId);
      }
    }
    if (data.length < COMPARE_PAGE) return;
  }
}

/** The refusal for a person who has responded to the form already. */
function respondedRefusal(formId: string) {
  return NextlyError.conflict({
    reason: "state",
    message: ALREADY_RESPONDED,
    logContext: { cause: RESPONDED_MARK, formId },
  });
}

/**
 * Refuse a key written to a stored submission (an edit that moves its key,
 * or the plugin giving it one) when the key was made for a version the form
 * has left: the form's mode or Email field changed after it was made. The
 * form's lock orders it after the change, so the version it reads is the one
 * committed.
 */
async function holdKeyWrite(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs
): Promise<void> {
  const changed = changedKeyOf(write);
  if (changed === undefined) return;
  const { key, formId } = changed;
  const { settings } = await formOf(deps.own, write, slugs, formId, "update");
  if (keyVersionOf(key) !== (settings.oneResponseVersion ?? 0)) {
    throw changedRefusal(formId);
  }
  // An edit that gives the submission another answer, address or form: while
  // earlier submissions are still without keys for this version, the index
  // cannot see theirs, so their answers are compared as a new submission's
  // are. A key change with the same value is not compared: the plugin's own
  // key write walks the form oldest first, so an earlier holder has its key
  // already, and a submission restored from spam takes its key back only
  // where no other submission holds it (`responseKeyAfterUpdate`).
  if (sameValue(write)) return;
  await refuseEarlierResponse(deps, write, slugs, formId, settings);
}

/**
 * The key an update gave a stored submission, and its form, when the update
 * changed the key to one: undefined for a create, a key cleared or kept.
 */
function changedKeyOf(
  write: InTransactionContext
): { key: string; formId: string } | undefined {
  if (write.operation !== "update") return undefined;
  const after = write.data as { responseKey?: unknown; form?: unknown };
  const before = write.originalData as { responseKey?: unknown } | undefined;
  const key = after?.responseKey;
  if (typeof key !== "string" || key === before?.responseKey) return undefined;
  const formId = formIdOf(after.form);
  return formId === undefined ? undefined : { key, formId };
}

/**
 * Whether an update left a submission's answers, address and form as they
 * were. A submission moved to another form joins that form's responses, so a
 * move is compared as an edit is.
 */
function sameValue(write: InTransactionContext): boolean {
  const after = write.data as Record<string, unknown> | undefined;
  const before = write.originalData as Record<string, unknown> | undefined;
  const same = (field: string) =>
    JSON.stringify(after?.[field] ?? null) ===
    JSON.stringify(before?.[field] ?? null);
  return (
    same("data") &&
    same("ipAddress") &&
    formIdOf(after?.form) === formIdOf(before?.form)
  );
}

/**
 * When the submission holding a one-response key stops holding it (deleted,
 * marked spam, or edited or moved to another value), the earliest other
 * non-spam submission of the form with the same value takes the key, in the
 * same transaction. Without it, a keyless duplicate (one stored before the
 * form compared that value, or kept as evidence and restored) would leave
 * the value free, and a person who had responded could respond again.
 *
 * Under the form's lock, so a new submission with that value waits and then
 * meets the key. A key made for a version the form has left is not handed
 * on: nothing compares it. One per browser hands nothing on, since no
 * earlier submission kept its browser's token.
 */
async function handOffKey(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs
): Promise<void> {
  const released = releasedKeyOf(write);
  if (released === undefined) return;
  const { key, formId, ipAddress } = released;
  const { settings } = await formOf(deps.own, write, slugs, formId, "update");
  if (keyVersionOf(key) !== (settings.oneResponseVersion ?? 0)) return;
  const next = await nextHolderOf(deps, write, slugs, {
    formId,
    settings,
    key,
    ipAddress,
  });
  if (next === undefined) return;
  await deps.collections.updateEntryInTransaction(
    write.transaction,
    slugs.submissions,
    next,
    asPluginSubmission(
      { responseKey: key, _overwrite: true },
      { keepAsEvidence: false, setKey: key }
    )
  );
}

/**
 * The key a write took from the submission that held it, with that
 * submission's form and address as they were: undefined when it still holds
 * it, or held none.
 */
function releasedKeyOf(
  write: InTransactionContext
): { key: string; formId: string; ipAddress: unknown } | undefined {
  const before = heldBefore(write);
  const key = before?.responseKey;
  if (typeof key !== "string" || stillHeld(write, key)) return undefined;
  const formId = formIdOf(before?.form);
  return formId === undefined
    ? undefined
    : { key, formId, ipAddress: before?.ipAddress };
}

/**
 * The submission as it was before a write: a delete describes it as it was,
 * an update by its original; a create had none.
 */
function heldBefore(
  write: InTransactionContext
): { responseKey?: unknown; form?: unknown; ipAddress?: unknown } | undefined {
  if (write.operation === "create") return undefined;
  return (write.operation === "delete" ? write.data : write.originalData) as
    | { responseKey?: unknown; form?: unknown; ipAddress?: unknown }
    | undefined;
}

/** Whether an update left the submission holding `key`. */
function stillHeld(write: InTransactionContext, key: string): boolean {
  const after = write.data as { responseKey?: unknown } | undefined;
  return write.operation === "update" && after?.responseKey === key;
}

/**
 * The earliest non-spam submission of the form, other than the one writing,
 * that holds no key and whose value gives `key`. One per network reads only
 * the submissions from the same address; one per email reads the keyless
 * ones a page at a time.
 */
async function nextHolderOf(
  deps: HoldDeps,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  wanted: {
    formId: string;
    settings: Awaited<ReturnType<typeof formOf>>["settings"];
    key: string;
    ipAddress: unknown;
  }
): Promise<string | undefined> {
  const { settings } = wanted;
  if (settings.oneResponse !== "ip" && settings.oneResponse !== "email") {
    return undefined;
  }
  const where: Record<string, unknown> = {
    form: { equals: wanted.formId },
    status: { not_equals: "spam" },
    id: { not_equals: write.id },
    responseKey: { exists: false },
  };
  if (settings.oneResponse === "ip") {
    if (typeof wanted.ipAddress !== "string") return undefined;
    where.ipAddress = { equals: wanted.ipAddress };
  }
  for (let page = 1; ; page++) {
    const { data } = await deps.own.listEntriesInTransaction(
      write.transaction,
      slugs.submissions,
      {
        where,
        sort: { field: "createdAt", direction: "asc" },
        pagination: { limit: COMPARE_PAGE, page },
        depth: 0,
      },
      { lock: "none" }
    );
    for (const row of data as (KeyedSubmission & { id?: unknown })[]) {
      const key = await responseKeyOf(() => deps.digests, settings, row);
      if (key === wanted.key) return String(row.id);
    }
    if (data.length < COMPARE_PAGE) return undefined;
  }
}

/** Hold every form's closing on the submissions this plugin stores. */
export function registerFormClosing(
  ctx: Pick<PluginContext, "hooks" | "services" | "security">,
  slugs: FormLimitSlugs
): void {
  const deps: HoldDeps = {
    own: ctx.services.ownCollections,
    digests: ctx.security.digests,
    collections: ctx.services.collections,
  };
  ctx.hooks.onInTransaction(slugs.submissions, async write => {
    await holdFormClosing(deps, write, slugs);
    await holdKeyWrite(deps, write, slugs);
    await handOffKey(deps, write, slugs);
  });
}

/**
 * Which of the hold's refusals `error` is, or one it was made from: a closed
 * form's, a setting changed while the submission was in flight, or a person
 * who has responded already.
 */
export function heldRefusal(
  error: unknown
): "closed" | "changed" | "responded" | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (current instanceof NextlyError) {
      const cause = current.logContext?.cause;
      if (cause === FORM_CLOSED) return "closed";
      if (cause === SETTINGS_CHANGED_MARK) return "changed";
      if (cause === RESPONDED_MARK) return "responded";
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
