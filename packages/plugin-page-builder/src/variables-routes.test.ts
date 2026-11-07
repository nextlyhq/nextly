/**
 * The Variables panel's routes, against fakes of the usage index, the site's
 * shared styles and the stored tokens section: what each answers, what each
 * writes, and what each refuses.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { variableUsagePath, variableWhereUsedPath } from "./library-contract";
import type { StoredDocuments, StoredUse } from "./shared-style-rescan";
import type { SharedStyleUsageSource } from "./shared-styles-routes";
import {
  VARIABLE_REMOVE_WRITE_CONTEXT,
  type VariablesInUseCheck,
} from "./site-style-storage";
import type { DocumentsUsing } from "./usage-count";
import type { UsageIndexHealth } from "./usage-index-health";
import {
  mergedSharedStyles,
  readVariableUsage,
  readVariableUses,
  refuseVariablesInUse,
  removeVariables,
  siteStyleVariableStore,
  variableRoutes,
  variablesInUseCheck,
  variableUsesPagesMax,
  type StillUsedVariables,
  type VariableRead,
  type VariableRemovalChecks,
  type VariableStore,
} from "./variables-routes";

const WHOLE: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
};
const NOT_WHOLE: UsageIndexHealth = {
  ...WHOLE,
  coversExistingDocuments: false,
};

const brand = {
  name: "color.brand",
  label: "Brand",
  kind: "color",
  values: { light: "#123456" },
};
const accent = {
  id: "t-accent",
  name: "color.accent",
  kind: "color",
  values: { light: "#654321" },
};

/** A shared style whose own styles name `token`. */
const styleNaming = (id: string, label: string, token: string) => ({
  id,
  slug: id.replace(/^c-/, ""),
  label,
  orderIndex: 0,
  styles: { base: { base: { color: { $token: token } } } },
});

const KINDS: Record<string, "components" | "patterns"> = {
  components: "components",
  patterns: "patterns",
};

/** The variable usage index as a fake, recording each read. */
function usageOf(
  health: UsageIndexHealth,
  uses: Record<string, DocumentsUsing["collections"]> = {}
) {
  const batches: (readonly string[])[] = [];
  const source: SharedStyleUsageSource = {
    health: vi.fn(async () => health),
    documentsUsingEach: async ids => {
      batches.push(ids);
      return new Map(
        ids.map(id => [
          id,
          {
            collections: Object.hasOwn(uses, id) ? (uses[id] ?? []) : [],
            complete: health.coversExistingDocuments,
          },
        ])
      );
    },
    kindOf: collection => KINDS[collection] ?? "pages",
  };
  return { source, batches };
}

/** No block type of the site's names a variable in its default styles. */
const NO_BLOCKS = () => [];

/** A registered block type whose own default styles name `token`. */
const blockNaming = (name: string, label: string, token: string) => ({
  name,
  editor: { label },
  baseStyles: { base: { base: { color: { $token: token } } } },
});

/** A caller holding exactly the permissions named, as `action-resource`. */
const holding = (...held: string[]) => ({
  self: {
    singles: { "site-style": "renamed_site-style" },
    collections: {},
  } as never,
  caller: {
    can: vi.fn(async (action: string, resource: string) =>
      held.includes(`${action}-${resource}`)
    ),
  } as never,
});

const usageRequest = (...ids: string[]) =>
  new Request(`http://local${variableUsagePath(ids)}`);

const post = (body: unknown) =>
  new Request("http://local/variables/remove", {
    method: "POST",
    body: JSON.stringify(body),
  });

