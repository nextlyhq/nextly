/**
 * History fails closed when its read rules cannot be evaluated at all: a
 * version read withholds every field carrying a rule and names it, and a
 * restore is refused rather than applied with values the caller may not read.
 *
 * The read pass is made to fail over version 1's content only (title "T1"),
 * so the document gate, which reads the live document ("T2"), runs as usual.
 * A single rule that throws is already judged a denial inside the pass; this
 * is the case where the pass itself does not complete.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { getVersionForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { restoreVersion } from "../restore-version";

const state = vi.hoisted(() => ({ failReads: false }));

vi.mock("../../../shared/lib/field-level-registry", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../../shared/lib/field-level-registry")
    >();
  return {
    ...actual,
    applyFieldReadAccess: (
      ...args: Parameters<typeof actual.applyFieldReadAccess>
    ) =>
      state.failReads && args[0].entry.title === "T1"
        ? Promise.reject(new Error("read rules unavailable"))
        : actual.applyFieldReadAccess(...args),
  };
});

let current: TestNextly | undefined;

afterEach(async () => {
  state.failReads = false;
  await current?.destroy();
  current = undefined;
});

const READER = { id: "reader", email: "reader@x.test" };

async function documentWithRules(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "banner",
        fields: [
          text({ name: "heading" }),
          text({ name: "secret", access: { read: () => true } }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        versions: true,
        access: { read: () => true, update: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "guarded", access: { read: () => true } }),
          fieldGroup({ name: "banner", component: "banner" }),
        ],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const created = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "T1", guarded: "G-1", banner: { heading: "H1", secret: "S-1" } }
  );
  const id = (created.data as { id: string }).id;
  await handler.updateEntry(
    { collectionName: "posts", entryId: id, overrideAccess: true },
    { title: "T2", guarded: "G-2", banner: { heading: "H2", secret: "S-2" } }
  );
  return id;
}

describe.each(getConfiguredTestDialects())(
  "history when read rules cannot be evaluated (integration, %s)",
  dialect => {
    it("withholds every field carrying a read rule, and names them", async () => {
      const id = await documentWithRules(dialect);

      state.failReads = true;
      const read = await getVersionForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: READER,
        versionNo: 1,
      });
      state.failReads = false;

      const text = JSON.stringify(read.snapshot);
      expect(text).not.toContain("G-1");
      expect(text).not.toContain("S-1");
      expect(read.withheld).toEqual(
        expect.arrayContaining(["guarded", "banner"])
      );
      // A field no rule guards is still shown.
      expect(text).toContain("T1");
    });

    it("refuses a restore rather than applying it unfiltered", async () => {
      const id = await documentWithRules(dialect);

      state.failReads = true;
      const refused = await restoreVersion({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: READER,
        versionNo: 1,
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      state.failReads = false;

      expect(refused).toMatchObject({ code: "FORBIDDEN" });
      const live = await current!.getService("collectionsHandler").getEntry({
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        depth: 0,
      });
      expect(live.data).toMatchObject({ title: "T2", guarded: "G-2" });
    });
  }
);
