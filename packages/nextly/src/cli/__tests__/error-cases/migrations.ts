/**
 * Cases for migration runs: the schema lock, the data-loss consent, and the migration files.
 *
 * @module cli/__tests__/error-cases/migrations
 */
import {
  judgeDataLoss,
  resolveDataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { describeHolder } from "../../../domains/schema/pipeline/schema-lock";
import { NextlyError } from "../../../errors/nextly-error";
import { CliError, dataLossRefusal } from "../../errors";

import type { ErrorCases } from "./types";

/** A fixed clock, so the holder's start and lapse times read the same in every run. */
const NOW = Date.UTC(2026, 9, 29, 10, 2, 0);

/** The verdict a run with no terminal reaches for one column, with the consent given. */
async function refusedVerdict(flag: string | boolean | undefined) {
  const verdict = await judgeDataLoss({
    deletions: [
      { kind: "column", table: "dc_posts", column: "summary", count: 42 },
    ],
    consent: resolveDataLossConsent({ flag, env: {} }),
    interactive: false,
    ask: () => Promise.resolve(false),
    print: () => {},
  });
  if (verdict.kind !== "refused")
    throw new Error(`expected a refusal, got ${verdict.kind}`);
  return verdict;
}

export const MIGRATION_CASES = {
  // As `refusalFor` in `domains/schema/pipeline/schema-lock.ts` builds it, with the holder in the
  // lock's own words.
  SCHEMA_LOCK_HELD: () => {
    const holder = {
      kind: "schema" as const,
      owner: "build-01:4242#6f1c",
      command: "nextly db:sync",
      heldForSeconds: 120,
      lapsesInSeconds: 30,
    };
    const described = describeHolder(holder, NOW);
    return new NextlyError({
      code: "NEXTLY_MIGRATE_LOCK_BUSY",
      publicMessage:
        "`nextly migrate` did not start, and changed nothing: the schema lock is still held " +
        `after waiting 30 s. ${described[0].toUpperCase()}${described.slice(1)} Run it again once that finishes.`,
      logContext: {
        reason: "schema lock held",
        command: "nextly migrate",
        holder,
        waitedMs: 30_000,
      },
    });
  },
  DATA_LOSS_CONSENT_REQUIRED: async () =>
    dataLossRefusal(await refusedVerdict(undefined)),
  DATA_LOSS_CONSENT_NOT_COVERED: async () =>
    dataLossRefusal(await refusedVerdict("dc_authors")),
  // Reserved for `nextly migrate`'s check of applied files, which the guides document; nothing
  // raises them yet, so each case is the error as that check is to raise it.
  MIGRATION_TAMPERED: () =>
    new CliError("MIGRATION_TAMPERED", {
      what: "`20261020_120000_add_posts.sql` has changed since it was applied, so `nextly migrate` ran nothing.",
      why: "Its checksum no longer matches the one recorded when it ran on this database.",
      next: "Restore the file as it was when it ran, and put the change in a new migration with `nextly migrate:create`.",
    }),
  MIGRATION_MISSING: () =>
    new CliError("MIGRATION_MISSING", {
      what: "`20261020_120000_add_posts.sql` is recorded as applied, but its file is not in the migrations folder.",
      why: "It ran on this database and no removal of it is recorded, so the folder may be from an older build.",
      next: "Restore the file from version control, or deploy the build that has it, then run `nextly migrate` again.",
    }),
} satisfies ErrorCases;
