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

/** The mark on a refusal for a closed form, for the caller to recognise it. */
const FORM_CLOSED = "form-builder:form-closed";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];
type OwnCollections = PluginContext["services"]["ownCollections"];

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
  own: OwnCollections,
  write: InTransactionContext,
  slugs: FormLimitSlugs
): Promise<void> {
  const submission = newSubmission(write);
  if (submission === undefined) return;
  const { formId } = submission;
  const stored = await formOf(own, write, slugs, formId, "none");
  if (pastClosingTime(stored.settings, new Date())) {
    throw closedRefusal(stored.form, { formId, closedBy: "date" });
  }
  if (
    !submission.takesAPlace ||
    stored.settings.submissionLimit === undefined
  ) {
    return;
  }
  // Turns, one form at a time: the next submission to this form waits here.
  // Read again under the lock, which a change to the limit also waits for.
  const { form, settings } = await formOf(own, write, slugs, formId, "update");
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

/** Hold every form's closing on the submissions this plugin stores. */
export function registerFormClosing(
  ctx: Pick<PluginContext, "hooks" | "services">,
  slugs: FormLimitSlugs
): void {
  ctx.hooks.onInTransaction(slugs.submissions, write =>
    holdFormClosing(ctx.services.ownCollections, write, slugs)
  );
}

/** Whether `error`, or one it was made from, is a closed form's refusal. */
export function isFormClosed(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      current instanceof NextlyError &&
      current.logContext?.cause === FORM_CLOSED
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
