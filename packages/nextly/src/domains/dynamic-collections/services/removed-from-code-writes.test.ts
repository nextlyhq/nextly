/**
 * The write guard's decision, apart from the database: which registry rows it
 * refuses a write to, what it reads to decide, and what the refusal carries.
 * The integration suite drives it through every entry point.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  publishDeclaredEntities,
  refuseHistoryWriteIfRemovedFromCode,
  refuseWriteIfRemovedFromCode,
  restoreDeclaredEntities,
} from "./removed-from-code-writes";

const DECLARED = {
  collections: [{ slug: "posts" }],
  singles: [{ slug: "settings" }],
};

/** A registry that holds exactly these rows, and counts its reads. */
function registry(
  rows: Array<{ kind: "collection" | "single"; slug: string; source: string }>
) {
  return vi.fn(async (kind: "collection" | "single", slug: string) => {
    const row = rows.find(r => r.kind === kind && r.slug === slug);
    return row ? { slug: row.slug, source: row.source } : null;
  });
}

afterEach(() => {
  publishDeclaredEntities(undefined);
});

describe("refuseWriteIfRemovedFromCode", () => {
  it("refuses a code row whose slug the configuration no longer declares, naming it", async () => {
    publishDeclaredEntities(DECLARED);
    const lookup = registry([
      { kind: "collection", slug: "pages", source: "code" },
      { kind: "single", slug: "banner", source: "code" },
    ]);

    await expect(
      refuseWriteIfRemovedFromCode("collection", "pages", { lookup })
    ).rejects.toMatchObject({
      code: "ENTITY_REMOVED_FROM_CODE",
      statusCode: 409,
      publicData: { kind: "collection", slug: "pages" },
    });
    await expect(
      refuseWriteIfRemovedFromCode("single", "banner", { lookup })
    ).rejects.toMatchObject({
      code: "ENTITY_REMOVED_FROM_CODE",
      publicData: { kind: "single", slug: "banner" },
    });
  });

  it("says what happened and both ways out", async () => {
    publishDeclaredEntities(DECLARED);
    const lookup = registry([
      { kind: "collection", slug: "pages", source: "code" },
    ]);
    const refusal = await refuseWriteIfRemovedFromCode("collection", "pages", {
      lookup,
    }).catch((error: unknown) => error);
    const message = (refusal as { publicMessage: string }).publicMessage;
    expect(message).toContain('collection "pages" was removed from code');
    expect(message).toContain("`nextly migrate:create`");
    expect(message).toContain("`nextly migrate`");
    expect(message).toContain("declare it again");
  });

  it("lets a declared slug through without reading the registry", async () => {
    publishDeclaredEntities(DECLARED);
    const lookup = registry([]);
    await refuseWriteIfRemovedFromCode("collection", "posts", { lookup });
    await refuseWriteIfRemovedFromCode("single", "settings", { lookup });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("judges each kind by its own declared list", async () => {
    // A Single named like a declared collection is not declared by it.
    publishDeclaredEntities(DECLARED);
    const lookup = registry([
      { kind: "single", slug: "posts", source: "code" },
    ]);
    await expect(
      refuseWriteIfRemovedFromCode("single", "posts", { lookup })
    ).rejects.toMatchObject({ code: "ENTITY_REMOVED_FROM_CODE" });
  });

  it.each(["ui", "plugin"])(
    "never refuses an undeclared %s row: only the app's code removes from code",
    async source => {
      publishDeclaredEntities(DECLARED);
      const lookup = registry([{ kind: "collection", slug: "pages", source }]);
      await expect(
        refuseWriteIfRemovedFromCode("collection", "pages", { lookup })
      ).resolves.toBeUndefined();
    }
  );

  it("leaves a slug the registry does not hold to the write itself", async () => {
    publishDeclaredEntities(DECLARED);
    await expect(
      refuseWriteIfRemovedFromCode("collection", "nothing", {
        lookup: registry([]),
      })
    ).resolves.toBeUndefined();
  });

  it("refuses nothing while no configuration is published", async () => {
    const lookup = registry([
      { kind: "collection", slug: "pages", source: "code" },
    ]);
    await refuseWriteIfRemovedFromCode("collection", "pages", { lookup });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("hands the caller's transaction to the registry read", async () => {
    publishDeclaredEntities(DECLARED);
    const lookup = registry([]);
    const executor = { tx: true };
    await refuseWriteIfRemovedFromCode("collection", "pages", {
      lookup,
      executor,
    });
    expect(lookup).toHaveBeenCalledWith("collection", "pages", executor);
  });
});

describe("publishDeclaredEntities", () => {
  it("answers the set it replaced, which restoreDeclaredEntities puts back", async () => {
    publishDeclaredEntities(DECLARED);
    const previous = publishDeclaredEntities({ collections: [], singles: [] });
    const lookup = registry([
      { kind: "collection", slug: "posts", source: "code" },
    ]);
    // Under the new set "posts" is no longer declared.
    await expect(
      refuseWriteIfRemovedFromCode("collection", "posts", { lookup })
    ).rejects.toMatchObject({ code: "ENTITY_REMOVED_FROM_CODE" });

    restoreDeclaredEntities(previous);
    await expect(
      refuseWriteIfRemovedFromCode("collection", "posts", { lookup })
    ).resolves.toBeUndefined();
  });
});

describe("refuseHistoryWriteIfRemovedFromCode", () => {
  it("judges a collection's or a Single's history and no other kind's", async () => {
    // A page's history is kept too, and this rule says nothing about pages:
    // with every registry read refusing, only the two kinds reach one.
    publishDeclaredEntities({ collections: [], singles: [] });
    await expect(
      refuseHistoryWriteIfRemovedFromCode({
        scopeKind: "page",
        scopeSlug: "home",
      })
    ).resolves.toBeUndefined();
    // The control: a collection's history does reach the registry, which no
    // services are registered to answer here.
    await expect(
      refuseHistoryWriteIfRemovedFromCode({
        scopeKind: "collection",
        scopeSlug: "home",
      })
    ).rejects.toThrow();
  });
});
