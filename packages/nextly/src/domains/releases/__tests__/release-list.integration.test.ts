/**
 * The release list, paged on the server, against a REAL database.
 *
 * What only an integration test can establish here is that the database and
 * the declared tab rules agree: that each tab's conditions select exactly the
 * releases the rule names, that the order is total on every dialect (ties on
 * one instant included, which SQLite's whole-second timestamps make common),
 * that the count is the count of everything matching rather than of one page,
 * and that the search ignores case on every engine, whatever the column's
 * collation — PostgreSQL's `LIKE` is case-sensitive, and so is MySQL's under a
 * case-sensitive collation such as `utf8mb4_bin`.
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
import { RELEASE_TABS, releaseTabOf, type ReleaseTab } from "../release-tabs";
import { releaseMemberKey } from "../release-member-key";
import { ReleasesRepository, type ReleaseRow } from "../releases-repository";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

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

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Read every page of a tab, so a test can see what paging adds or drops. */
async function readAllPages(
  repo: ReleasesRepository,
  query: { tab?: ReleaseTab; search?: string; now: Date },
  limit: number
): Promise<{ titles: string[]; totals: number[] }> {
  const titles: string[] = [];
  const totals: number[] = [];
  for (let offset = 0; offset < 1000; offset += limit) {
    const page = await repo.findReleasePage({ ...query, offset, limit });
    totals.push(page.total);
    titles.push(...page.rows.map(row => row.title));
    if (page.rows.length < limit) break;
  }
  return { titles, totals };
}

/**
 * A scheduled release written with an id of the test's choosing.
 *
 * Through the adapter's typed insert into the production table, because the
 * repository picks its own ids and the tie test needs ids that run against
 * the order the rows are written in.
 */
async function insertScheduled(
  app: TestNextly,
  id: string,
  title: string,
  at: Date
): Promise<void> {
  const created = new Date();
  await (
    app.adapter as unknown as {
      insert: (
        table: string,
        row: Record<string, unknown>,
        options: { returning: string[] }
      ) => Promise<unknown>;
    }
  ).insert(
    "nextly_releases",
    {
      id,
      title,
      description: null,
      scheduledAt: at,
      timezone: "UTC",
      state: "scheduled",
      publishedAt: null,
      createdBy: null,
      createdAt: created,
      updatedAt: created,
      revision: 0,
    },
    { returning: [] }
  );
}

/**
 * A release member written with an id and a creation time of the test's
 * choosing, through the adapter's typed insert into the production table.
 */
async function insertMember(
  app: TestNextly,
  releaseId: string,
  id: string,
  entryId: string,
  createdAt: Date
): Promise<void> {
  const ref = {
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId,
    locale: null,
  };
  await (
    app.adapter as unknown as {
      insert: (
        table: string,
        row: Record<string, unknown>,
        options: { returning: string[] }
      ) => Promise<unknown>;
    }
  ).insert(
    "nextly_release_members",
    {
      id,
      releaseId,
      ...ref,
      action: "publish",
      memberKey: releaseMemberKey(releaseId, ref),
      createdBy: null,
      createdAt,
    },
    { returning: [] }
  );
}

/**
 * One release in every place the tabs distinguish, with the instants chosen
 * well clear of the overdue cutoff so a second's rounding cannot move one.
 */
async function seedOneOfEach(repo: ReleasesRepository, now: Date) {
  const draft = await repo.createRelease({ title: "Draft" });

  const future = await repo.createRelease({ title: "Future" });
  await scheduleAsItStands(
    repo,
    future.id,
    new Date(now.getTime() + DAY),
    "UTC"
  );

  // Past its instant but inside the grace period: the runner simply has not
  // reached it yet, so it is still Upcoming.
  const justDue = await repo.createRelease({ title: "Just due" });
  await scheduleAsItStands(
    repo,
    justDue.id,
    new Date(now.getTime() - 3 * MINUTE),
    "UTC"
  );

  const overdue = await repo.createRelease({ title: "Overdue" });
  const overdueAt = new Date(now.getTime() - 60 * MINUTE);
  await scheduleAsItStands(repo, overdue.id, overdueAt, "UTC");

  const stopped = await repo.createRelease({ title: "Stopped" });
  const stoppedAt = new Date(now.getTime() - 30 * MINUTE);
  await scheduleAsItStands(repo, stopped.id, stoppedAt, "UTC");
  expect(
    await repo.blockReleases([{ id: stopped.id, scheduledAt: stoppedAt }])
  ).toEqual([stopped.id]);

  const published = await repo.createRelease({ title: "Published" });
  const publishedAt = new Date(now.getTime() - 2 * DAY);
  await scheduleAsItStands(repo, published.id, publishedAt, "UTC");
  expect(await repo.markReleasePublished(published.id, publishedAt)).toBe(true);

  const cancelled = await repo.createRelease({ title: "Cancelled" });
  expect(await repo.cancelRelease(cancelled.id)).toBe(true);

  return { draft, future, justDue, overdue, stopped, published, cancelled };
}