async function refusal(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the variable routes' permissions", () => {
  const setup = {
    defaults: undefined,
    usage: () => usageOf(WHOLE).source,
    blocks: NO_BLOCKS,
    inUse: () => ({
      inUse: async () => undefined,
      stillUsed: { uses: async () => [] },
    }),
  };
  const scope = {
    plugin: "@nextlyhq/plugin-page-builder",
    collection: (slug: string, action: string) => `${action}-${slug}`,
    single: (slug: string, action: string) => `${action}-renamed_${slug}`,
  };

  it("gates removal on Design's update, and leaves the reads to their handler", () => {
    expect(
      variableRoutes(setup).map(route => [
        route.method,
        route.path,
        route.requiredPermission?.(scope),
      ])
    ).toEqual([
      ["GET", "/variables/usage", undefined],
      ["GET", "/variables/where-used", undefined],
      ["POST", "/variables/remove", "update-renamed_site-style"],
    ]);
  });

  it("refuses a read to a caller who may not read Design, before reading anything", async () => {
    const usage = vi.fn(() => usageOf(WHOLE).source);
    const [usageRoute, whereUsedRoute] = variableRoutes({ ...setup, usage });
    for (const ctx of [holding("read-pages"), { ...holding(), caller: null }]) {
      expect(
        await refusal(
          usageRoute!.handler(usageRequest("t-accent"), ctx as never)
        )
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await refusal(
          whereUsedRoute!.handler(
            new Request(`http://local${variableWhereUsedPath("t-accent", 1)}`),
            ctx as never
          )
        )
      ).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(usage).not.toHaveBeenCalled();
  });
});

