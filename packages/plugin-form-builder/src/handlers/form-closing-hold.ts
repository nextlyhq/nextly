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

import { holdsKeyFor, type KeyedSubmission } from "./one-response";

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
}

/** The mark on a refusal for a setting changed while the write was in flight. */
const SETTINGS_CHANGED_MARK = "form-builder:settings-changed";

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
  await holdResponseKey(deps.digests, write, formId, locked.settings);
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
  digests: Digests,
  write: InTransactionContext,
  formId: string,
  settings: Awaited<ReturnType<typeof formOf>>["settings"]
): Promise<void> {
  if (
    await holdsKeyFor(
      () => digests,
      settings,
      write.data as KeyedSubmission & { responseKey?: unknown }
    )
  ) {
    return;
  }
  throw NextlyError.conflict({
    reason: "state",
    message: SETTINGS_CHANGED,
    logContext: { cause: SETTINGS_CHANGED_MARK, formId },
  });
}

/** Hold every form's closing on the submissions this plugin stores. */
export function registerFormClosing(
  ctx: Pick<PluginContext, "hooks" | "services" | "security">,
  slugs: FormLimitSlugs
): void {
  const deps: HoldDeps = {
    own: ctx.services.ownCollections,
    digests: ctx.security.digests,
  };
  ctx.hooks.onInTransaction(slugs.submissions, write =>
    holdFormClosing(deps, write, slugs)
  );
}

/**
 * Which of the hold's refusals `error` is, or one it was made from: a closed
 * form's, or a setting changed while the submission was in flight.
 */
export function heldRefusal(error: unknown): "closed" | "changed" | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (current instanceof NextlyError) {
      const cause = current.logContext?.cause;
      if (cause === FORM_CLOSED) return "closed";
      if (cause === SETTINGS_CHANGED_MARK) return "changed";
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
