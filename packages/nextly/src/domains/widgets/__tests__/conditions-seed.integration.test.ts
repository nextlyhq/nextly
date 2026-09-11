/**
 * `seed:unanswered` against a real instance.
 *
 * The rule is one boolean and could be asked without a database; what cannot is
 * whether the evaluator REACHES the two flags the seed card writes. A reader
 * that resolved neither key reports the offer open forever — which on a fresh
 * install is also the right answer, so the assertions here move it.
 *
 * @module domains/widgets/__tests__/conditions-seed.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { evaluateConditions } from "../conditions";

const admin: ReadCaller = {
  user: { id: "admin-1", roles: ["admin"] },
};

type MetaWriter = { set: (key: string, value: unknown) => Promise<unknown> };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({ collections: [] });
  current = t;
  return t;
}

async function seedUnanswered(): Promise<boolean> {
  const verdicts = await evaluateConditions(
    new Set(["seed:unanswered"]),
    admin
  );
  return verdicts.get("seed:unanswered") === true;
}

/** Writes one meta flag through the same service the seed endpoint uses. */
async function setFlag(t: TestNextly, key: string): Promise<void> {
  const meta = t.getService("metaService") as unknown as MetaWriter;
  await meta.set(key, new Date().toISOString());
}

describe("seed:unanswered against a real instance", () => {
  it("holds while nobody has answered the offer", async () => {
    await boot();
    expect(await seedUnanswered()).toBe(true);
  });

  it("stops holding once the offer is DECLINED", async () => {
    // 🔴 The case the whole condition exists for. Declining creates no content,
    // so `content:empty` still holds afterwards -- and the card kept its slot
    // on the strength of that until this condition joined it.
    const t = await boot();
    await setFlag(t, "seed.skippedAt");

    expect(await seedUnanswered()).toBe(false);
  });

  it("stops holding once the offer is ACCEPTED", async () => {
    // The other way the offer closes. Asserted separately rather than assumed
    // symmetric: a reader checking only one key would pass the case above and
    // leave the card showing for everyone who actually seeded.
    const t = await boot();
    await setFlag(t, "seed.completedAt");

    expect(await seedUnanswered()).toBe(false);
  });

  it("is answered for the INSTALL, not for the reader who asks", async () => {
    // Unlike `content:empty`, this one is deliberately not reader-scoped: a
    // second admin arriving after the first declined must not be offered the
    // demo data again. Two different callers, one answer.
    const t = await boot();
    await setFlag(t, "seed.skippedAt");

    const other: ReadCaller = { user: { id: "editor-2", roles: ["editor"] } };
    const verdicts = await evaluateConditions(
      new Set(["seed:unanswered"]),
      other
    );

    expect(verdicts.get("seed:unanswered")).toBe(false);
  });
});
