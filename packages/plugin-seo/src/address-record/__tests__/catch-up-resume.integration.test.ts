/**
 * The address record's catch-up stopped part-way, between one page and the
 * next, and gone on with by the next run: what the stopped run did stands,
 * the next run does not do it again, and the record ends as one whole run
 * would leave it, its fingerprint stored only then.
 *
 * A request that cannot answer without the record runs the catch-up itself,
 * awaited, and stops it by its own deadline, so the run has settled when the
 * answer is sent: on a serverless platform nothing runs between requests,
 * and a transaction left open then would be ended by the database. The next
 * request goes on at once.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seoPlugin } from "../../plugin";
import {
  RECORD_WAIT_MS,
  addressRecordReady,
  addressRecordReadyWithin,
  catchUp,
  lastCatchUp,
} from "../catch-up";
import { noteKey } from "../store";

import { forgetRecord, noteRows, recordedRows } from "./record-tables";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

/**
 * How long each page's claim takes, by the clock, while `ticking`: a plugin
 * told of every claim moves the clock on, standing for a slow page.
 */
const clock = { ticking: false, perClaimMs: 2000 };

/** A plugin taking part in the address record, moving the clock on each claim. */
const slowPages = definePlugin({
  name: "@test/slow-pages",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.publicAddresses.participate({
      holderOf: async () => null,
      record: async () => {
        if (clock.ticking) vi.setSystemTime(Date.now() + clock.perClaimMs);
      },
    });
  },
});

const SLUGS = ["a", "b", "c", "d", "e"];

/**
 * A site of five published pages, then its record emptied, as on a site the
 * plugin has just been added to; answers what the record held before, as a
 * whole run would record it.
 */
async function behindSite(
  dialect: TestDialect
): Promise<Record<string, string>> {
  current = await createTestNextly({
    dialect,
    plugins: [seoPlugin({ collections: ["pages"] }), slowPages],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
    ],
  });
  await lastCatchUp();
  for (const slug of SLUGS) {
    await current.nextly.create({
      collection: "pages",
      data: { title: slug, slug, status: "published" },
    });
  }
  const whole = await recordedRows();
  expect(Object.keys(whole)).toHaveLength(SLUGS.length);
  await forgetRecord();
  return whole;
}

/** Whether the fingerprint of a finished run is stored. */
async function fingerprintStored(): Promise<boolean> {
  const key = noteKey("fingerprint");
  return (await noteRows()).some(row => row.noteKey === key);
}

describe.each(getConfiguredTestDialects())(
  "the address record's catch-up gone on with part by part (%s)",
  dialect => {
    it("goes on from where a stopped run left off, ending as a whole run would", async () => {
      const whole = await behindSite(dialect);

      // Stopped before its third page's claim.
      let asked = 0;
      const first = await catchUp({ stopNow: () => ++asked > 2 });
      expect(first).toMatchObject({ ran: true, finished: false, recorded: 2 });
      expect(Object.keys(await recordedRows())).toHaveLength(2);
      expect(addressRecordReady()).toBe(false);
      expect(await fingerprintStored()).toBe(false);

      // The next run claims only the three left, and finishes.
      const next = await catchUp();
      expect(next).toMatchObject({ ran: true, finished: true, recorded: 3 });
      expect(await recordedRows()).toEqual(whole);
      expect(addressRecordReady()).toBe(true);
      expect(await fingerprintStored()).toBe(true);
    });

    it("is run by a request, stopped by its deadline with nothing left running, and gone on with by the next", async () => {
      const whole = await behindSite(dialect);
      // A run stopped before any claim: the record is behind, and the next
      // part is due at once.
      await catchUp({ stopNow: () => true });
      expect(Object.keys(await recordedRows())).toHaveLength(0);

      // Each claim takes two seconds by the clock: three fit before the
      // first request's deadline, and the run stops before the fourth.
      vi.useFakeTimers({ toFake: ["Date"] });
      clock.ticking = true;
      try {
        expect(clock.perClaimMs * 2).toBeLessThan(RECORD_WAIT_MS);
        expect(await addressRecordReadyWithin(RECORD_WAIT_MS)).toBe(false);
        // Settled by the time the request answers: no part of it runs on.
        let settled = false;
        void lastCatchUp()?.then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(true);
        expect(await lastCatchUp()).toMatchObject({
          finished: false,
          recorded: 3,
        });
        expect(Object.keys(await recordedRows())).toHaveLength(3);

        // The next request goes on at once, and the record is ready.
        expect(await addressRecordReadyWithin(RECORD_WAIT_MS)).toBe(true);
        expect(await lastCatchUp()).toMatchObject({
          finished: true,
          recorded: 2,
        });
      } finally {
        clock.ticking = false;
      }
      expect(await recordedRows()).toEqual(whole);
      expect(await fingerprintStored()).toBe(true);
    });
  }
);
