/**
 * Every pooled MySQL connection the adapter opens serves UTC, whatever zone
 * the server itself runs in.
 *
 * The adapter never pinned a session's `time_zone`, so it was whatever the
 * server starts a connection with — `SYSTEM` on the test containers, anything
 * on a self-hosted server — and three behaviours followed it: a write bound a
 * UTC wall-clock string that the session then interpreted in its own zone, a
 * timeseries window compared `from_unixtime` bounds (an absolute instant
 * rendered in the session zone) against rows whose stored instant had been
 * shifted by that same zone, and a session answered differently from the way
 * a UTC session reads the very same rows.
 *
 * This lane runs against a server STARTED in an explicit non-UTC zone
 * (`TEST_MYSQL_URL_NON_UTC`), whose zone is asserted before anything reads a
 * session zone: a `SYSTEM` answer alone proves nothing, because a container
 * whose zone configuration was ignored still answers `SYSTEM` while resolving
 * to UTC. Everything is seeded through the normal write path, and the
 * expectations are NAMED rather than compared only against a second run — a
 * shifted answer that agreed with a shifted control would satisfy an equality
 * check between them.
 */

import { createConnection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";

import { date, defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// The boot provisions a database and pushes the whole schema over the wire to
// a throwaway container this lane started cold; the shared lane's 30-second
// hook budget measures a warmed container.
vi.setConfig({ hookTimeout: 180_000 });

/** The server this lane runs against; absent, there is no lane. */
const SERVER_URL = process.env.TEST_MYSQL_URL_NON_UTC;

/** The zone the server was started with, and its offset in seconds. */
const SERVER_ZONE = "+05:30";
const SERVER_OFFSET_SECONDS = 19800;

const SLUG = "tz_clock";
/** The provisioned table a collection lands in (collection-registry prefix). */
const TABLE = `dc_${SLUG}`;
const ANCHOR = new Date("2026-03-05T00:00:00.000Z");
const WINDOW_FILTER_BOUND = "2026-03-03T00:00:00.000Z";
const LIST_FILTER_BOUND = "2026-03-04T10:00:00.000Z";
const WRITTEN_INSTANT = "2026-03-04T12:00:00.000Z";

/**
 * The rows the app writes. `edge` sits THREE HOURS above the window's start —
 * inside the server's five-and-a-half-hour offset — so an unpinned window
 * scan misses it, while every row clears the filters that ride along.
 */
const SEED_ROWS = [
  { label: "edge", day: "2026-03-04T03:00:00.000Z" },
  { label: "listed", day: WRITTEN_INSTANT },
  { label: "below-bound", day: "2026-03-04T09:30:00.000Z" },
  { label: "after-window", day: "2026-03-05T02:00:00.000Z" },
] as const;

const clock = () =>
  defineCollection({
    slug: SLUG,
    fields: [text({ name: "label" }), date({ name: "day" })],
  });

let t: TestNextly | undefined;
/**
 * The database the BOOTED app actually landed on, asked of the app itself
 * rather than read from the environment: the harness's recovery path can
 * leave `DATABASE_URL` naming a database that is not the one the app settled
 * on.
 */
let provisionedUrl: string | undefined;

afterAll(async () => {
  await t?.destroy();
  t = undefined;
});

/** A raw session to the provisioned database, outside the app's pool. */
async function rawSession(zone?: string) {
  const connection = await createConnection(provisionedUrl);
  if (zone) await connection.query(`SET time_zone = '${zone}'`);
  return connection;
}

/** Reads a row's day back as the SESSION's wall clock, with no driver parsing. */
async function wallClockAt(zone: string, label: string): Promise<string> {
  const session = await rawSession(zone);
  try {
    const [rows] = await session.query(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d %H:%i:%s') AS s FROM \`${TABLE}\` WHERE label = ?`,
      [label]
    );
    return (rows as Array<{ s: string }>)[0]?.s;
  } finally {
    await session.end();
  }
}

const describeOrSkip = SERVER_URL ? describe : describe.skip;

describeOrSkip("a MySQL session the adapter opens, on a non-UTC server", () => {
  beforeAll(async () => {
    // The lane's premise, asserted before any session zone is read: this
    // server really starts its connections at +05:30. A container whose zone
    // configuration was ignored answers `SYSTEM` while resolving to UTC, and
    // every case below would pass on it for the wrong reason.
    const control = await createConnection(SERVER_URL);
    try {
      const [rows] = await control.query(
        "SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds"
      );
      expect(
        Number((rows as Array<{ offset_seconds: number }>)[0]?.offset_seconds)
      ).toBe(SERVER_OFFSET_SECONDS);
    } finally {
      await control.end();
    }

    t = await createTestNextly({
      dialect: "mysql",
      serverUrl: SERVER_URL,
      collections: [clock()],
    });
    const [dbRow] = await t.adapter.executeQuery<{ db: string }>(
      "SELECT DATABASE() AS db"
    );
    const url = new URL(SERVER_URL!);
    url.pathname = `/${dbRow!.db}`;
    provisionedUrl = url.toString();

    for (const row of SEED_ROWS) {
      await t.nextly.create({ collection: SLUG, data: { ...row } });
    }
  });

  it("answers +00:00 on the first connections, the flooded ones and a replacement", async () => {
    const adapter = t!.adapter;

    // The pool's first connections — the ones `connect()` itself opens for
    // its smoke test sit beside these.
    for (let at = 0; at < 3; at++) {
      const [row] = await adapter.executeQuery<{ tz: string }>(
        "SELECT @@session.time_zone AS tz"
      );
      expect(row?.tz).toBe("+00:00");
    }

    // Past the pool's initial connections: twelve concurrent reads held open
    // with a sleep force every connection the pool can hold (ten) to open,
    // each pinned the moment it connected.
    const flood =
      "SELECT SLEEP(0.5) AS s, @@session.time_zone AS tz, CONNECTION_ID() AS cid";
    const first = await Promise.all(
      Array.from({ length: 12 }, () =>
        adapter.executeQuery<{ tz: string; cid: number }>(flood)
      )
    );
    const answered = first.flat().filter(row => row?.tz !== undefined);
    expect(answered.length).toBeGreaterThanOrEqual(10);
    expect(new Set(answered.map(row => row.cid)).size).toBe(10);
    expect(answered.every(row => row.tz === "+00:00")).toBe(true);

    // A replacement: kill one pooled connection server-side, then load the
    // pool again. The dead connection is discarded and the pool opens a new
    // one for the requests still waiting — the pin has to survive that, and
    // the proof has to name a connection the pool had never held before the
    // kill: twelve concurrent requests against nine healthy connections and
    // a limit of ten cannot be served any other way.
    const beforeKill = new Set(answered.map(row => row.cid));
    const killed = answered[0]!.cid;
    const control = await createConnection(SERVER_URL);
    try {
      await control.query(`KILL ${killed}`);
    } finally {
      await control.end();
    }
    const afterKill = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        adapter.executeQuery<{ tz: string; cid: number }>(flood)
      )
    );
    const survived = afterKill
      .filter(r => r.status === "fulfilled")
      .map(r => r.value.flat())
      .flat()
      .filter(row => row?.tz !== undefined);
    // At least the ten healthy connections answer; the killed one may take
    // the one request that found it with it.
    expect(survived.length).toBeGreaterThanOrEqual(9);
    expect(survived.every(row => row.tz === "+00:00")).toBe(true);
    expect(survived.every(row => row.cid !== killed)).toBe(true);
    const replacements = survived.filter(row => !beforeKill.has(row.cid));
    expect(replacements.length).toBeGreaterThanOrEqual(1);
    expect(replacements.every(row => row.tz === "+00:00")).toBe(true);
  });

  it("a withSession of its own serves UTC too, outside the pool", async () => {
    // R-1 is every session the adapter opens, not only the pooled ones: a
    // connection `withSession` opens never meets the pool's `connection`
    // listener, so the adapter pins it itself, before its work runs. Its
    // driver already parses in UTC; without the pin a session in the
    // server's zone beside it shifts every value a round-trip fails to
    // cancel.
    const rows = await (
      t!.adapter as unknown as {
        withSession: <R>(
          work: (session: {
            execute: <T = unknown>(sql: string) => Promise<T[]>;
          }) => Promise<R>
        ) => Promise<R>;
      }
    ).withSession(session =>
      session.execute<{ tz: string }>("SELECT @@session.time_zone AS tz")
    );
    expect(rows[0]?.tz).toBe("+00:00");
  });

  it("writes the instant an entry names, so a UTC session reads exactly that", async () => {
    // The write bound a UTC wall-clock string, and an unpinned session
    // interpreted it in its own zone — the row below would be STORED five and
    // a half hours early, which a UTC session then reads shifted while the
    // session that wrote it cancels the shift on its own reads. Named, not
    // compared against the app's own read-back: that read-back agrees in
    // both phases, which is precisely why the corruption hid.
    expect(await wallClockAt("+00:00", "listed")).toBe("2026-03-04 12:00:00");
  });

  it("a date filter returns the rows a UTC session names", async () => {
    const handler = t!.getService("collectionsHandler") as unknown as {
      listEntries: (p: Record<string, unknown>) => Promise<{
        success: boolean;
        data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
      }>;
    };
    const listed = await handler.listEntries({
      collectionName: SLUG,
      overrideAccess: true,
      where: { day: { greater_than: LIST_FILTER_BOUND } },
    });
    // `listed` (12:00Z) and `after-window` (Mar 5 02:00Z) are past the bound;
    // `below-bound` misses it by thirty minutes — a row whose stored instant
    // sits INSIDE the server's offset, so a comparison read in the session
    // zone would have pulled it in.
    const labels = (listed.data?.docs ?? []).map(d => d.label as string);
    expect(labels.sort()).toEqual(["after-window", "listed"]);
    expect(listed.data?.totalDocs).toBe(2);
  });

  it("a timeseries window counts every in-window row, boundary rows included", async () => {
    const handler = t!.getService("collectionsHandler") as unknown as {
      timeseriesEntries: (p: Record<string, unknown>) => Promise<{
        success: boolean;
        data: { points: { start: string; count: number }[] } | null;
      }>;
    };
    const series = await handler.timeseriesEntries({
      collectionName: SLUG,
      overrideAccess: true,
      dateField: "day",
      interval: "day",
      intervals: 2,
      now: ANCHOR,
      where: { day: { greater_than: WINDOW_FILTER_BOUND } },
    });
    expect(series.success).toBe(true);
    // The window is the two days ending with the anchor's own bucket:
    // [2026-03-04 00:00Z, 2026-03-06 00:00Z), and the filter keeps every
    // seeded row inside it. `edge` is three hours past the window's start —
    // inside the server's offset — so a scan comparing against `from_unixtime`
    // while the session shifts stored rows past it drops it from the answer.
    // `after-window` is a day after the anchor and counts in its own bucket.
    expect(series.data?.points).toEqual([
      { start: "2026-03-04T00:00:00.000Z", count: 3 },
      { start: "2026-03-05T00:00:00.000Z", count: 1 },
    ]);
  });

  it("rows written before the pin read as the instants they were stored as", async () => {
    // A row written BEFORE this change, the way the unpinned adapter wrote
    // it: a UTC wall-clock string handed to a session the server started at
    // +05:30. Stored as 06:30Z — the instant the write stored it as — and a
    // pinned session must read exactly that. The unpinned adapter read it
    // back as 12:00Z instead, the caller's instant reconstituted by a session
    // shift cancelling a driver parse; the measured before-and-after of that
    // cancel is what the pull request documents.
    await t!.nextly.create({
      collection: SLUG,
      data: { label: "pre-pin", day: WRITTEN_INSTANT },
    });
    const session = await rawSession(SERVER_ZONE);
    try {
      await session.query("UPDATE ?? SET day = ? WHERE label = ?", [
        TABLE,
        "2026-03-04 12:00:00",
        "pre-pin",
      ]);
    } finally {
      await session.end();
    }

    const [row] = await t!.adapter.executeQuery<{ day: string | Date }>(
      `SELECT day FROM \`${TABLE}\` WHERE label = 'pre-pin'`
    );
    expect(new Date(row!.day as string).toISOString()).toBe(
      "2026-03-04T06:30:00.000Z"
    );
  });

  it("keeps a caller's non-UTC driver zone agreeing with the pinned session", async () => {
    // R-1's agreement rule: a caller configured mysql2's driver-level
    // `timezone` to a zone that is not UTC, and the configuration is ALIGNED
    // to the pinned session (the pull request states which). The evidence is
    // behaviour, not config: a Date written through this adapter round-trips
    // exactly, and a session-zone computation over it agrees with the UTC
    // wall clock the write stored.
    const adapter = createMySqlAdapter({
      url: provisionedUrl,
      timezone: SERVER_ZONE,
    });
    await adapter.connect();
    try {
      await adapter.executeQuery(
        "CREATE TABLE IF NOT EXISTS tz_driver_probe (d TIMESTAMP NULL)"
      );
      const written = new Date("2026-03-04T08:15:00.000Z");
      await adapter.executeQuery("DELETE FROM tz_driver_probe");
      await adapter.executeQuery("INSERT INTO tz_driver_probe (d) VALUES (?)", [
        written,
      ]);
      const [roundTrip] = await adapter.executeQuery<{ d: string | Date }>(
        "SELECT d FROM tz_driver_probe"
      );
      expect(new Date(roundTrip!.d as string).toISOString()).toBe(
        written.toISOString()
      );
      // `UNIX_TIMESTAMP` reads a TIMESTAMP in the SESSION zone; on the pinned
      // session it must answer the written instant's own epoch seconds, not a
      // wall clock reinterpreted in the zone the caller configured.
      const [epoch] = await adapter.executeQuery<{ e: number }>(
        "SELECT UNIX_TIMESTAMP(d) AS e FROM tz_driver_probe"
      );
      expect(Number(epoch!.e)).toBe(Math.floor(written.getTime() / 1000));
    } finally {
      await adapter.executeQuery("DROP TABLE IF EXISTS tz_driver_probe");
      await adapter.disconnect();
    }
  });
});
