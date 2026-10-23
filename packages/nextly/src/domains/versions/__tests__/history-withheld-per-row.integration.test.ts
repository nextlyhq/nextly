/**
 * A field withheld in one row of a list is withheld in that row only.
 *
 * A read rule that reads its row's data can allow a field in one row of a
 * repeater or a repeatable component and deny it in another. History names
 * what it withheld by row (`items.1.secret`), and a comparison marks the field
 * hidden only in the row that withheld it, so the reader still sees the change
 * in the row the rule allowed.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  repeater,
  text,
} from "../../../config";
import {
  getVersionDiffForDocument,
  getVersionForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const READER = { id: "reader", email: "reader@x.test" };

/** A field readable only in a row marked public. */
const publicOnly = text({
  name: "secret",
  access: {
    read: ({ data }) =>
      (data as { tier?: unknown } | undefined)?.tier === "public",
  },
});

/** The hidden-field nodes a comparison carries, at any depth. */
function hiddenNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(hiddenNodes);
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [
    ...(node.kind === "hidden" ? [node] : []),
    ...Object.values(node).flatMap(hiddenNodes),
  ];
}

/** Every marked value the response carries, wherever it sits. */
const valuesIn = (value: unknown, mark: string): string[] =>
  (JSON.stringify(value).match(new RegExp(`${mark}-\\d`, "g")) ?? []).sort();

/**
 * A document whose first row is public and second private, in a repeater
 * and in a repeatable component, saved twice with every secret changed.
 */
async function documentWithMixedRows(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [text({ name: "tier" }), text({ name: "label" }), publicOnly],
      }),
    ],
    collections: [
      defineCollection({
        slug: "notes",
        versions: true,
        access: { read: () => true, update: () => true, create: () => true },
        fields: [
          text({ name: "title" }),
          repeater({
            name: "items",
            fields: [
              text({ name: "tier" }),
              text({ name: "label" }),
              publicOnly,
            ],
          }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
        ],
      }),
    ],
  });
  const handler = current.getService("collectionsHandler");
  const rows = (n: number) => [
    { tier: "public", label: "A", secret: `P-${n}` },
    { tier: "private", label: "B", secret: `X-${n}` },
  ];
  const created = await handler.createEntry(
    { collectionName: "notes", overrideAccess: true },
    { title: "v1", items: rows(1), cards: rows(1) }
  );
  const id = (created.data as { id: string }).id;
  await handler.updateEntry(
    { collectionName: "notes", entryId: id, overrideAccess: true },
    { title: "v2", items: rows(2), cards: rows(2) }
  );
  return id;
}

const at = (id: string) => ({
  scopeKind: "collection" as const,
  slug: "notes",
  entryId: id,
});

describe.each(getConfiguredTestDialects())(
  "a field withheld in one row of a list (%s)",
  dialect => {
    it("names the row it was withheld in", async () => {
      const id = await documentWithMixedRows(dialect);

      const version = await getVersionForDocument({
        ...at(id),
        user: READER,
        versionNo: 1,
      });

      expect(valuesIn(version, "X")).toEqual([]);
      expect(valuesIn(version, "P")).toEqual(["P-1", "P-1"]);
      expect(version.withheld).toEqual(
        expect.arrayContaining(["items.1.secret", "cards.1.secret"])
      );
      expect(version.withheld).not.toContain("items.0.secret");
      expect(version.withheld).not.toContain("cards.0.secret");
    });

    it("hides it in that row of a comparison only, and shows the other row's change", async () => {
      const id = await documentWithMixedRows(dialect);

      const diff = await getVersionDiffForDocument({
        ...at(id),
        user: READER,
        from: 1,
        to: 2,
      });

      // The private rows' values never reach the reader.
      expect(valuesIn(diff, "X")).toEqual([]);
      // The public rows' change is shown, in the repeater and the component.
      expect(valuesIn(diff, "P")).toEqual(["P-1", "P-1", "P-2", "P-2"]);
      // One hidden node per list: the private row's, none in the public row.
      expect(hiddenNodes(diff).map(node => node.name)).toEqual([
        "secret",
        "secret",
      ]);
    });
  }
);
