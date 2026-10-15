import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { eq, lte } from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";

import { sentEmails } from "../schema/tables";

import type { AccountsDb } from "./accounts";

/** Whether the email job with this id has already sent its email. */
export async function emailSentBy(
  db: AccountsDb,
  jobId: string
): Promise<boolean> {
  const columns = db.table(sentEmails);

  return (
    (await db.select(sentEmails).where(eq(columns.jobId, jobId)).first()) !==
    null
  );
}

/**
 * Records that the email job with this id sent its email. A record already
 * there, from an attempt that sent and recorded before this one, is kept:
 * the unique job id decides, so two attempts at once record it once.
 */
export async function recordEmailSent(
  db: AccountsDb,
  dialect: PluginContext["dialect"],
  jobId: string,
  sentAt: Date
): Promise<void> {
  try {
    await db.insert(sentEmails, { jobId, sentAt });
  } catch (error) {
    if (!isUniqueViolation(dialect, error)) throw error;
  }
}

/** Forgets the sends recorded at or before `before`, long past any retry of their jobs. Answers how many. */
export async function sweepSentEmails(
  db: AccountsDb,
  before: Date
): Promise<number> {
  const columns = db.table(sentEmails);

  return db.delete(sentEmails).where(lte(columns.sentAt, before));
}
