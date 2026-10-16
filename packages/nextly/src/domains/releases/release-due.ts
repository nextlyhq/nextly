/**
 * When a scheduled instant is due: at or before now, inclusively — a release
 * scheduled for 09:00 is in effect AT 09:00, not from the first request after.
 *
 * Stated ONCE, as the condition a query uses. The drain asks the database for
 * the releases it holds, and the read-side resolver asks it of each member in
 * memory through the same evaluator, so the two cannot come to disagree about
 * the boundary — a prefilter that drifted would drop a candidate before the
 * resolver ever saw it.
 *
 * @module domains/releases/release-due
 */
import type { VersionsWhereCondition } from "../versions/db-api";

import { meetsCondition } from "./release-conditions";

/** The condition a scheduled instant meets once it is due. */
export function releaseDueCondition(now: Date): VersionsWhereCondition {
  return { column: "scheduledAt", op: "<=", value: now };
}

/** Whether an instant is due at `now`, by that same condition. */
export function isDueAt(scheduledAt: Date, now: Date): boolean {
  return meetsCondition({ scheduledAt }, releaseDueCondition(now));
}
