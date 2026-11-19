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
  }
);
