/**
 * The waiting list reads until it finds its page, but never past a fixed number of review states in
 * one request: past that ceiling it says its count is a floor (`totalCapped`), never that nothing
 * more waits. Asked of `waitingFor` with a small ceiling, on every configured dialect, so the case
 * needs dozens of rows rather than the 20,000 the doors read up to.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { workflowDefinitionHash } from "../hash";
import { waitingFor, type WaitingQuery } from "../review-api";
import {
  encodeWaitingCursor,
  WaitingCursor,
  type WaitingPosition,
} from "../waiting-cursor";

import { bootSteps, partOf, person, seedState } from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

describe.each(getConfiguredTestDialects())(
  "the waiting list's scan ceiling (%s)",
  dialect => {
    it("stops at its ceiling and says more may wait, and reads to the end below it", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // 30 parts in Legal check, none of which the read check passes.
      for (let n = 0; n < 30; n += 1) {
        await seedState(t, partOf("posts", randomUUID(), null), "legal", {
          definitionHash: HASH,
        });
      }
      const query = (scanCeiling: number): WaitingQuery => ({
        caller: { kind: "user", userId: "sam" },
        limit: 5,
        offset: 0,
        readsEntity: () => Promise.resolve(true),
        readable: items => Promise.resolve(items.map(() => false)),
        scanCeiling,
      });

      const capped = await waitingFor(t.adapter, query(20));
      expect(capped).toMatchObject({ items: [], total: 0, totalCapped: true });

      const whole = await waitingFor(t.adapter, query(100));
      expect(whole).toMatchObject({ items: [], total: 0, totalCapped: false });
    });

    it("reaches readable work past more hidden parts than its ceiling, by following its cursor", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // 30 parts no one may read, all entering Legal check at one time (so their keys order
      // them), then 3 Sam may read, later: more hidden parts than one request reads.
      for (let n = 0; n < 30; n += 1) {
        await seedState(t, partOf("posts", randomUUID(), null), "legal", {
          definitionHash: HASH,
        });
      }
      const readable = new Set<string>();
      for (let n = 0; n < 3; n += 1) {
        const entryId = randomUUID();
        readable.add(entryId);
        await seedState(t, partOf("posts", entryId, null), "legal", {
          definitionHash: HASH,
          enteredAt: new Date("2030-01-01T00:00:00.000Z"),
        });
      }
      const query = (after?: WaitingPosition): WaitingQuery => ({
        caller: { kind: "user", userId: "sam" },
        limit: 5,
        offset: 0,
        readsEntity: () => Promise.resolve(true),
        readable: items =>
          Promise.resolve(
            items.map(item => readable.has(item.document.entryId))
          ),
        scanCeiling: 20,
        ...(after === undefined ? {} : { after }),
      });

      // The first request stops at its ceiling with nothing to show, and says where it stopped.
      const first = await waitingFor(t.adapter, query());
      expect(first).toMatchObject({ items: [], totalCapped: true });
      expect(first.next, "the first request names where it stopped").toEqual({
        // A position in the review states, not among the unmoved parts.
        source: "state",
        enteredAt: expect.any(Date),
        partKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      // Its position, as a client carries it: the opaque cursor, read back at the boundary.
      const cursor = WaitingCursor.parse(
        encodeWaitingCursor(first.next as WaitingPosition)
      );
      const second = await waitingFor(t.adapter, query(cursor));
      expect(second.items.map(item => item.document.entryId).sort()).toEqual(
        [...readable].sort()
      );
      expect(second).toMatchObject({ totalCapped: false, next: null });
    });

    it("reads no more than its ceiling when its own work and the rest both fill it", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // 15 parts assigned to Sam and 15 to someone who does not exist (so each waits for every
      // holder), entering Legal check in turn: both shares fit one window, interleaved.
      for (let n = 0; n < 15; n += 1) {
        for (const id of ["sam", "ghost"]) {
          await seedState(t, partOf("posts", randomUUID(), null), "legal", {
            definitionHash: HASH,
            enteredAt: new Date(Date.UTC(2026, 0, 1, 0, n)),
            assignee: { kind: "user", id },
          });
        }
      }
      let decided = 0;
      const capped = await waitingFor(t.adapter, {
        caller: { kind: "user", userId: "sam" },
        limit: 5,
        offset: 0,
        readsEntity: () => Promise.resolve(true),
        readable: items => {
          decided += items.length;
          return Promise.resolve(items.map(() => false));
        },
        scanCeiling: 20,
      });
      expect(
        decided,
        "review states the request read and decided"
      ).toBeLessThanOrEqual(20);
      expect(capped.totalCapped).toBe(true);
    });

    it("keeps to its last slot with a row left in each share, and reaches the other next", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // One part assigned to Sam and one to someone who does not exist (so it waits for every
      // holder): a row in each share, and a ceiling of one.
      const parts: string[] = [];
      for (const [minute, id] of ["sam", "ghost"].entries()) {
        const entryId = randomUUID();
        parts.push(entryId);
        await seedState(t, partOf("posts", entryId, null), "legal", {
          definitionHash: HASH,
          enteredAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
          assignee: { kind: "user", id },
        });
      }
      let decided = 0;
      const query = (after?: WaitingPosition): WaitingQuery => ({
        caller: { kind: "user", userId: "sam" },
        limit: 5,
        offset: 0,
        readsEntity: () => Promise.resolve(true),
        readable: items => {
          decided += items.length;
          return Promise.resolve(items.map(() => true));
        },
        scanCeiling: 1,
        ...(after === undefined ? {} : { after }),
      });

      const first = await waitingFor(t.adapter, query());
      expect(decided, "review states the first request decided").toBe(1);
      expect(first.items.map(item => item.document.entryId)).toEqual([
        parts[0],
      ]);
      expect(first.totalCapped).toBe(true);
      // The other row is reached from where the first request stopped: none is lost.
      const second = await waitingFor(
        t.adapter,
        query(first.next as WaitingPosition)
      );
      expect(second.items.map(item => item.document.entryId)).toEqual([
        parts[1],
      ]);
      expect(second.next).toBeNull();
    });
  }
);
