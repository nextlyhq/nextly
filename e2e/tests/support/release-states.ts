/**
 * Leave releases as the release runner leaves them, for the release specs.
 *
 * Why the database is written at all: no request puts a release in either
 * state on purpose. Scheduling a time already past runs the release there and
 * then; a release with a problem is refused a schedule; and Publish now runs a
 * pass of the runner, which runs any overdue release it finds. Overdue is a
 * scheduled release more than ten minutes past its time, and stopped is the
 * runner's `blocked`, so both are written to the release row directly.
 *
 * The guard rails, which are the point of keeping this in one place:
 * - it writes ONLY to the suite's own throwaway database, `e2e.db`, which the
 *   suite empties before every run (see `playwright.config.ts`);
 * - call it after every API write a spec makes, since a later Publish now
 *   would run an overdue release it left;
 * - each write must change exactly one row, and each release is then read
 *   back through the API and its state asserted, so a schema change fails
 *   here, loudly, instead of seeding something the list then misreads.
 *
 * Revisit once the runner's early stop can stop a release for a real hard
 * problem: "stopped" should then be produced through it rather than written.
 *
 * @module e2e/tests/support/release-states
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

/** The suite's own database, never the one `pnpm dev:app` uses. */
const E2E_DB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/playground/data/e2e.db"
);

/** How long ago an overdue release was due: well past the ten-minute grace. */
const OVERDUE_BY_MS = 60 * 60 * 1000;

export type RunnerOutcome = "overdue" | "stopped";

/**
 * Leave each release as the runner would, then confirm through the API that
 * the server reads it that way.
 */
export async function leaveReleasesAsTheRunnerWould(
  page: Page,
  releases: ReadonlyArray<{ id: string; outcome: RunnerOutcome }>
): Promise<void> {
  const dueAt = Math.floor((Date.now() - OVERDUE_BY_MS) / 1000);
  const db = new DatabaseSync(E2E_DB);
  try {
    const update = db.prepare(
      "UPDATE nextly_releases SET state = ?, scheduled_at = ? WHERE id = ?"
    );
    for (const { id, outcome } of releases) {
      const { changes } = update.run(
        outcome === "stopped" ? "blocked" : "scheduled",
        dueAt,
        id
      );
      expect(changes, `release ${id} was not written`).toBe(1);
    }
  } finally {
    db.close();
  }

  for (const { id, outcome } of releases) {
    const response = await page.request.get(`/admin/api/releases/${id}`);
    expect(response.ok(), await response.text()).toBe(true);
    const release = (await response.json()) as {
      state?: string;
      scheduledAt?: string | null;
    };
    expect(release.state, `release ${id}`).toBe(
      outcome === "stopped" ? "blocked" : "scheduled"
    );
    expect(Date.parse(release.scheduledAt ?? ""), `release ${id}`).toBe(
      dueAt * 1000
    );
  }
}
