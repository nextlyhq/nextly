/**
 * Populating a relationship inside a component, whose target's read rule
 * could not run, ends the read with that answer: 503, `RULE_COULD_NOT_RUN`,
 * naming the target.
 *
 * The plausible broken implementation is the component populate's own catch:
 * not strict on a read, it took the expansion's failure for a component it
 * could not read and put a default in its place, so the entry came back 200
 * with the component missing. The control is the same read with the rule
 * answering, which populates the related row through the component, and shows
 * the fixture reaches the rule.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const PAGES = "cardreachpages";
const CARDS = "cardreachcards";
const CARD = "cardreachcard";
const READER = "cardreach-reader";

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
): Promise<{ handler: CollectionsHandler; cardId: string }> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: CARD,
        fields: [relationship({ name: "page", relationTo: PAGES })],
      }),
    ],
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
        slug: CARDS,
        access: { read: () => true },
        fields: [
          text({ name: "name" }),
          fieldGroup({ name: "card", component: CARD }),
        ],
      }),
    ],
  });
  await userWhoMay(current, READER, "read", [PAGES, CARDS]);
  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const page = await handler.createEntry(
    { collectionName: PAGES, overrideAccess: true },
    { title: "Carded page" }
  );
  const pageId = (page.data as { id: string }).id;
  const card = await handler.createEntry(
    { collectionName: CARDS, overrideAccess: true },
    { name: "c", card: { page: pageId } }
  );
  expect(card.success, JSON.stringify(card)).toBe(true);
  return { handler, cardId: (card.data as { id: string }).id };
}

function readAsReader(
  handler: CollectionsHandler,
  cardId: string
): Promise<unknown> {
  return handler
    .getEntry({
      collectionName: CARDS,
      entryId: cardId,
      // The component is one level and its relationship the next.
      depth: 2,
      user: { id: READER },
      routeAuthorized: true,
    })
    .catch((error: unknown) => error);
}

describe.each(getConfiguredTestDialects())(
  "a component's relationship whose target's read rule could not run (integration, %s)",
  dialect => {
    it("populates the related row through the component while the rule answers", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const { handler, cardId } = await boot(dialect, probe);

      const read = (await readAsReader(handler, cardId)) as {
        success?: boolean;
        data?: Record<string, unknown>;
      };

      expect(read.success, JSON.stringify(read)).toBe(true);
      expect(JSON.stringify(read.data?.card)).toContain("Carded page");
    });

    it("ends the read naming the target, not with the component missing", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const { handler, cardId } = await boot(dialect, probe);

      probe.armed = true;
      const read = await readAsReader(handler, cardId);

      expect(probe.calls, JSON.stringify(read)).toBeGreaterThan(0);
      expect(read).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: PAGES },
      });
    });
  }
);