describe("how widely variables are used", () => {
  const design = holding("read-renamed_site-style");

  it("counts each variable's documents by kind, and the shared styles naming it", async () => {
    const { source } = usageOf(WHOLE, {
      "t-accent": [
        { collection: "pages", documents: ["p1", "p2"] },
        { collection: "components", documents: ["k1"] },
      ],
    });
    const styles = [
      styleNaming("c-hero", "Hero", "t-accent"),
      styleNaming("c-card", "Card", "t-accent"),
      styleNaming("c-quote", "Quote", "color.brand"),
    ];
    const answer = await readVariableUsage(
      usageRequest("t-accent", "color.brand", "color.unused"),
      design,
      source,
      async () => styles,
      () => [
        blockNaming("acme/card", "Card", "color.brand"),
        blockNaming("acme/button", "Button", "color.brand"),
      ]
    );
    expect(answer).toEqual({
      whole: true,
      counting: false,
      // Counting now is Design's update, which this caller lacks.
      mayCount: false,
      variables: {
        "t-accent": {
          documents: 3,
          byKind: { pages: 2, components: 1, patterns: 0, layouts: 0 },
          // In id order, whatever order the site style lists them in.
          sharedStyles: ["c-card", "c-hero"],
          blockDefaults: [],
          complete: true,
        },
        "color.brand": {
          documents: 0,
          byKind: { pages: 0, components: 0, patterns: 0, layouts: 0 },
          sharedStyles: ["c-quote"],
          // In type order, whatever order the registry lists them in.
          blockDefaults: ["acme/button", "acme/card"],
          complete: true,
        },
        "color.unused": {
          documents: 0,
          byKind: { pages: 0, components: 0, patterns: 0, layouts: 0 },
          sharedStyles: [],
          blockDefaults: [],
          complete: true,
        },
      },
    });
  });

  it("says the counts are floors while the index is not whole, and who may count now", async () => {
    const { source } = usageOf({ ...NOT_WHOLE, backfillPending: true });
    const answer = await readVariableUsage(
      usageRequest("t-accent"),
      holding("read-renamed_site-style", "update-renamed_site-style"),
      source,
      async () => [],
      NO_BLOCKS
    );
    expect(answer).toMatchObject({
      whole: false,
      counting: true,
      mayCount: true,
      variables: { "t-accent": { complete: false } },
    });
  });

  it("asks the index about a whole page of variables in one read, each once", async () => {
    const { source, batches } = usageOf(WHOLE);
    const sharedStyles = vi.fn(async () => []);
    await readVariableUsage(
      usageRequest("t-a", "t-b", "t-a"),
      design,
      source,
      sharedStyles,
      NO_BLOCKS
    );
    expect(batches).toEqual([["t-a", "t-b"]]);
    expect(sharedStyles).toHaveBeenCalledTimes(1);
  });

  it("answers for an identity named like an object's own machinery", async () => {
    // From entries: a `__proto__` key in a literal would set the prototype.
    const { source } = usageOf(
      WHOLE,
      Object.fromEntries([
        ["__proto__", [{ collection: "pages", documents: ["p1"] }]],
      ])
    );
    const answer = await readVariableUsage(
      usageRequest("__proto__"),
      design,
      source,
      async () => [],
      NO_BLOCKS
    );
    expect(Object.hasOwn(answer.variables, "__proto__")).toBe(true);
    expect(answer.variables.__proto__?.documents).toBe(1);
  });

  it("refuses no variable, more than a page of them, and an identity too long to be one", async () => {
    const { source } = usageOf(WHOLE);
    const many = Array.from({ length: 51 }, (_, n) => `t-${n}`);
    for (const ids of [[], many, ["x".repeat(257)]]) {
      expect(
        await refusal(
          readVariableUsage(
            usageRequest(...ids),
            design,
            source,
            async () => [],
            NO_BLOCKS
          )
        )
      ).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });
});

describe("where a variable is used", () => {
  const named = async (collection: string, ids: readonly string[]) =>
    collection === "secret" ? null : ids.map(id => ({ id, title: `T ${id}` }));

  async function uses(
    query: string,
    documents: DocumentsUsing["collections"],
    styles: readonly unknown[],
    blocks: ReturnType<typeof blockNaming>[] = []
  ) {
    const { source } = usageOf(WHOLE, { "t-accent": documents });
    const response = await readVariableUses(
      new Request(`http://local/variables/where-used?${query}`),
      source,
      { named, single: async () => null },
      async () => styles,
      () => blocks,
      "renamed_site-style"
    );
    return (await response.json()) as {
      items: { id: string; title: string; collection: string; kind: string }[];
      meta: Record<string, unknown>;
    };
  }

  it("names the shared styles first, in id order, then the block types, then the documents the caller may read", async () => {
    const body = await uses(
      "id=t-accent",
      [
        { collection: "pages", documents: ["p1"] },
        { collection: "secret", documents: ["s1", "s2"] },
      ],
      [
        styleNaming("c-hero", "Hero", "t-accent"),
        styleNaming("c-card", "Card", "t-accent"),
        styleNaming("c-quote", "Quote", "color.brand"),
      ],
      [
        blockNaming("acme/quote", "Quote", "color.brand"),
        blockNaming("acme/button", "Button", "t-accent"),
      ]
    );
    expect(body.items).toEqual([
      {
        id: "c-card",
        title: "Card",
        collection: "renamed_site-style",
        kind: "shared-style",
      },
      {
        id: "c-hero",
        title: "Hero",
        collection: "renamed_site-style",
        kind: "shared-style",
      },
      {
        id: "acme/button",
        title: "Button",
        collection: "",
        kind: "block-default",
      },
      { id: "p1", title: "T p1", collection: "pages", kind: "pages" },
    ]);
    expect(body.meta).toMatchObject({ total: 4, hiddenCount: 2 });
  });

  it("names each block type's look apart when two types' own looks share an id", async () => {
    // Two block types' own looks may carry one id: each is its own place,
    // named with its type, so the right one can be opened.
    const look = (blockType: string) => ({
      ...styleNaming("look-default", "Default", "t-accent"),
      blockType,
    });
    const body = await uses(
      "id=t-accent",
      [],
      [
        look("core/heading"),
        look("core/button"),
        styleNaming("c-card", "Card", "t-accent"),
      ]
    );
    expect(body.items).toEqual([
      {
        id: "c-card",
        title: "Card",
        collection: "renamed_site-style",
        kind: "shared-style",
      },
      {
        id: "look-default",
        title: "Default",
        collection: "renamed_site-style",
        kind: "shared-style",
        blockType: "core/button",
      },
      {
        id: "look-default",
        title: "Default",
        collection: "renamed_site-style",
        kind: "shared-style",
        blockType: "core/heading",
      },
    ]);
  });

  it("pages the shared styles and the documents as one list", async () => {
    const styles = Array.from({ length: 15 }, (_, n) =>
      styleNaming(`c-${String(n).padStart(2, "0")}`, `S${n}`, "t-accent")
    );
    const documents = Array.from(
      { length: 10 },
      (_, n) => `p${String(n).padStart(2, "0")}`
    );
    const first = await uses(
      "id=t-accent",
      [{ collection: "pages", documents }],
      styles
    );
    const second = await uses(
      "id=t-accent&page=2",
      [{ collection: "pages", documents }],
      styles
    );
    expect(first.items.map(item => item.id)).toEqual([
      ...styles.map(style => style.id),
      ...documents.slice(0, 5),
    ]);
    expect(second.items.map(item => item.id)).toEqual(documents.slice(5));
    expect(second.meta).toMatchObject({
      total: 25,
      page: 2,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    });
  });

  it("reaches the last page of the longest list a variable can have", async () => {
    // Every document one listing can name, then the shared styles beside
    // them: three places past the documents' own last page.
    const documents = Array.from(
      { length: variableUsesPagesMax(0) * 20 },
      (_, n) => `p${String(n).padStart(5, "0")}`
    );
    const styles = [0, 1, 2].map(n =>
      styleNaming(`c-${n}`, `S${n}`, "t-accent")
    );
    const last = variableUsesPagesMax(styles.length);
    expect(last).toBe(variableUsesPagesMax(0) + 1);
    const body = await uses(
      `id=t-accent&page=${last}`,
      [{ collection: "pages", documents }],
      styles
    );
    expect(body.items.map(item => item.id)).toEqual(documents.slice(-3));
    expect(body.meta).toMatchObject({
      page: last,
      totalPages: last,
      hasNext: false,
    });
    expect(
      await refusal(
        uses(
          `id=t-accent&page=${last + 1}`,
          [{ collection: "pages", documents }],
          styles
        )
      )
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a missing identity and a page that is not a positive whole number", async () => {
    for (const query of ["", "id=t-accent&page=0", "id=t-accent&page=two"]) {
      expect(await refusal(uses(query, [], []))).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
  });
});

/** A rescan of the stored documents, recording what it was asked. */
function stillUsedOf(found: readonly StoredUse[], first?: string) {
  const uses = vi.fn<StillUsedVariables["uses"]>(async () => found);
  return {
    uses,
    stillUsed: {
      uses,
      ...(first === undefined ? {} : { firstReadable: async () => first }),
    } satisfies StillUsedVariables,
  };
}

describe("the in-use check every removal makes", () => {
  const removable = [
    { id: "t-accent", name: "Accent" },
    { id: "color.brand", name: "Brand" },
  ];
  const pathOf = (id: string) => `at:${id}`;

  it("refuses every removal while the index is not whole, and reads no document", async () => {
    const { stillUsed, uses } = stillUsedOf([]);
    expect(
      await refusal(
        refuseVariablesInUse(
          removable,
          [],
          { usage: usageOf(NOT_WHOLE).source, blocks: NO_BLOCKS, stillUsed },
          pathOf
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. Some pages haven't been counted yet, so no variable can be removed.",
    });
    expect(uses).not.toHaveBeenCalled();
  });

  it("refuses a variable used on documents and one used only by a shared style, each at its path", async () => {
    const { stillUsed, uses } = stillUsedOf([]);
    const usage = usageOf(WHOLE, {
      "t-accent": [{ collection: "pages", documents: ["p1", "p2"] }],
    }).source;
    expect(
      await refusal(
        refuseVariablesInUse(
          removable,
          [
            styleNaming("c-card", "Card", "color.brand"),
            styleNaming("c-hero", "Hero", "color.brand"),
          ],
          { usage, blocks: NO_BLOCKS, stillUsed },
          pathOf
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "at:t-accent",
            code: "IN_USE",
            message: "Accent is used on 2 documents.",
          },
          {
            path: "at:color.brand",
            code: "IN_USE",
            message: "Brand is used by the shared styles Card, Hero.",
          },
        ],
      },
    });
    expect(uses).not.toHaveBeenCalled();
  });

  it("refuses a variable a registered block type's own default styles name, before reading any document", async () => {
    const { stillUsed, uses } = stillUsedOf([]);
    expect(
      await refusal(
        refuseVariablesInUse(
          removable,
          [],
          {
            usage: usageOf(WHOLE).source,
            blocks: () => [
              blockNaming("acme/card", "Card", "color.brand"),
              blockNaming("acme/button", "Button", "t-accent"),
              blockNaming("acme/badge", "Badge", "t-accent"),
            ],
            stillUsed,
          },
          pathOf
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "at:t-accent",
            code: "IN_USE",
            message:
              "Accent is used by the Badge, Button blocks' default styles.",
          },
          {
            path: "at:color.brand",
            code: "IN_USE",
            message: "Brand is used by the Card block's default style.",
          },
        ],
      },
    });
    expect(uses).not.toHaveBeenCalled();
  });

  it("refuses as a conflict, carrying no in-use code, when one variable is used and another's uses could not all be counted", async () => {
    const { stillUsed } = stillUsedOf([]);
    const usage: SharedStyleUsageSource = {
      health: async () => WHOLE,
      documentsUsingEach: async ids =>
        new Map(
          ids.map(id => [
            id,
            id === "t-accent"
              ? {
                  collections: [{ collection: "pages", documents: ["p1"] }],
                  complete: true,
                }
              : { collections: [], complete: false },
          ])
        ),
      kindOf: () => "pages",
    };
    const refused = await refusal(
      refuseVariablesInUse(
        removable,
        [],
        { usage, blocks: NO_BLOCKS, stillUsed },
        pathOf
      )
    );
    expect(refused).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Nothing was removed. Accent is used on 1 document. Brand's uses could not all be counted.",
    });
    expect(JSON.stringify(refused)).not.toContain("IN_USE");
  });

  it("refuses a variable the index counts on nothing while a stored document still uses it", async () => {
    const { stillUsed, uses } = stillUsedOf(
      [
        { kind: "collection", slug: "pages", id: "p1" },
        { kind: "collection", slug: "pages", id: "p2" },
      ],
      "Home"
    );
    expect(
      await refusal(
        refuseVariablesInUse(
          removable.slice(0, 1),
          [],
          { usage: usageOf(WHOLE).source, blocks: NO_BLOCKS, stillUsed },
          pathOf
        )
      )
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "",
            code: "IN_USE",
            message:
              "Still used on Home and 1 more. Remove it from those pages first.",
          },
        ],
      },
    });
    expect(uses).toHaveBeenCalledWith(["t-accent"]);
  });

  it("names no document when made for a write whose author it cannot ask", async () => {
    const { stillUsed } = stillUsedOf([
      { kind: "collection", slug: "pages", id: "p1" },
    ]);
    expect(
      await refusal(
        refuseVariablesInUse(
          removable,
          [],
          { usage: usageOf(WHOLE).source, blocks: NO_BLOCKS, stillUsed },
          pathOf
        )
      )
    ).toMatchObject({
      publicData: {
        errors: [
          {
            path: "",
            code: "IN_USE",
            message: "Still used on 1 document. Remove them from it first.",
          },
        ],
      },
    });
  });

  it("passes variables nothing uses, and asks nothing about none", async () => {
    const { stillUsed, uses } = stillUsedOf([]);
    const usage = usageOf(WHOLE);
    await expect(
      refuseVariablesInUse(
        removable,
        [styleNaming("c-card", "Card", "color.other")],
        { usage: usage.source, blocks: NO_BLOCKS, stillUsed },
        pathOf
      )
    ).resolves.toBeUndefined();
    expect(uses).toHaveBeenCalledTimes(1);

    const idle = usageOf(WHOLE);
    await refuseVariablesInUse(
      [],
      [],
      { usage: idle.source, blocks: NO_BLOCKS, stillUsed },
      pathOf
    );
    expect(idle.source.health).not.toHaveBeenCalled();
  });
});

