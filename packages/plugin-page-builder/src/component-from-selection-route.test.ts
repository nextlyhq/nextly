/**
 * Making a component from a selection, through the route, against stubs.
 *
 * What is held here is what the route decides: who may run it, what it
 * writes and as whom, what a dry run leaves untouched, that a convert's
 * placement names the row that was created, and that a stored convert runs
 * its two writes in one transaction.
 */
import {
  applyOps,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import { describe, expect, it, vi } from "vitest";

import {
  componentFromSelection,
  type ComponentFromSelectionContext,
  type ComponentFromSelectionReads,
} from "./component-from-selection-route";
import {
  DRY_RUN_COMPONENT_ID,
  type ComponentFromSelectionResult,
} from "./library-contract";

function node(id: string, type = "core/box"): BlockNode {
  return { id, type, version: 1, props: {} };
}

function placement(id: string, componentId: string): BlockNode {
  return {
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  };
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

const fields = { title: "Pricing card" };

function request(body: unknown): Request {
  return new Request("https://example.test/components/from-selection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Grants by action, as `caller.can` answers them. */
type Grants = Partial<Record<"create" | "publish" | "update", boolean>>;

function contextOver(
  options: {
    grants?: Grants;
    apiKey?: string;
    createdId?: string;
    failUpdate?: boolean;
  } = {}
) {
  const grants: Grants = {
    create: true,
    publish: true,
    update: true,
    ...options.grants,
  };
  const createdId = options.createdId ?? "cmp-1";
  const journal: string[] = [];
  const createEntry = vi.fn(
    (_slug: string, _data: Record<string, unknown>, _opts: unknown) => {
      journal.push("create");
      return Promise.resolve({ item: { id: createdId } });
    }
  );
  const createEntryInTransaction = vi.fn(
    (
      _tx: unknown,
      _slug: string,
      _data: Record<string, unknown>,
      _opts: unknown
    ) => {
      journal.push("create-in-tx");
      return Promise.resolve({ id: createdId });
    }
  );
  const updateEntryInTransaction = vi.fn(
    (
      _tx: unknown,
      _slug: string,
      _id: string,
      _data: Record<string, unknown>,
      _opts: unknown
    ) => {
      journal.push("update-in-tx");
      if (options.failUpdate === true) {
        return Promise.reject(new Error("the page refused the write"));
      }
      return Promise.resolve({ id: "page-1" });
    }
  );
  const withTransaction = vi.fn(
    async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      journal.push("begin");
      try {
        const done = await work({});
        journal.push("commit");
        return done;
      } catch (error) {
        journal.push("rollback");
        throw error;
      }
    }
  );
  const scope = options.apiKey === undefined ? undefined : { roles: ["r"] };
  const ctx = {
    self: { collections: {} },
    user: { id: "u1", email: "u1@example.test" },
    authenticatedScope: scope,
    caller: {
      authMethod: options.apiKey === undefined ? "session" : "api-key",
      ...(options.apiKey === undefined ? {} : { apiKeyId: options.apiKey }),
      identity: () => Promise.resolve({}),
      can: (action: keyof Grants) => Promise.resolve(grants[action] === true),
    },
    services: {
      collections: {
        createEntry,
        withTransaction,
        createEntryInTransaction,
        updateEntryInTransaction,
        warmLocalizedReadiness: () => Promise.resolve(),
      },
    },
  } as unknown as ComponentFromSelectionContext;
  return {
    ctx,
    journal,
    createEntry,
    createEntryInTransaction,
    updateEntryInTransaction,
  };
}

/**
 * Reads over a stored page and a set of published definitions. `revs` is the
 * version each successive page read gives, the last one repeated.
 */
function readsOver(
  stored: BlockDocument | null,
  definitions: Record<string, BlockDocument> = {},
  revs: readonly string[] = []
): ComponentFromSelectionReads {
  let reads = 0;
  return {
    page: () => {
      const rev = revs[Math.min(reads, revs.length - 1)];
      reads += 1;
      return Promise.resolve(
        stored === null ? null : { document: stored, rev }
      );
    },
    definitions: id =>
      Promise.resolve(
        definitions[id] === undefined
          ? { kind: "absent" as const }
          : { kind: "document" as const, document: definitions[id] }
      ),
  };
}

async function answered(
  response: Response
): Promise<{ status: number; item: ComponentFromSelectionResult }> {
  const body = (await response.json()) as {
    item: ComponentFromSelectionResult;
  };
  return { status: response.status, item: body.item };
}

async function thrownBy(run: Promise<unknown>): Promise<NextlyError> {
  try {
    await run;
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("expected the request to be refused, and it was not");
}

const threeBlocks = page([node("a"), node("b"), node("c")]);

describe("a dry run", () => {
  it("answers the plan and writes nothing", async () => {
    const { ctx, createEntry } = contextOver();

    const { status, item } = await answered(
      await componentFromSelection(
        request({
          action: "convert",
          dryRun: true,
          document: threeBlocks,
          selectedIds: ["a", "b"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(createEntry).not.toHaveBeenCalled();
    expect(status).toBe(200);
    expect(item.dryRun).toBe(true);
    expect(item.component.id).toBe(DRY_RUN_COMPONENT_ID);
    expect(item.definition.kind).toBe("component");
    expect(item.definition.nodes).toHaveLength(2);
    const insert = item.pageOps.find(op => op.kind === "insert");
    expect(insert).toMatchObject({
      node: { props: { componentId: DRY_RUN_COMPONENT_ID } },
    });
  });

  it("writes nothing in stored mode either", async () => {
    const { ctx, journal } = contextOver();

    await componentFromSelection(
      request({
        action: "convert",
        apply: "stored",
        dryRun: true,
        page: { collection: "pages", id: "page-1" },
        selectedIds: ["b"],
        fields,
      }),
      ctx,
      { reads: readsOver(threeBlocks) }
    );

    expect(journal).toEqual([]);
  });
});

describe("in the editor's library mode", () => {
  it("creates the component published, as the caller, and names it in the ops", async () => {
    const { ctx, createEntry } = contextOver({ createdId: "cmp-7" });

    const { status, item } = await answered(
      await componentFromSelection(
        request({
          action: "convert",
          document: threeBlocks,
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(status).toBe(201);
    const [slug, data, opts] = createEntry.mock.calls[0] ?? [];
    expect(slug).toBe("components");
    expect(data).toMatchObject({ title: "Pricing card", status: "published" });
    expect(typeof data?.slug).toBe("string");
    expect((data?.content as BlockDocument | undefined)?.kind).toBe(
      "component"
    );
    expect(opts).toMatchObject({ as: "user", user: { id: "u1" } });
    // The ops apply to the page the editor holds, and leave a placement of
    // the row that was created.
    const after = applyOps(threeBlocks, item.pageOps as BuilderOp[]).document;
    expect(after.nodes.map(n => n.props?.componentId ?? n.id)).toEqual([
      "a",
      "cmp-7",
      "c",
    ]);
    expect(item.by).toEqual({ kind: "user", userId: "u1" });
  });

  it("answers with the definition it stored", async () => {
    const { ctx, createEntry } = contextOver();

    const { item } = await answered(
      await componentFromSelection(
        request({
          action: "convert",
          document: threeBlocks,
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(item.definition).toEqual(createEntry.mock.calls[0]?.[1]?.content);
  });

  it("saves a copy without touching the page", async () => {
    const { ctx, createEntry } = contextOver();

    const { item } = await answered(
      await componentFromSelection(
        request({
          action: "save-as",
          document: threeBlocks,
          selectedIds: ["a"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(item.pageOps).toEqual([]);
  });

  it("carries the picked fields into the definition, aimed at its own nodes", async () => {
    const { ctx, createEntry } = contextOver();
    const doc = page([
      { ...node("h", "core/heading"), props: { text: "Hello" } },
    ]);

    await componentFromSelection(
      request({
        action: "save-as",
        document: doc,
        selectedIds: ["h"],
        fields,
        exposure: {
          properties: [
            {
              id: "headline",
              label: "Headline",
              nodeId: "h",
              propPath: "text",
              type: "text",
            },
          ],
        },
      }),
      ctx,
      { reads: readsOver(null) }
    );

    const stored = createEntry.mock.calls[0]?.[1]?.content as {
      nodes: BlockNode[];
      exposed: { id: string; nodeId: string }[];
    };
    expect(stored.exposed).toHaveLength(1);
    expect(stored.exposed[0]?.id).toBe("headline");
    expect(stored.exposed[0]?.nodeId).toBe(stored.nodes[0]?.id);
    expect(stored.exposed[0]?.nodeId).not.toBe("h");
  });
});

describe("who may run it", () => {
  it("refuses an author who may create components but not publish them, before writing", async () => {
    const { ctx, createEntry } = contextOver({ grants: { publish: false } });

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "save-as",
          document: threeBlocks,
          selectedIds: ["a"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(error.statusCode).toBe(403);
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("leaves create to the route's declared permission rather than asking again", async () => {
    // The dispatcher judges `create` before the handler runs; a second answer
    // here could refuse a request the route admitted.
    const { ctx, createEntry } = contextOver({ grants: { create: false } });

    await componentFromSelection(
      request({
        action: "save-as",
        document: threeBlocks,
        selectedIds: ["a"],
        fields,
      }),
      ctx,
      { reads: readsOver(null) }
    );

    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("accepts the plugin's own components named explicitly as the store", async () => {
    const { ctx, createEntry } = contextOver();

    await componentFromSelection(
      request({
        action: "save-as",
        document: threeBlocks,
        selectedIds: ["a"],
        fields,
      }),
      ctx,
      {
        reads: readsOver(null),
        store: { collection: "components", field: "content" },
      }
    );

    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("refuses a host that keeps components in a store of its own", async () => {
    const { ctx, createEntry } = contextOver();

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "save-as",
          document: threeBlocks,
          selectedIds: ["a"],
          fields,
        }),
        ctx,
        {
          reads: readsOver(null),
          store: { collection: "site_blocks", field: "body" },
        }
      )
    );

    expect(error.statusCode).toBe(422);
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("saves from a stored page the caller may read but not update", async () => {
    const { ctx, createEntry } = contextOver({ grants: { update: false } });

    await componentFromSelection(
      request({
        action: "save-as",
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        selectedIds: ["b"],
        fields,
      }),
      ctx,
      { reads: readsOver(threeBlocks) }
    );

    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("refuses a convert whose page's definitions could not all be read", async () => {
    const { ctx, createEntry } = contextOver();
    const reads: ComponentFromSelectionReads = {
      ...readsOver(null),
      definitions: () => Promise.resolve({ kind: "unreadable" as const }),
    };

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "convert",
          document: page([placement("p", "c1")]),
          selectedIds: ["p"],
          fields,
        }),
        ctx,
        { reads }
      )
    );

    expect(error.statusCode).toBe(422);
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("reads and writes a stored page in the language named", async () => {
    const { ctx, updateEntryInTransaction } = contextOver();
    const asked: unknown[] = [];
    const reads: ComponentFromSelectionReads = {
      ...readsOver(threeBlocks),
      page: address => {
        asked.push(address);
        return Promise.resolve({ document: threeBlocks, rev: undefined });
      },
    };

    await componentFromSelection(
      request({
        action: "convert",
        apply: "stored",
        page: { collection: "pages", id: "page-1", locale: "fr" },
        selectedIds: ["b"],
        fields,
      }),
      ctx,
      { reads }
    );

    expect(asked[0]).toMatchObject({ locale: "fr" });
    expect(updateEntryInTransaction.mock.calls[0]?.[4]).toMatchObject({
      locale: "fr",
    });
  });

  it("refuses a stored convert of a page the caller may not update", async () => {
    const { ctx, journal } = contextOver({ grants: { update: false } });

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "convert",
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: readsOver(threeBlocks) }
      )
    );

    expect(error.statusCode).toBe(403);
    expect(journal).toEqual([]);
  });

  it("says an API key ran it, and makes the writes under the key's own scope", async () => {
    const { ctx, createEntry } = contextOver({ apiKey: "key-9" });

    const { item } = await answered(
      await componentFromSelection(
        request({
          action: "save-as",
          document: threeBlocks,
          selectedIds: ["a"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(item.by).toEqual({
      kind: "api-key",
      userId: "u1",
      apiKeyId: "key-9",
    });
    expect(createEntry.mock.calls[0]?.[2]).toMatchObject({
      authenticatedScope: { roles: ["r"] },
    });
  });
});

describe("what it refuses", () => {
  it("answers a planner refusal with 422 and its cause, writing nothing", async () => {
    const { ctx, createEntry } = contextOver();

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "convert",
          document: threeBlocks,
          selectedIds: ["a", "c"],
          fields,
        }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(error.statusCode).toBe(422);
    expect(JSON.stringify(error.publicData)).toContain('"gap"');
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("refuses a convert that would nest components past the limit", async () => {
    const { ctx, createEntry } = contextOver();
    // A chain as deep as a page may place: converting it adds a level.
    const definitions: Record<string, BlockDocument> = {};
    let levels = 0;
    for (; levels < 20; levels += 1) {
      const chain = chainOf(levels + 1);
      const probe = await thrownBy(
        componentFromSelection(
          request({
            action: "convert",
            dryRun: true,
            document: page([placement("p", "c1")]),
            selectedIds: ["p"],
            fields,
          }),
          ctx,
          { reads: readsOver(null, chain) }
        )
      ).catch(() => undefined);
      if (probe !== undefined) {
        Object.assign(definitions, chain);
        break;
      }
    }

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "convert",
          document: page([placement("p", "c1")]),
          selectedIds: ["p"],
          fields,
        }),
        ctx,
        { reads: readsOver(null, definitions) }
      )
    );

    expect(error.statusCode).toBe(422);
    expect(JSON.stringify(error.publicData)).toContain('"composed-depth"');
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("refuses a library request that carries no document", async () => {
    const { ctx } = contextOver();

    const error = await thrownBy(
      componentFromSelection(
        request({ action: "save-as", selectedIds: ["a"], fields }),
        ctx,
        { reads: readsOver(null) }
      )
    );

    expect(error.statusCode).toBe(400);
  });
});

describe("in the API's stored mode", () => {
  it("creates the component and updates the page in one transaction", async () => {
    const { ctx, journal, updateEntryInTransaction } = contextOver({
      createdId: "cmp-3",
    });

    const { status } = await answered(
      await componentFromSelection(
        request({
          action: "convert",
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: readsOver(threeBlocks) }
      )
    );

    expect(status).toBe(201);
    expect(journal).toEqual([
      "begin",
      "create-in-tx",
      "update-in-tx",
      "commit",
    ]);
    const [, slug, id, data, opts] =
      updateEntryInTransaction.mock.calls[0] ?? [];
    expect([slug, id]).toEqual(["pages", "page-1"]);
    expect(opts).toMatchObject({ as: "user" });
    const written = (data as { content: BlockDocument }).content;
    expect(written.nodes[1]).toMatchObject({
      type: COMPONENT_INSTANCE_TYPE,
      props: { componentId: "cmp-3" },
    });
  });

  it("updates the page with the version read just before the write", async () => {
    // Planned from the first read, written after a second: a save of the page
    // in between is refused by the version this write sends.
    const { ctx, updateEntryInTransaction } = contextOver();
    await componentFromSelection(
      request({
        action: "convert",
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        selectedIds: ["b"],
        fields,
      }),
      ctx,
      { reads: readsOver(threeBlocks, {}, ["7", "8"]) }
    );
    expect(updateEntryInTransaction.mock.calls[0]?.[3]).toMatchObject({
      _rev: "8",
    });
  });

  it("rolls the create back when the page update fails", async () => {
    const { ctx, journal } = contextOver({ failUpdate: true });

    await expect(
      componentFromSelection(
        request({
          action: "convert",
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: readsOver(threeBlocks) }
      )
    ).rejects.toThrow("the page refused the write");
    expect(journal).toEqual([
      "begin",
      "create-in-tx",
      "update-in-tx",
      "rollback",
    ]);
  });

  it("refuses, writing nothing, when the page changed since the convert was planned", async () => {
    const { ctx, journal } = contextOver();
    const edited = page([node("a"), node("b"), node("c"), node("d")]);
    let reads = 0;
    const changing: ComponentFromSelectionReads = {
      ...readsOver(threeBlocks),
      page: () => {
        reads += 1;
        return Promise.resolve({
          document: reads === 1 ? threeBlocks : edited,
          rev: undefined,
        });
      },
    };

    const error = await thrownBy(
      componentFromSelection(
        request({
          action: "convert",
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          selectedIds: ["b"],
          fields,
        }),
        ctx,
        { reads: changing }
      )
    );

    expect(error.statusCode).toBe(409);
    expect(journal).toEqual(["begin", "create-in-tx", "rollback"]);
  });

  it("reconciles the usage indexes for the page and the component after the commit", async () => {
    const { ctx } = contextOver({ createdId: "cmp-4" });
    const reconcile = vi.fn(() => Promise.resolve());

    await componentFromSelection(
      request({
        action: "convert",
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        selectedIds: ["b"],
        fields,
      }),
      ctx,
      {
        reads: readsOver(threeBlocks),
        reconcile: () => reconcile,
        directApi: () => ({}) as never,
      }
    );

    expect(reconcile.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ slug: "pages", documentId: "page-1" }),
      expect.objectContaining({ slug: "components", documentId: "cmp-4" }),
    ]);
  });
});

/** `levels` components, each placing the next. */
function chainOf(levels: number): Record<string, BlockDocument> {
  const chain: Record<string, BlockDocument> = {};
  for (let level = 1; level <= levels; level += 1) {
    chain[`c${level}`] = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        level === levels
          ? node(`leaf-${level}`)
          : placement(`inner-${level}`, `c${level + 1}`),
      ],
    };
  }
  return chain;
}