describe.each(getConfiguredTestDialects())(
  "the release list on the server (%s)",
  dialect => {
    it("puts every release in exactly one tab, the one the tab rule names", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      await seedOneOfEach(repo, now);

      const byTab = new Map<ReleaseTab, string[]>();
      for (const tab of RELEASE_TABS) {
        const page = await repo.findReleasePage({ tab, now, limit: 50 });
        byTab.set(
          tab,
          page.rows.map(row => row.title)
        );
        // The rule evaluated in memory agrees with the database about every
        // row the database put in this tab. Two readings of one declaration,
        // checked against each other on real rows.
        for (const row of page.rows) expect(releaseTabOf(row, now)).toBe(tab);
      }

      expect(byTab.get("upcoming")).toEqual(["Just due", "Future"]);
      // Stopped first, then overdue.
      expect(byTab.get("attention")).toEqual(["Stopped", "Overdue"]);
      expect(byTab.get("drafts")).toEqual(["Draft"]);
      expect([...(byTab.get("done") ?? [])].sort()).toEqual([
        "Cancelled",
        "Published",
      ]);

      // Exactly one tab each: nothing missing, nothing counted twice.
      const all = [...byTab.values()].flat();
      expect(all).toHaveLength(7);
      expect(new Set(all).size).toBe(7);
    });

    it("pages a tab with a true total, and splits no tie across pages", async () => {
      // 🔴 Seven releases share ONE instant, inserted in the REVERSE of their id
      // order. What separates a total order from one that only looks total is a
      // page boundary inside the tie: without the id tiebreak each page's query
      // may return the tied rows in whatever order the engine reads them —
      // usually insertion order — so the pages repeat one row and skip another.
      // Inserting against id order is what keeps "insertion order" from
      // passing for "id order".
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      const shared = new Date(now.getTime() + 2 * DAY);
      const tiedIds = Array.from(
        { length: 7 },
        (_, i) => `00000000-0000-7000-8000-00000000000${i}`
      );
      for (const id of [...tiedIds].reverse()) {
        await insertScheduled(app, id, `Tied ${tiedIds.indexOf(id)}`, shared);
      }
      const sooner = await repo.createRelease({ title: "Sooner" });
      await scheduleAsItStands(
        repo,
        sooner.id,
        new Date(now.getTime() + DAY),
        "UTC"
      );
      const later = await repo.createRelease({ title: "Later" });
      await scheduleAsItStands(
        repo,
        later.id,
        new Date(now.getTime() + 3 * DAY),
        "UTC"
      );
      // In another tab, so a count that ignored the tab would say 10.
      await repo.createRelease({ title: "A draft" });

      const { titles, totals } = await readAllPages(
        repo,
        { tab: "upcoming", now },
        3
      );

      expect(titles).toEqual([
        "Sooner",
        ...tiedIds.map((_, i) => `Tied ${i}`),
        "Later",
      ]);
      // Every page reports the whole tab, not the rows it holds.
      expect(new Set(totals)).toEqual(new Set([9]));
    });

    it("finds a search match that only a later page would have held", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      // Twenty-four releases ahead of the match in Upcoming's order, so with a
      // page of ten it sits on the third page. A search applied to a page after
      // reading it — in memory, or in the client — finds nothing on page one.
      for (let i = 0; i < 24; i += 1) {
        const release = await repo.createRelease({ title: `Launch ${i}` });
        await scheduleAsItStands(
          repo,
          release.id,
          new Date(now.getTime() + (i + 1) * MINUTE * 60),
          "UTC"
        );
      }
      const match = await repo.createRelease({
        title: "Winter catalogue",
        description: "Every ZEBRA print, at once",
      });
      await scheduleAsItStands(
        repo,
        match.id,
        new Date(now.getTime() + 30 * DAY),
        "UTC"
      );

      // Matched in the DESCRIPTION, in a different case from how it is stored.
      const page = await repo.findReleasePage({
        tab: "upcoming",
        now,
        search: "zebra",
        offset: 0,
        limit: 10,
      });
      expect(page.rows.map(row => row.title)).toEqual(["Winter catalogue"]);
      expect(page.total).toBe(1);

      // And in the TITLE, case folded the other way.
      const byTitle = await repo.findReleasePage({
        tab: "upcoming",
        now,
        search: "WINTER",
        limit: 10,
      });
      expect(byTitle.rows.map(row => row.title)).toEqual(["Winter catalogue"]);
    });

    it("searches for what was typed, not for a pattern", async () => {
      // `%` and `_` are wildcards to LIKE. Passed through unescaped, a search
      // for "50%" matches "50 years" too, and one for "a_b" matches "axb": a
      // widened search reads as a working one, so only a non-match shows it.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      for (const title of ["50% off", "50 years", "a_b", "axb"]) {
        await repo.createRelease({ title });
      }

      const percent = await repo.findReleasePage({
        tab: "drafts",
        now,
        search: "50%",
        limit: 10,
      });
      expect(percent.rows.map(row => row.title)).toEqual(["50% off"]);

      const underscore = await repo.findReleasePage({
        tab: "drafts",
        now,
        search: "a_b",
        limit: 10,
      });
      expect(underscore.rows.map(row => row.title)).toEqual(["a_b"]);
    });

    it.runIf(dialect === "mysql")(
      "ignores case on MySQL under a case-sensitive collation",
      async () => {
        // MySQL's `LIKE` compares under the column's collation, so the default
        // `utf8mb4_0900_ai_ci` hides a search that only ignores case by luck.
        // The title is moved to a binary collation, keeping its stored type,
        // and the search must still find "Spring launch" for "spring".
        const app = await boot(dialect);
        const [column] = await app.adapter.executeQuery<{
          type: string;
          nullable: string;
        }>(
          "SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nextly_releases' AND COLUMN_NAME = 'title'"
        );
        await app.adapter.executeQuery(
          `ALTER TABLE nextly_releases MODIFY title ${column.type} COLLATE utf8mb4_bin ${column.nullable === "NO" ? "NOT NULL" : "NULL"}`
        );
        const repo = new ReleasesRepository(app.adapter);
        const now = new Date();
        await repo.createRelease({ title: "Spring launch" });

        // The control: the column now compares case-sensitively.
        const [exact] = await app.adapter.executeQuery<{ n: number | string }>(
          "SELECT COUNT(*) AS n FROM nextly_releases WHERE title LIKE '%spring%'"
        );
        expect(Number(exact.n)).toBe(0);

        const page = await repo.findReleasePage({
          tab: "drafts",
          now,
          search: "spring",
          limit: 10,
        });
        expect(page.rows.map(row => row.title)).toEqual(["Spring launch"]);
      }
    );

    it("counts a tab without reading its rows", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      await seedOneOfEach(repo, now);

      expect(await repo.countReleases({ tab: "attention", now })).toBe(2);
      expect(await repo.countReleases({ tab: "upcoming", now })).toBe(2);
      expect(
        await repo.countReleases({ tab: "attention", now, search: "stop" })
      ).toBe(1);
      // Each part of Needs attention alone: what a dashboard counting overdue
      // releases asks, answered from the tab's own definition of overdue.
      expect(
        await repo.countReleases({ tab: "attention", reason: "overdue", now })
      ).toBe(1);
      expect(
        await repo.countReleases({ tab: "attention", reason: "stopped", now })
      ).toBe(1);
      const overdue = await repo.findReleasePage({
        tab: "attention",
        reason: "overdue",
        now,
        limit: 10,
      });
      expect(overdue.rows.map(row => row.title)).toEqual(["Overdue"]);
      expect(overdue.total).toBe(1);
    });

    it("returns a release's members in the order they were added", async () => {
      // Added within one second, which on SQLite is ONE stored instant: the
      // creation time alone cannot order them there, so the id has to carry
      // the order they were added in.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Ordered" });
      const added: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const member = await repo.addMember(
          {
            releaseId: release.id,
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: `e${i}`,
            locale: null,
            action: "publish",
          },
          ANY_EDITABLE_STATE
        );
        added.push(member.id);
      }

      const members = await repo.listMembers(release.id);
      expect(members.map(member => member.id)).toEqual(added);
    });

    it("orders members by when they were added, then by id, whatever order the rows were written in", async () => {
      // 🔴 The rows are WRITTEN against their keys: same creation instant, ids
      // inserted in descending order, and the earliest member written last. A
      // read with no ORDER BY returns them as written on a small table, so
      // only the declared order (creation time, then id) gives this answer.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const release = await repo.createRelease({ title: "Ordered" });
      const same = new Date("2026-01-01T09:00:00Z");
      const earlier = new Date("2026-01-01T08:00:00Z");
      const ids = Array.from(
        { length: 5 },
        (_, i) => `00000000-0000-7000-8000-00000000010${i}`
      );
      for (const id of [...ids].reverse()) {
        await insertMember(app, release.id, id, `t${id.slice(-1)}`, same);
      }
      const first = "00000000-0000-7000-8000-0000000001ff";
      await insertMember(app, release.id, first, "first", earlier);

      const members = await repo.listMembers(release.id);
      expect(members.map(member => member.id)).toEqual([first, ...ids]);
    });

    it("lists drafts newest first, and done releases most recently finished first", async () => {
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      for (const title of ["First draft", "Second draft", "Third draft"]) {
        await repo.createRelease({ title });
      }
      const older = await repo.createRelease({ title: "Shipped long ago" });
      const olderAt = new Date(now.getTime() - 10 * DAY);
      await scheduleAsItStands(repo, older.id, olderAt, "UTC");
      await repo.markReleasePublished(older.id, olderAt);
      const newer = await repo.createRelease({ title: "Shipped yesterday" });
      const newerAt = new Date(now.getTime() - DAY);
      await scheduleAsItStands(repo, newer.id, newerAt, "UTC");
      await repo.markReleasePublished(newer.id, newerAt);

      const drafts = await repo.findReleasePage({
        tab: "drafts",
        now,
        limit: 10,
      });
      expect(drafts.rows.map((row: ReleaseRow) => row.title)).toEqual([
        "Third draft",
        "Second draft",
        "First draft",
      ]);
      const done = await repo.findReleasePage({ tab: "done", now, limit: 10 });
      expect(done.rows.map((row: ReleaseRow) => row.title)).toEqual([
        "Shipped yesterday",
        "Shipped long ago",
      ]);
    });

    it("lists the scheduled releases soonest first when the caller names no order", async () => {
      // The Direct API's own default, not the repository's. Created furthest
      // out first, so neither creation order nor the old latest-first default
      // can produce the expected answer.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      for (const [title, days] of [
        ["In a month", 30],
        ["Next week", 7],
        ["Tomorrow", 1],
      ] as const) {
        const release = await repo.createRelease({ title });
        await scheduleAsItStands(
          repo,
          release.id,
          new Date(now.getTime() + days * DAY),
          "UTC"
        );
      }

      const found = await app.nextly.releases.find({ state: "scheduled" });
      expect(found.items.map(row => row.title)).toEqual([
        "Tomorrow",
        "Next week",
        "In a month",
      ]);

      // A caller who chooses an order gets it.
      const latest = await app.nextly.releases.find({
        state: "scheduled",
        order: "latest",
      });
      expect(latest.items.map(row => row.title)).toEqual([
        "In a month",
        "Next week",
        "Tomorrow",
      ]);
    });

    it("pages a tab and a search through the Direct API with the true total", async () => {
      // The service and the namespace on top of the repository: the page
      // arithmetic, the tab and the search reach the database together, and
      // `meta` describes the whole result rather than the page.
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const now = new Date();
      for (let i = 0; i < 5; i += 1) {
        const release = await repo.createRelease({ title: `Autumn ${i}` });
        await scheduleAsItStands(
          repo,
          release.id,
          new Date(now.getTime() + (i + 1) * DAY),
          "UTC"
        );
      }
      const other = await repo.createRelease({ title: "Winter" });
      await scheduleAsItStands(
        repo,
        other.id,
        new Date(now.getTime() + DAY),
        "UTC"
      );

      const second = await app.nextly.releases.find({
        tab: "upcoming",
        search: "autumn",
        page: 2,
        limit: 2,
      });
      expect(second.items.map(row => row.title)).toEqual([
        "Autumn 2",
        "Autumn 3",
      ]);
      expect(second.meta).toEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
      await expect(
        app.nextly.releases.count({ tab: "upcoming", search: "autumn" })
      ).resolves.toBe(5);
    });

    it("answers not found for the members and problems of a release that does not exist", async () => {
      // An empty list is also the true answer for a release with no members, so
      // the control matters: a real, empty release must still answer [].
      const app = await boot(dialect);
      const repo = new ReleasesRepository(app.adapter);
      const empty = await repo.createRelease({ title: "Empty" });
      expect(
        await app.nextly.releases.listMembers({ releaseId: empty.id })
      ).toEqual([]);
      expect(
        await app.nextly.releases.blockingReasons({ releaseId: empty.id })
      ).toEqual([]);

      const missing = "00000000-0000-7000-8000-0000000000ff";
      await expect(
        app.nextly.releases.listMembers({ releaseId: missing })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        app.nextly.releases.blockingReasons({ releaseId: missing })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  }
);