/** A write refused because the Single was saved since its read. */
const staleRefusal = () =>
  NextlyError.staleVersion({ data: { currentVersion: "9" } });

/** A store over the stored tokens section, recording each write. */
function storeOf(section: Record<string, unknown>, rev?: string) {
  const read: VariableRead = {
    section,
    classes: [styleNaming("c-card", "Card", "color.other")],
    rev,
  };
  // Each write answers the document it left, with the next version.
  let version = Number(rev ?? "0");
  const write = vi.fn<VariableStore["write"]>(async written => {
    version += 1;
    return { section: written, classes: read.classes, rev: String(version) };
  });
  return { store: { read: async () => read, write }, write, read };
}

/** The removal's checks: `inUse` as given, and a final rescan finding `found`. */
function checksOf(
  inUse: VariablesInUseCheck = async () => undefined,
  found: readonly StoredUse[] = []
): VariableRemovalChecks & { uses: ReturnType<typeof stillUsedOf>["uses"] } {
  const { stillUsed, uses } = stillUsedOf(found, "Home");
  return { inUse, stillUsed, uses };
}

describe("removing variables", () => {
  const supplied = new Set(["color.code"]);

  it("removes an unused variable the site added, keeping the rest of the section as stored", async () => {
    const unreadable = { name: 42 };
    const { store, write, read } = storeOf(
      { tokens: [brand, accent, unreadable], fonts: ["kept"] },
      "7"
    );
    const inUse = vi.fn<VariablesInUseCheck>(async () => undefined);
    const response = await removeVariables(
      post({ ids: ["t-accent"] }),
      store,
      supplied,
      checksOf(inUse)
    );

    // Judged on the read the write is made from, with its shared styles.
    expect(inUse).toHaveBeenCalledWith(
      [{ id: "t-accent", name: "Accent" }],
      read.classes
    );
    expect(write).toHaveBeenCalledWith(
      { tokens: [brand, unreadable], fonts: ["kept"] },
      read
    );
    expect(await response.json()).toEqual({
      message: "The variable was removed.",
      item: { ids: ["t-accent"] },
    });
  });

  it("writes once, and leaves the stored documents' last read to its write's own transaction", async () => {
    const { store, write } = storeOf({ tokens: [brand, accent] }, "7");
    const checks = checksOf();
    await removeVariables(post({ ids: ["t-accent"] }), store, supplied, checks);
    expect(write).toHaveBeenCalledTimes(1);
    // Read again inside the write's transaction, under the composition graph
    // lock (`site-style-removal-lock`), not by the route after it.
    expect(checks.uses).not.toHaveBeenCalled();
  });

  describe("a removal's write refused because the Single was saved meanwhile", () => {
    const added = {
      id: "t-new",
      name: "color.new",
      kind: "color",
      values: { light: "#abcdef" },
    };

    /** A store read at version 7, then at 8 holding `newer`; 7's write refused. */
    function savedMeanwhile(newer: VariableRead) {
      const { store, write } = storeOf({ tokens: [brand, accent] }, "7");
      store.read = vi
        .fn<VariableStore["read"]>()
        .mockResolvedValueOnce({
          section: { tokens: [brand, accent] },
          classes: [],
          rev: "7",
        })
        .mockResolvedValue(newer);
      write.mockRejectedValueOnce(staleRefusal());
      return { store, write };
    }

    it("removes again from the newest section, keeping a variable added meanwhile", async () => {
      const newer: VariableRead = {
        section: { tokens: [brand, accent, added] },
        classes: [],
        rev: "8",
      };
      const { store, write } = savedMeanwhile(newer);
      const inUse = vi.fn<VariablesInUseCheck>(async () => undefined);
      const response = await removeVariables(
        post({ ids: ["t-accent"] }),
        store,
        supplied,
        checksOf(inUse)
      );
      expect(response.status).toBe(200);
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1]).toEqual([{ tokens: [brand, added] }, newer]);
      // Judged again on the newest read's shared styles.
      expect(inUse).toHaveBeenLastCalledWith(
        [{ id: "t-accent", name: "Accent" }],
        newer.classes
      );
    });

    it("refuses as the in-use check does when a shared style saved meanwhile uses the variable", async () => {
      const naming = styleNaming("c-new", "New", "t-accent");
      const { store, write } = savedMeanwhile({
        section: { tokens: [brand, accent] },
        classes: [naming],
        rev: "8",
      });
      const inUseRefusal = new Error("in use by New");
      const inUse = vi.fn<VariablesInUseCheck>(async (_removable, classes) => {
        if (classes.includes(naming)) throw inUseRefusal;
      });
      expect(
        await refusal(
          removeVariables(
            post({ ids: ["t-accent"] }),
            store,
            supplied,
            checksOf(inUse)
          )
        )
      ).toBe(inUseRefusal);
      expect(write).toHaveBeenCalledTimes(1);
    });

    it("refuses a variable removed meanwhile as one the site does not store", async () => {
      const { store, write } = savedMeanwhile({
        section: { tokens: [brand] },
        classes: [],
        rev: "8",
      });
      expect(
        await refusal(
          removeVariables(
            post({ ids: ["t-accent"] }),
            store,
            supplied,
            checksOf()
          )
        )
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  it("removes several in one write, named by identity", async () => {
    const { store, write } = storeOf({ tokens: [brand, accent] });
    const response = await removeVariables(
      post({ ids: ["t-accent", "color.brand"] }),
      store,
      supplied,
      checksOf()
    );
    expect(write.mock.calls[0]?.[0]).toEqual({ tokens: [] });
    expect(await response.json()).toMatchObject({
      message: "2 variables were removed.",
    });
  });

  it("writes nothing when the in-use check refuses", async () => {
    const { store, write } = storeOf({ tokens: [accent] });
    const inUse = new Error("in use");
    expect(
      await refusal(
        removeVariables(
          post({ ids: ["t-accent"] }),
          store,
          supplied,
          checksOf(() => Promise.reject(inUse))
        )
      )
    ).toBe(inUse);
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a variable the site's code supplies, asking and writing nothing", async () => {
    const override = {
      name: "color.code",
      kind: "color",
      values: { light: "#fff" },
    };
    const { store, write } = storeOf({ tokens: [accent, override] });
    const inUse = vi.fn<VariablesInUseCheck>(async () => undefined);
    expect(
      await refusal(
        removeVariables(
          post({ ids: ["t-accent", "color.code"] }),
          store,
          supplied,
          checksOf(inUse)
        )
      )
    ).toMatchObject({
      code: "CONFLICT",
      publicMessage: expect.stringContaining(
        "is defined in the site's code, so it can be reset but not removed."
      ),
    });
    expect(inUse).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a variable the site does not store", async () => {
    const { store, write } = storeOf({ tokens: [accent] });
    expect(
      await refusal(
        removeVariables(post({ ids: ["t-none"] }), store, supplied, checksOf())
      )
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a body that does not name variables", async () => {
    const { store } = storeOf({ tokens: [accent] });
    for (const body of [{}, { ids: [] }, { ids: ["t-accent"], extra: 1 }]) {
      expect(
        await refusal(removeVariables(post(body), store, supplied, checksOf()))
      ).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });
});

describe("the site style's stored variables, as the remove route reads and writes them", () => {
  const defaults = {
    classes: [styleNaming("c-code", "Code", "color.code")],
  };

  it("reads the stored section, stored as text too, with the shared styles merged and the version", async () => {
    const card = styleNaming("c-card", "Card", "t-accent");
    const store = siteStyleVariableStore(
      { self: { singles: {} }, user: null } as never,
      {
        findSingle: async () => ({
          tokens: JSON.stringify({ tokens: [accent] }),
          classes: [card],
          _rev: "4",
        }),
        updateSingle: async () => ({}),
      },
      defaults
    );
    const read = await store.read();
    expect(read.section).toEqual({ tokens: [accent] });
    expect(read.classes.map(entry => (entry as { id: string }).id)).toEqual([
      "c-code",
      "c-card",
    ]);
    expect(read.rev).toBe("4");
  });

  it("reads an empty section when nothing is stored", async () => {
    const store = siteStyleVariableStore(
      { self: { singles: {} }, user: null } as never,
      { findSingle: async () => null, updateSingle: async () => ({}) },
      undefined
    );
    expect(await store.read()).toEqual({
      section: {},
      classes: [],
      rev: undefined,
    });
  });

  it("writes the RESOLVED Single with the read's version, as the caller, marked as the route's write", async () => {
    const updates: unknown[] = [];
    const store = siteStyleVariableStore(
      {
        self: { singles: { "site-style": "renamed_site-style" } },
        user: { id: "user-1" },
      } as never,
      {
        findSingle: async () => ({}),
        updateSingle: async args => {
          updates.push(args);
          return {};
        },
      },
      undefined
    );
    await store.write({ tokens: [] }, { section: {}, classes: [], rev: "9" });
    expect(updates).toEqual([
      {
        slug: "renamed_site-style",
        data: { tokens: { tokens: [] }, _rev: "9" },
        overrideAccess: true,
        context: { ...VARIABLE_REMOVE_WRITE_CONTEXT },
        user: { id: "user-1" },
      },
    ]);
  });

  it("answers the document its write stored, with the version the write gave it", async () => {
    const store = siteStyleVariableStore(
      { self: { singles: {} }, user: null } as never,
      {
        findSingle: async () => ({}),
        updateSingle: async () => ({
          tokens: { tokens: [accent] },
          classes: [],
          _rev: "10",
        }),
      },
      undefined
    );
    expect(
      await store.write(
        { tokens: [accent] },
        { section: {}, classes: [], rev: "9" }
      )
    ).toEqual({ section: { tokens: [accent] }, classes: [], rev: "10" });
  });

  it("merges the code's shared styles under the stored ones by id", () => {
    const stored = { ...styleNaming("c-code", "Mine", "t-accent") };
    expect(mergedSharedStyles({ classes: [stored] }, defaults)).toEqual([
      expect.objectContaining({ id: "c-code", label: "Mine" }),
    ]);
  });
});

describe("the in-use check, bound to the stored documents", () => {
  /** A stored page whose one heading's colour names `token`. */
  const pageNaming = (id: string, token: string) => ({
    id,
    content: {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "n",
          type: "core/heading",
          version: 1,
          props: { text: "n", level: 2 },
          // A class named like a variable: a class walk would find it.
          classes: ["t-other"],
          styles: { base: { base: { color: { $token: token } } } },
        },
      ],
    },
  });
  const documentsOf = (rows: unknown[]): StoredDocuments => ({
    collections: async () => [
      { slug: "pages", label: "Pages", paths: ["content"] },
    ],
    singles: async () => [],
    rowsAfter: async () => ({ items: rows, hasNext: false }),
    rowForms: async () => [],
    singleForms: async () => [],
  });

  it("walks each stored document for the variables' own references", async () => {
    const firstReadable = vi.fn(async () => "Home");
    const check = variablesInUseCheck({
      usage: usageOf(WHOLE).source,
      blocks: NO_BLOCKS,
      documents: async () =>
        documentsOf([pageNaming("p1", "t-accent"), pageNaming("p2", "t-x")]),
      limits: DEFAULT_LIMITS,
      firstReadable,
      pathOf: id => id,
    });

    const refused = await refusal(
      check([{ id: "t-accent", name: "Accent" }], [])
    );
    expect(refused).toMatchObject({
      publicData: { errors: [{ path: "", code: "IN_USE" }] },
    });
    expect(firstReadable).toHaveBeenCalledWith([
      { kind: "collection", slug: "pages", id: "p1" },
    ]);
    // The control: a variable no document names, whatever its classes say.
    await expect(
      check([{ id: "t-other", name: "Other" }], [])
    ).resolves.toBeUndefined();
  });
});
