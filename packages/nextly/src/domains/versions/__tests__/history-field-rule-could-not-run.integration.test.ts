/**
 * A version read whose field read rule could not run ends with that answer:
 * 503, `RULE_COULD_NOT_RUN`, naming the collection and the field.
 *
 * History applies the field read rules to a stored snapshot. A rule whose own
 * query waited out the bound for a database connection never answered, so the
 * field is neither shown nor hidden. The plausible broken implementations are
 * the two this path had: the snapshot's redaction caught the failure and
 * withheld every field carrying a read rule, handing back the version with
 * `guarded` listed as withheld; and the live read that gates the history read
 * the failed result as a fault and answered a 500 with nothing saying which
 * rule. A rule that throws for any other reason still withholds its field, as
 * `history-field-read-rules.integration.test.ts` covers. The control is the
 * same read with the rule answering, which shows the field, and shows the
 * fixture reaches the rule.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import { redactSnapshotForUser } from "../../../api/versions-access";
import { defineCollection, text } from "../../../config";
import { getVersionForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTS = "historyruleposts";
const READER = { id: "historyrule-reader", email: "reader@x.test" };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Armed after seeding, so the trusted writes never ask it. */
interface Probe {
  armed: boolean;
  calls: number;
}

/** A document saved twice, so it has two versions; its id. */
async function versionedDocument(
  dialect: TestDialect,
  probe: Probe
): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        versions: true,
        access: { read: () => true, update: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          text({
            name: "guarded",
            access: {
              // The rule's own query waited out the pool's bound, as the
              // adapter reports it.
              read: () => {
                if (!probe.armed) return true;
                probe.calls += 1;
                throw poolWaitTimeoutError(15_000);
              },
            },
          }),
        ],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "T1", guarded: "G-1" }
  );
  const id = (created.data as { id: string }).id;
  await handler.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true },
    { title: "T2", guarded: "G-2" }
  );
  return id;
}

const firstVersionOf = (id: string) => ({
  scopeKind: "collection" as const,
  slug: POSTS,
  entryId: id,
  user: READER,
  versionNo: 1,
});

describe.each(getConfiguredTestDialects())(
  "a version read whose field rule could not run (integration, %s)",
  dialect => {
    it("shows the field while the rule answers", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const id = await versionedDocument(dialect, probe);

      const version = await getVersionForDocument(firstVersionOf(id));

      expect(JSON.stringify(version)).toContain("G-1");
      expect(version.withheld).not.toContain("guarded");
    });

    it("ends the snapshot's redaction naming the field, not withholding it", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      await versionedDocument(dialect, probe);

      probe.armed = true;
      const redacted = await redactSnapshotForUser(
        { title: "T1", guarded: "G-1" },
        "collection",
        POSTS,
        READER
      ).catch((error: unknown) => error);

      expect(probe.calls, JSON.stringify(redacted)).toBeGreaterThan(0);
      expect(redacted).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: POSTS, field: "guarded" },
      });
    });

    it("ends the version read naming the field, not with a 500 or the field withheld", async () => {
      const probe: Probe = { armed: false, calls: 0 };
      const id = await versionedDocument(dialect, probe);

      probe.armed = true;
      const version = await getVersionForDocument(firstVersionOf(id)).catch(
        (error: unknown) => error
      );

      expect(probe.calls, JSON.stringify(version)).toBeGreaterThan(0);
      expect(version).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: POSTS, field: "guarded" },
      });
    });
  }
);
