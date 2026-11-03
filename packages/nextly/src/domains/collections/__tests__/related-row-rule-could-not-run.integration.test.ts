/**
 * Populating a relationship whose target's read rule could not run ends the
 * read with that answer: 503, `RULE_COULD_NOT_RUN`, naming the target.
 *
 * Expansion asks the TARGET collection's read rule before it populates a
 * related row. A rule whose own query waited out the bound for a database
 * connection never answered, so the row is neither shown nor withheld.
 *
 * The plausible broken implementation is the one expansion had: each fetch
 * caught the failure and read the relationship as absent, so the parent came
 * back 200 with `page` holding nothing, and `findByID` with `disableErrors`
 * answered `null` as for a document that is not there. The control is the
 * same read with the rule answering, which populates the row, and shows the
 * fixture reaches the rule.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const PAGES = "rulereachpages";
const REFS = "rulereachrefs";
const READER = "rulereach-reader";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Armed after seeding, so the boot and the trusted writes never ask it. */
interface Probe {
  armed: boolean;
  calls: number;
}

async function boot(
  dialect: TestDialect,
  probe: Probe
): Promise<{ t: TestNextly; handler: CollectionsHandler; refId: string }> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: PAGES,
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
        slug: REFS,
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          relationship({ name: "page", relationTo: PAGES }),
        ],
      }),
    ],
  });
  // A rule only narrows a permission, so the reader holds both reads and the
  // target's rule is what decides.
  await userWhoMay(current, READER, "read", [PAGES, REFS]);
  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: PAGES, overrideAccess: true },
    { title: "Related page" }
  );
  const pageId = (page.data as { id: string }).id;
  const ref = await handler.createEntry(
    { collectionName: REFS, overrideAccess: true },
    { name: "r", page: pageId }
  );
  return { t: current, handler, refId: (ref.data as { id: string }).id };
}

/** The source read as the reader, populating one hop. */
function readAsReader(
  handler: CollectionsHandler,
  refId: string
): Promise<unknown> {
  return handler
    .getEntry({
      collectionName: REFS,
      entryId: refId,
      depth: 1,
      user: { id: READER },
      routeAuthorized: true,
    })
    .catch((error: unknown) => error);
}

describe.each(getConfiguredTestDialects())(
  "a relationship whose target's read rule could not run (integration, %s)",
  dialect => {
    it("populates the related row while the rule answers", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const { handler, refId } = await boot(dialect, probe);

      const read = (await readAsReader(handler, refId)) as {
        success?: boolean;
        data?: Record<string, unknown>;
      };

      expect(read.success, JSON.stringify(read)).toBe(true);
      expect(JSON.stringify(read.data?.page)).toContain("Related page");
    });

    it("ends the read naming the target, not with the relationship absent", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const { handler, refId } = await boot(dialect, probe);

      probe.armed = true;
      const read = await readAsReader(handler, refId);

      expect(probe.calls, JSON.stringify(read)).toBeGreaterThan(0);
      expect(read).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: PAGES },
      });
    });

    it("throws through findByID's disableErrors rather than answering null", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const { t, refId } = await boot(dialect, probe);

      probe.armed = true;
      const found = await t.nextly
        .findByID({
          collection: REFS,
          id: refId,
          depth: 1,
          overrideAccess: false,
          user: { id: READER },
          disableErrors: true,
        })
        .catch((error: unknown) => error);

      expect(probe.calls, JSON.stringify(found)).toBeGreaterThan(0);
      expect(found).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: PAGES },
      });
    });
  }
);
