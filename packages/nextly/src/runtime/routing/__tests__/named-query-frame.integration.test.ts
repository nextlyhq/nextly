/**
 * Inside a page builder named query's frame, the Direct API answers no call
 * at all: a trusted read, a read naming a user, a namespace call and even an
 * anonymous visitor's read are refused, since any of them would bypass the
 * reader the query is handed. Only that reader reads, through its frame's
 * door, and the door is no way out for code inside the frame. Outside it,
 * nothing changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openNamedQueryFrame } from "../../../auth/named-query-scope";
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

    it("refuses every Direct API call made inside the frame, a visitor's read included", async () => {
      const frame = openNamedQueryFrame("notes.all");
      const inside = (call: () => Promise<unknown>) =>
        outcome(() => frame.run(call));
      expect(await inside(() => t.nextly.find({ collection: SLUG }))).toBe(
        "named-query-trusted-read"
      );
      expect(
        await inside(() =>
          t.nextly.find({
            collection: SLUG,
            overrideAccess: false,
            user: { id: "someone" },
          })
        )
      ).toBe("named-query-trusted-read");
      // An anonymous visitor's read, outside the reader the query is handed:
      // undeclared, uncounted and untagged, so refused all the same.
      expect(
        await inside(() =>
          t.nextly.find({
            collection: SLUG,
            overrideAccess: false,
            user: undefined,
          })
        )
      ).toBe("named-query-trusted-read");
      expect(
        await inside(() => t.nextly.findSingle({ slug: "anything" }))
      ).toBe("named-query-trusted-read");
      expect(await inside(() => t.nextly.users.find({}))).toBe(
        "named-query-trusted-read"
      );
      // The instance's own services, reached through its getters: refused
      // before the getter hands the service out, so a trusted list read
      // made through one by mistake never starts.
      expect(
        await inside(async () =>
          t.nextly.collectionsHandler.listEntries({
            collectionName: SLUG,
            overrideAccess: true,
          } as never)
        )
      ).toBe("named-query-trusted-read");
      expect(
        await inside(async () => {
          void t.nextly.userService;
          await Promise.resolve();
        })
      ).toBe("named-query-trusted-read");
      // The public reader called by code inside the frame, not through the
      // frame's door, is refused too.
      const reader = createPublicReader(t.nextly);
      expect(await inside(() => reader.find({ collection: SLUG }))).toBe(
        "named-query-trusted-read"
      );
    });

    it("lets no code inside the frame open a door of its own", async () => {
      const frame = openNamedQueryFrame("notes.all");
      const trusted = () => t.nextly.find({ collection: SLUG });
      // A frame of its own, to walk through its door: refused.
      expect(
        await outcome(() =>
          frame.run(() => {
            const own = openNamedQueryFrame("mine");
            return own.run(() => own.read(trusted));
          })
        )
      ).toBe("named-query-trusted-read");
      // Another frame's door, from inside this one: refused.
      expect(
        await outcome(() =>
          frame.run(() => openNamedQueryFrame("mine").read(trusted))
        )
      ).toBe("named-query-trusted-read");
    });

    it("answers the reader through its frame's door, as a visitor reads", async () => {
      const frame = openNamedQueryFrame("notes.all");
      const reader = createPublicReader(t.nextly);
      const read = await frame.run(() =>
        frame.read(() => reader.find({ collection: SLUG }))
      );
      expect(read.items.map(item => item.title)).toEqual(["kept"]);
      expect(JSON.stringify(read.items)).not.toContain("SENTINEL");
    });

    it("leaves a trusted read, and the instance's services, outside the frame as they were", async () => {
      const read = await t.nextly.find({ collection: SLUG });
      expect(JSON.stringify(read.items)).toContain("SENTINEL");
      // The getter the frame refuses hands the service out outside it.
      expect(typeof t.nextly.collectionsHandler.listEntries).toBe("function");
      expect(t.nextly.userService).toBeDefined();
    });
  }
);
