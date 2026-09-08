/**
 * The plugin job seam.
 *
 * The bug this closes is invisible by construction: a plugin calls `defineJob`,
 * queues the slug, receives an id, and every drain defers the row because the
 * registry never heard of the handler. No step fails. So the test that matters
 * is not "does defineJob work" — it does, in isolation, forever — but "does a
 * contributed definition REACH the thing a drain reads".
 */

import { describe, expect, it } from "vitest";

import { defineJob } from "../../../domains/jobs/job-registry";
import { collectJobs } from "../collect-jobs";

const job = (slug: string) => defineJob({ slug, handler: async () => {} });

const plugin = (name: string, jobs: ReturnType<typeof defineJob>[]) =>
  ({ name, contributes: { jobs } }) as never;

const config = (jobs?: ReturnType<typeof defineJob>[]) => ({ jobs }) as never;

describe("collectJobs", () => {
  it("collects a job a plugin contributes", () => {
    const collected = collectJobs(config(), [
      plugin("acme-exports", [job("acme:export")]),
    ]);

    expect(collected.map(c => c.definition.slug)).toEqual(["acme:export"]);
  });

  it("collects a job the application declares itself", () => {
    const collected = collectJobs(config([job("app:sweep")]), []);

    expect(collected.map(c => c.definition.slug)).toEqual(["app:sweep"]);
  });

  it("records who declared each one", () => {
    // Provenance is what makes a collision message actionable: "declared twice"
    // is not something an operator can act on without both names.
    const collected = collectJobs(config([job("app:one")]), [
      plugin("acme", [job("acme:two")]),
    ]);

    expect(collected.map(c => c.owner)).toEqual(["app", "acme"]);
  });

  it("refuses two declarations of the same slug", () => {
    // Not a warning. Which handler wins would otherwise depend on plugin load
    // order, and the loser would never run with nothing anywhere to say so.
    expect(() =>
      collectJobs(config(), [
        plugin("acme", [job("shared:slug")]),
        plugin("other", [job("shared:slug")]),
      ])
    ).toThrow(/declared by both "acme" and "other"/);
  });

  it("refuses a plugin claiming a reserved core namespace", () => {
    // A plugin registering `releases:drain` would replace the job that publishes
    // scheduled content — or be refused at registry level with the reason lost.
    expect(() =>
      collectJobs(config(), [plugin("acme", [job("releases:drain")])])
    ).toThrow(/reserved for built-in job types/);
  });

  it("ignores a DISABLED plugin's jobs", () => {
    // `initializePlugins` skips a disabled plugin's init, services and hooks, so
    // registering its handler would make runnable code whose setup deliberately
    // never happened. A row queued while the plugin was on stays queued and runs
    // when it is turned back on — deferring is recoverable, running against
    // missing initialization is not.
    const collected = collectJobs(config(), [
      {
        name: "acme",
        enabled: false,
        contributes: { jobs: [job("acme:x")] },
      } as never,
    ]);

    expect(collected).toEqual([]);
  });

  it("normalises a slug that never passed through defineJob", () => {
    // `JobDefinition` is structural, so a hand-built definition can carry
    // padding. The registry would key it verbatim while an enqueue stores the
    // trimmed form, leaving the row unable to find its own handler.
    const collected = collectJobs(config(), [
      {
        name: "acme",
        contributes: {
          jobs: [
            {
              slug: "  acme:pad  ",
              handler: async () => {},
              retry: { maxAttempts: 3 },
              sweep: false,
            },
          ],
        },
      } as never,
    ]);

    expect(collected.map(c => c.definition.slug)).toEqual(["acme:pad"]);
  });

  it("returns nothing when nobody declares a job", () => {
    // The control: an empty result must mean "none declared", not "the fold
    // silently found nothing it understood".
    expect(collectJobs(config(), [plugin("acme", [])])).toEqual([]);
  });
});
