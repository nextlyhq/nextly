/**
 * The release calendar and the list's day filter, against a REAL database.
 *
 * What only a database can establish here: that the instants a day in a zone
 * is turned into select the same releases on every dialect — SQLite keeps
 * whole seconds as integers, PostgreSQL a `timestamptz`, MySQL a `datetime(3)`
 * in UTC — that a day's counts are complete however many releases it holds,
 * and that the calendar's day and the list filtered to that day are the same
 * releases in the same order.
 *
 * Every instant is fixed and in the future, so no case depends on the clock.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReleaseKind } from "../../../schemas/releases/types";
import { ReleasesRepository } from "../releases-repository";

import { scheduleAsItStands } from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** A release scheduled for `at`, as the repository writes one. */
async function scheduled(
  repo: ReleasesRepository,
  title: string,
  at: string,
  kind: ReleaseKind = "release"
): Promise<string> {
  const release = await repo.createRelease({ title, kind });
  expect(await scheduleAsItStands(repo, release.id, new Date(at), "UTC")).toBe(
    true
  );
  return release.id;
}

describe.each(getConfiguredTestDialects())(
  "the release calendar (%s)",
  dialect => {
    it("counts every release on a busy day by state, and sends the first three in time order", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);

      // Written against their time order, so a read that kept insertion order
      // would send the wrong three.
      for (const hour of ["12", "11", "10", "09", "08"]) {
        await scheduled(repo, `At ${hour}`, `2027-05-04T${hour}:00:00Z`);
      }
      // A release in each other state with a time, all on the same day.
      const stoppedAt = new Date("2027-05-04T13:00:00Z");
      const stopped = await scheduled(repo, "Stopped", stoppedAt.toISOString());
      expect(
        await repo.blockReleases([{ id: stopped, scheduledAt: stoppedAt }])
      ).toEqual([stopped]);
      const ranAt = new Date("2027-05-04T14:00:00Z");
      const ran = await scheduled(repo, "Ran", ranAt.toISOString());
      expect(await repo.markReleasePublished(ran, ranAt)).toBe(true);
      const calledOff = await scheduled(
        repo,
        "Called off",
        "2027-05-04T15:00:00Z"
      );
      expect(await repo.cancelRelease(calledOff)).toBe(true);
      // A single-document release, which the kind filter leaves out.
      await scheduled(repo, "On its own", "2027-05-04T16:00:00Z", "single");
      // A draft has no time and is on no day.
      await repo.createRelease({ title: "Draft" });
      // The day's edges: the last second before it, and its last second.
      await scheduled(repo, "Day before", "2027-05-03T23:59:59Z");
      await scheduled(repo, "Last second", "2027-05-04T23:59:59Z");

      const calendar = await app.nextly.releases.calendar({
        from: "2027-05-03",
        to: "2027-05-05",
        timezone: "UTC",
      });

      expect(calendar.days.map(day => [day.date, day.total])).toEqual([
        ["2027-05-03", 1],
        ["2027-05-04", 10],
        ["2027-05-05", 0],
      ]);
      const busy = calendar.days[1];
      expect(busy.counts).toEqual({
        draft: 0,
        scheduled: 7,
        published: 1,
        cancelled: 1,
        blocked: 1,
      });
      expect(busy.releases.map(release => release.title)).toEqual([
        "At 08",
        "At 09",
        "At 10",
      ]);
      // The rows are whole releases, ready to draw as chips.
      expect(busy.releases[0]).toMatchObject({
        state: "scheduled",
        scheduledAt: new Date("2027-05-04T08:00:00Z"),
      });

      // The "+N more" list: the same day from the list, in full and in the
      // same order, so its first three are the three the calendar sent.
      const day = { date: "2027-05-04", timezone: "UTC" };
      const list = await app.nextly.releases.find({ day, limit: 50 });
      expect(list.meta.total).toBe(10);
      expect(list.items.map(release => release.title)).toEqual([
        "At 08",
        "At 09",
        "At 10",
        "At 11",
        "At 12",
        "Stopped",
        "Ran",
        "Called off",
        "On its own",
        "Last second",
      ]);
      await expect(app.nextly.releases.count({ day })).resolves.toBe(10);

      // Leaving out single-document releases, in the calendar and the list
      // alike.
      const ordinary = await app.nextly.releases.calendar({
        from: "2027-05-04",
        to: "2027-05-04",
        timezone: "UTC",
        kind: "release",
      });
      expect(ordinary.days[0].total).toBe(9);
      await expect(
        app.nextly.releases.count({ day, kind: "release" })
      ).resolves.toBe(9);
    });

    it("puts a release near midnight on a different day in each of two zones", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      // 23:30 on 14 January in New York (-05:00); 04:30 on the 15th in London.
      await scheduled(repo, "Late in New York", "2027-01-15T04:30:00Z");

      const window = { from: "2027-01-14", to: "2027-01-15" };
      const inNewYork = await app.nextly.releases.calendar({
        ...window,
        timezone: "America/New_York",
      });
      const inLondon = await app.nextly.releases.calendar({
        ...window,
        timezone: "Europe/London",
      });
      expect(inNewYork.days.map(day => [day.date, day.total])).toEqual([
        ["2027-01-14", 1],
        ["2027-01-15", 0],
      ]);
      expect(inLondon.days.map(day => [day.date, day.total])).toEqual([
        ["2027-01-14", 0],
        ["2027-01-15", 1],
      ]);

      // The day's list agrees with the calendar in each zone.
      const titlesOn = async (date: string, timezone: string) =>
        (await app.nextly.releases.find({ day: { date, timezone } })).items.map(
          release => release.title
        );
      expect(await titlesOn("2027-01-14", "America/New_York")).toEqual([
        "Late in New York",
      ]);
      expect(await titlesOn("2027-01-14", "Europe/London")).toEqual([]);
      expect(await titlesOn("2027-01-15", "Europe/London")).toEqual([
        "Late in New York",
      ]);
    });

    it("ends a day where the zone's clocks say, on the day they go forward", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      // Berlin goes forward on 2027-03-28, so that day ends at 22:00 UTC, not
      // 23:00. A release at 22:30 UTC is half past midnight on the 29th.
      await scheduled(repo, "Just after midnight", "2027-03-28T22:30:00Z");

      const calendar = await app.nextly.releases.calendar({
        from: "2027-03-28",
        to: "2027-03-29",
        timezone: "Europe/Berlin",
      });
      expect(calendar.days.map(day => [day.date, day.total])).toEqual([
        ["2027-03-28", 0],
        ["2027-03-29", 1],
      ]);
      const onThe28th = await app.nextly.releases.find({
        day: { date: "2027-03-28", timezone: "Europe/Berlin" },
      });
      expect(onThe28th.meta.total).toBe(0);
    });

    it("refuses a window longer than six weeks, and one that ends before it starts", async () => {
      const app = await boot(dialect);
      const zone = { timezone: "Europe/Berlin" };

      const sixWeeks = await app.nextly.releases.calendar({
        ...zone,
        from: "2027-03-01",
        to: "2027-04-11",
      });
      expect(sixWeeks.days).toHaveLength(42);

      await expect(
        app.nextly.releases.calendar({
          ...zone,
          from: "2027-03-01",
          to: "2027-04-12",
        })
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
        publicMessage: expect.stringContaining("at most 42 days"),
      });
      await expect(
        app.nextly.releases.calendar({
          ...zone,
          from: "2027-03-02",
          to: "2027-03-01",
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
  }
);
