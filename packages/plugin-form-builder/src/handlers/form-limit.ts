/**
 * A form's limit, held where a submission is stored: inside the submission's
 * own write transaction, whatever wrote it (the public route, `submitForm`
 * called from another plugin, the Direct API or the admin).
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
 * - PostgreSQL and MySQL. A write that runs in-transaction handlers reads
 *   committed, so the count after the lock sees what the submission before it
 *   committed. The count takes no lock of its own: a locking read would wait
 *   on another submission's uncommitted row while that submission waits for
 *   this one's lock. The submission's `form` column is a plain column with no
 *   database foreign key, so its insert holds no lock on the form's row, and
 *   two submissions waiting on each other's insert cannot arise.
 * - SQLite. One writer at a time already, so the count sees every commit.
 *
 * Spam does not count, and a submission stored as spam is never refused here.
 * Marking a submission spam or not spam, deleting submissions and the
 * retention pass change the count by changing the rows it reads: there is no
 * counter to keep in step. Only a new submission is judged: marking a stored
 * one "not spam" restores a place it was entitled to when it arrived.
 *
 * @module handlers/form-limit
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { closedMessageOf } from "../utils/form-closing";
import { normalizeFormSettings } from "../utils/form-settings";

/** The mark on a refusal for a full form, for the caller to recognise it. */
const FORM_FULL = "form-builder:form-full";

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

/** Whether a write is a new submission that takes a place. */
function takesAPlace(write: InTransactionContext): string | undefined {
  if (write.operation !== "create") return undefined;
  const data = write.data as { form?: unknown; status?: unknown } | undefined;
  if (data === undefined || data.status === "spam") return undefined;
  return formIdOf(data.form);
}

/** The form's limit, when it has one, as stored. */
async function limitOf(
  own: OwnCollections,
  write: InTransactionContext,
  slugs: FormLimitSlugs,
  formId: string,
  lock: "none" | "update"
): Promise<{ limit?: number; form: Record<string, unknown> }> {
  const form = (await own.findEntryByIdInTransaction(
    write.transaction,
    slugs.forms,
    formId,
    { lock }
  )) as unknown as Record<string, unknown>;
  return { limit: normalizeFormSettings(form.settings).submissionLimit, form };
}

/**
 * Refuse a new submission that would take a form past its limit. A form with
 * no limit is read once, unlocked, and left alone.
 */
async function holdFormLimit(
  own: OwnCollections,
  write: InTransactionContext,
  slugs: FormLimitSlugs
): Promise<void> {
  const formId = takesAPlace(write);
  if (formId === undefined) return;
  if ((await limitOf(own, write, slugs, formId, "none")).limit === undefined) {
    return;
  }
  // Turns, one form at a time: the next submission to this form waits here.
  // Read again under the lock, which a change to the limit also waits for.
  const { limit, form } = await limitOf(own, write, slugs, formId, "update");
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
    throw NextlyError.conflict({
      reason: "state",
      message: closedMessageOf(form),
      logContext: { cause: FORM_FULL, formId, limit },
    });
  }
}

/** Hold every form's limit on the submissions this plugin stores. */
export function registerFormLimit(
  ctx: Pick<PluginContext, "hooks" | "services">,
  slugs: FormLimitSlugs
): void {
  ctx.hooks.onInTransaction(slugs.submissions, write =>
    holdFormLimit(ctx.services.ownCollections, write, slugs)
  );
}

/** Whether `error`, or one it was made from, is a full form's refusal. */
export function isFormFull(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      current instanceof NextlyError &&
      current.logContext?.cause === FORM_FULL
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
