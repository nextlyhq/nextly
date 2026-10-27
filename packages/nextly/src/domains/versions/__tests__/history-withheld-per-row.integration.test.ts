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

/** Every marked value a version read carries, wherever it sits. */
const valuesIn = (value: unknown, mark: string): string[] =>
  (JSON.stringify(value).match(new RegExp(`${mark}-\\d`, "g")) ?? []).sort();

interface DiffNode {
  name?: string;
  kind?: string;
  items?: { fields: DiffNode[] }[];
  segments?: { op: number; text: string }[];
}

/**
 * A text node's values, rebuilt from its word diff: what it was, then what it
 * became, each left out when absent. A changed value is split into segments
 * ("P-", then "1" and "2"), so searching the response for whole values would
 * miss the ones it shows, and a leaked one too.
 */
function sidesOf(node: DiffNode | undefined): string[] {
  const segments = node?.segments ?? [];
  const side = (keep: (op: number) => boolean) =>
    segments
      .filter(segment => keep(segment.op))
      .map(segment => segment.text)
      .join("");
  return [side(op => op <= 0), side(op => op >= 0)].filter(text => text !== "");
}

/**
 * Each row of each list a comparison carries: the tiers it held in the two
 * versions, and its secret, either hidden or the values it shows.
 */
function rowsIn(diff: unknown) {
  return ((diff as { fields: DiffNode[] }).fields ?? [])
    .filter(node => node.kind === "list")
    .flatMap(list =>
      (list.items ?? []).map(item => {
        const field = (name: string) => item.fields.find(n => n.name === name);
        const secret = field("secret");
        return {
          list: list.name,
          tiers: sidesOf(field("tier")),
          secret: secret?.kind === "hidden" ? "hidden" : sidesOf(secret),
        };
      })
    );
}

/**
 * The comparison's promise, row by row: a secret is hidden in exactly the
 * rows private in either version, the rows public in both show what their
 * secret was and became, and no private value appears anywhere, however a
 * diff splits it. Returns the values the public rows show.
 */
function expectHiddenOnlyInPrivateRows(diff: unknown): string[] {
  const rows = rowsIn(diff);
  for (const row of rows) {
    expect(row.secret === "hidden", JSON.stringify(row)).toBe(
      row.tiers.includes("private")
    );
  }
  // Both lists reached the mechanism: each hides at least one row.
  expect(
    new Set(rows.filter(row => row.secret === "hidden").map(row => row.list))
  ).toEqual(new Set(["items", "cards"]));
  expect(JSON.stringify(diff)).not.toContain("X-");
  return rows
    .flatMap(row => (row.secret === "hidden" ? [] : row.secret))
    .sort();
}

/**
 * A document with a public row and a private one, in a repeater and in a
 * repeatable component, saved twice with every secret changed. With
 * `reordered`, the second save holds the private row first, so a row sits at
 * a different index in each version.
 */
async function documentWithMixedRows(
  dialect: TestDialect,
  { reordered = false }: { reordered?: boolean } = {}
) {
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
  const second = reordered ? rows(2).reverse() : rows(2);
  await handler.updateEntry(
    { collectionName: "notes", entryId: id, overrideAccess: true },
    { title: "v2", items: second, cards: second }
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

      // The public rows' change is shown, in the repeater and the component.
      expect(expectHiddenOnlyInPrivateRows(diff)).toEqual([
        "P-1",
        "P-1",
        "P-2",
        "P-2",
      ]);
    });

    it("reads each version's rows by that version's own index", async () => {
      // The second version holds its rows the other way round, so `1` names
      // the private row in the first version and the public one in the
      // second. Read with one set for both, every row would be hidden.
      const id = await documentWithMixedRows(dialect, { reordered: true });

      const diff = await getVersionDiffForDocument({
        ...at(id),
        user: READER,
        from: 1,
        to: 2,
      });

      // The public component instances, one in each version, still show
      // their secret.
      expect(expectHiddenOnlyInPrivateRows(diff)).toEqual(
        expect.arrayContaining(["P-1", "P-2"])
      );
    });
  }
);
