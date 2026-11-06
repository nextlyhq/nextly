/**
 * The set of entities a reader may read ends with `RULE_COULD_NOT_RUN` when an
 * entity's read rule could not run, naming that entity.
 *
 * `readableEntities` decides each entity on its own and settles them all, so
 * one decision that fails does not refuse the rest. A rule whose own query
 * waited out the bound for a database connection never answered, though, and
 * the plausible broken implementation, the one this had, treats it as any
 * other rejected decision: the entity is left out of the set, and the dashboard
 * built on it (`readableCollectionSlugs`) answers as if the reader could not
 * read that collection at all. The control is the same reader with the rule
 * answering, for whom the set holds both collections, and it shows the
 * fixture reaches the rule.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../config";
import { readableCollectionSlugs } from "../../domains/widgets/reader-content";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readAccessCaller, readableEntities } from "../entity-read-access";

const NOTES = "readablesetnotes";
const OPEN = "readablesetopen";
const READER = "readableset-reader";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Armed after seeding, so the boot never asks it. */
interface Probe {
  armed: boolean;
  calls: number;
}

async function boot(dialect: TestDialect, probe: Probe): Promise<ReadCaller> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        access: {
          // The rule's own query waited out the pool's bound, as the adapter
          // reports it.
          read: () => {
            if (!probe.armed) return true;
            probe.calls += 1;
            throw poolWaitTimeoutError(15_000);
          },
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: OPEN,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  // A rule only narrows a permission, so the reader holds both reads and the
  // rule is what decides.
  await userWhoMay(current, READER, "read", [NOTES, OPEN]);
  return { user: { id: READER } };
}

describe.each(getConfiguredTestDialects())(
  "a readable set whose entity's rule could not run (integration, %s)",
  dialect => {
    it("holds both collections while the rule answers", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const caller = await boot(dialect, probe);

      const readable = await readableEntities(
        [NOTES, OPEN],
        readAccessCaller(caller)
      );
      expect([...readable].sort()).toEqual([NOTES, OPEN].sort());
      expect(await readableCollectionSlugs(caller)).toEqual(
        expect.arrayContaining([NOTES, OPEN])
      );
    });

    it("ends naming the entity, rather than leaving it out of the set", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const caller = await boot(dialect, probe);

      probe.armed = true;
      const readable = await readableEntities(
        [NOTES, OPEN],
        readAccessCaller(caller)
      ).catch((error: unknown) => error);

      expect(probe.calls, JSON.stringify(readable)).toBeGreaterThan(0);
      expect(readable).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: NOTES },
      });
    });

    it("ends the dashboard's readable collections the same way", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const caller = await boot(dialect, probe);

      probe.armed = true;
      const slugs = await readableCollectionSlugs(caller).catch(
        (error: unknown) => error
      );

      expect(probe.calls, JSON.stringify(slugs)).toBeGreaterThan(0);
      expect(slugs).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: NOTES },
      });
    });
  }
);
