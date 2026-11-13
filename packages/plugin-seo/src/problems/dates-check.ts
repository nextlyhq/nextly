/**
 * The site check for sitemap dates set to "now": dates that keep matching
 * the day they are checked, which is what a date taken from the build or
 * the request looks like. Search engines may stop trusting such a site's
 * dates.
 *
 * Judged on the full check: more than half of the sitemap's addresses, and
 * at least 20, carry the day of the check, on two full checks made on
 * different days. One day alone is not enough, since a site that moved all
 * its content in today shows the same; a check that does not match starts
 * the count again. What the last matching check found is kept as a note.
 *
 * @module problems/dates-check
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { noteKey, putNote, readNotes } from "../address-record/store";

import { WHOLE_SITE, type Problem } from "./contract";

/** The fewest addresses dated the day of the check that count. */
const FEWEST = 20;

/** The note the day of the last matching check is kept under. */
const MATCHED_KEY = noteKey("sitemap-dates-matched-on");

/** The UTC day of an ISO date. */
const dayOf = (iso: string) => iso.slice(0, 10);

/** Whether `lastmods` carry `day` as a date set to "now" would. */
export function datesMatchDay(
  lastmods: readonly (string | undefined)[],
  day: string
): boolean {
  const today = lastmods.filter(
    lastmod => lastmod !== undefined && dayOf(lastmod) === day
  ).length;
  return today >= FEWEST && today * 2 > lastmods.length;
}

/**
 * The outcome of a full check that `matched` or not on `day`, given the day
 * of the last check that matched: whether that makes a problem, and the day
 * to keep for the next check.
 */
export function datesCheckOutcome(
  matched: boolean,
  matchedOn: string | undefined,
  day: string
): { problem: boolean; matchedOn: string | undefined } {
  if (!matched) return { problem: false, matchedOn: undefined };
  return {
    problem: matchedOn !== undefined && matchedOn !== day,
    matchedOn: day,
  };
}

/**
 * The problem a full check finds in the sitemap's dates, where it finds one,
 * keeping what it found for the next check.
 */
export async function datesTodayProblems(
  ctx: PluginContext,
  lastmods: readonly (string | undefined)[],
  now: Date = new Date()
): Promise<Problem[]> {
  const day = dayOf(now.toISOString());
  const { notes } = await readNotes(ctx, [MATCHED_KEY]);
  const kept = notes.get(MATCHED_KEY);
  const outcome = datesCheckOutcome(
    datesMatchDay(lastmods, day),
    kept === null || kept === undefined || kept === "" ? undefined : kept,
    day
  );
  if ((outcome.matchedOn ?? "") !== (kept ?? "")) {
    await putNote(ctx, MATCHED_KEY, outcome.matchedOn ?? "");
  }
  if (!outcome.problem) return [];
  return [
    {
      kind: "datesToday",
      subject: WHOLE_SITE,
      what: "Most pages in the sitemap say they changed on the day they were checked, on two different days.",
      action: "Copy a note for a developer",
      fix: {
        place: "developer",
        note: "The sitemap's dates keep matching the day they are read, which is what a build or request time looks like. Give each page the date its content last changed: for a page built in code, state it as openGraph.modifiedTime in the metadata passed to seoMetadata, or leave it out.",
      },
    },
  ];
}
