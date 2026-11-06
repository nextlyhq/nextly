/**
 * Inside a page builder named query's frame, the Direct API answers only a
 * call that reads as an anonymous visitor: the public reader's reads pass,
 * and a trusted read, a read naming a user and a namespace call are refused.
 * Outside it, nothing changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runInsideNamedQuery } from "../../../auth/named-query-scope";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createPublicReader } from "../public-reader";

const SLUG = "nqf_notes";

/** The reason a refusal logs, or "passed" when the call went through. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "passed";
  } catch (error) {
    const reason = (error as { logContext?: { reason?: unknown } }).logContext
      ?.reason;
    return typeof reason === "string" ? reason : String(error);
  }
}

describe.each(getConfiguredTestDialects())(
  "a named query's frame (%s)",
  dialect => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "note", access: { read: () => false } }),
            ],
          }),
        ],
      });
      await t.nextly.create({
        collection: SLUG,
        data: { title: "kept", note: "SENTINEL", status: "published" },
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("refuses a trusted read, a read naming a user and a namespace call", async () => {
      const inside = (call: () => Promise<unknown>) =>
        outcome(() => runInsideNamedQuery("notes.all", call));
      expect(await inside(() => t.nextly.find({ collection: SLUG }))).toBe(
        "named-query-trusted-read"
      );
      expect(
        await inside(() =>
          t.nextly.find({ collection: SLUG, overrideAccess: true })
        )
      ).toBe("named-query-trusted-read");
      expect(
        await inside(() =>
          t.nextly.find({
            collection: SLUG,
            overrideAccess: false,
            user: { id: "someone" },
          })
        )
      ).toBe("named-query-trusted-read");
      expect(
        await inside(() => t.nextly.findSingle({ slug: "anything" }))
      ).toBe("named-query-trusted-read");
      expect(await inside(() => t.nextly.users.find({}))).toBe(
        "named-query-trusted-read"
      );
    });

    it("answers the public reader inside the frame, as a visitor reads", async () => {
      const reader = createPublicReader(t.nextly);
      const read = await runInsideNamedQuery("notes.all", () =>
        reader.find({ collection: SLUG })
      );
      expect(read.items.map(item => item.title)).toEqual(["kept"]);
      expect(JSON.stringify(read.items)).not.toContain("SENTINEL");
    });

    it("leaves a trusted read outside the frame as it was", async () => {
      const read = await t.nextly.find({ collection: SLUG });
      expect(JSON.stringify(read.items)).toContain("SENTINEL");
    });
  }
);
