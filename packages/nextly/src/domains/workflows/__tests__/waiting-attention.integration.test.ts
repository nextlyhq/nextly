/**
 * The dashboard's Needs attention card counts "Waiting for your review" (R-11): the parts whose next
 * step the reader may take and that wait for them, counted by the waiting list's own rule, linked to
 * the waiting view. A reader nothing waits for sees no such item, on every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import type { AttentionDigestItem } from "../../widgets/attention/digest-item";
import type { WidgetQuery } from "../../widgets/query";
import { sourceResolver } from "../../widgets/resolved-sources";
import { ATTENTION_SOURCE_ID } from "../../widgets/system-source-ids";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { workflowDefinitionHash } from "../hash";

import {
  bootSteps,
  entry,
  partOf,
  person,
  seedState,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const DIGEST: WidgetQuery = {
  source: ATTENTION_SOURCE_ID,
  op: "list",
  limit: 50,
};

/** The digest `caller` is answered. */
async function digestFor(caller: ReadCaller): Promise<AttentionDigestItem[]> {
  const resolve = sourceResolver(ATTENTION_SOURCE_ID);
  if (!resolve) throw new Error("system:attention is not registered");
  const result = await resolve(DIGEST, caller);
  if (result.op !== "list") throw new Error(result.op);
  return result.items as unknown as AttentionDigestItem[];
}

describe.each(getConfiguredTestDialects())(
  "Waiting for your review in Needs attention (%s)",
  dialect => {
    it("counts what waits for the reader, linked to the waiting view, and nothing for anyone else", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      await person(t, "reader", [["read", "pages"]]);
      for (let n = 0; n < 2; n += 1) {
        await seedState(
          t,
          partOf("pages", await entry(t, "pages"), null),
          "legal",
          {
            definitionHash: HASH,
          }
        );
      }

      const forSam = await digestFor({ user: { id: "sam" } });
      expect(forSam).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "core/waiting-for-review",
            label: "Waiting for your review",
            count: 2,
            link: "content/waiting",
          }),
        ])
      );
      const forReader = await digestFor({ user: { id: "reader" } });
      expect(
        forReader.find(item => item.id === "core/waiting-for-review")
      ).toBeUndefined();
    });
  }
);
