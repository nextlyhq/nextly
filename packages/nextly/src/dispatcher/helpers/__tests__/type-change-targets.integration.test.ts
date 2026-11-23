/**
 * The Builder's type picker asks the server what each other type would do to a saved field's
 * values: through the collection, Single and field-group routes alike, read from the conversion
 * rules on the database the site runs on, as a list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { isBuilderRoute } from "../../../shared/builder-access";
import { dispatchCollections } from "../../handlers/collection-dispatcher";

let instance: TestNextly | undefined;

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
  }
});

type Target = { type: string; blocked: string | null; outcome: string | null };

async function targetsOf(slug: string, field: string[]): Promise<Target[]> {
  const response = (await dispatchCollections(
    {} as ServiceContainer,
    "typeChangeTargets",
    { collectionName: slug },
    { field }
  )) as unknown as Response;
  const body = (await response.json()) as {
    items: Target[];
    meta: { total: number };
  };
  expect(body.meta.total).toBe(body.items.length);
  return body.items;
}

describe.each(getConfiguredTestDialects())(
  "the type picker's targets for a saved field (%s)",
  dialect => {
    it("lists each other type, blocked with why or marked by what it does to the values", async () => {
      instance = await createTestNextly(
        dialect === "sqlite" ? {} : { dialect }
      );
      vi.stubEnv("NODE_ENV", "development");
      await instance.getService("collectionService").createCollection(
        {
          name: "tct_posts",
          label: "Post",
          fields: [
            { name: "summary", type: "text" },
            { name: "views", type: "number" },
          ],
        } as never,
        {}
      );

      const fromText = new Map(
        (await targetsOf("tct_posts", ["summary"])).map(t => [t.type, t])
      );
      expect(fromText.has("text")).toBe(false);
      expect(fromText.get("number")).toMatchObject({
        blocked: null,
        outcome: "may-lose",
      });
      expect(fromText.get("group")).toMatchObject({
        blocked: "container",
        outcome: null,
      });
      const fromNumber = new Map(
        (await targetsOf("tct_posts", ["views"])).map(t => [t.type, t])
      );
      expect(fromNumber.get("text")).toMatchObject({
        blocked: null,
        outcome: "converts",
      });
    });

    it("refuses a field the collection does not hold", async () => {
      instance = await createTestNextly(
        dialect === "sqlite" ? {} : { dialect }
      );
      vi.stubEnv("NODE_ENV", "development");
      await instance
        .getService("collectionService")
        .createCollection(
          { name: "tct_posts", label: "Post", fields: [] } as never,
          {}
        );
      await expect(targetsOf("tct_posts", ["missing"])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  }
);

describe("the route", () => {
  it("is the schema builder's, refused wherever the builder is off", () => {
    expect(isBuilderRoute("collections", "typeChangeTargets")).toBe(true);
    expect(isBuilderRoute("singles", "singleTypeChangeTargets")).toBe(true);
    expect(isBuilderRoute("field-groups", "componentTypeChangeTargets")).toBe(
      true
    );
  });
});
