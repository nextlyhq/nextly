/**
 * Detach, duplicate and update-pattern through their routes, against stubs:
 * who may run each, what each writes and as whom, what a dry run leaves
 * untouched, and what each hands the editor.
 */
import {
  applyOps,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import { describe, expect, it, vi } from "vitest";

import {
  detachPlacement,
  duplicateComponent,
  updatePatternFromSelection,
  type ComponentActionReads,
  type ReadComponent,
} from "./component-actions-route";
import type {
  DetachResult,
  DuplicateResult,
  UpdatePatternResult,
} from "./component-actions-contract";
import type {
  CompositionRouteContext,
  StoredPageRead,
} from "./composition-route-kit";
import type { OriginStore } from "./origin-store";

const heading = (id: string, text: string): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {}
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...props },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const CARD: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading("title", "Card title")],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "title",
      propPath: "text",
      type: "text",
    },
  ],
};

const CARD_DRAFT: ComponentDocument = {
  ...CARD,
  nodes: [heading("title", "A newer title, not yet published")],
};

type Grants = Partial<
  Record<"create" | "publish" | "update" | "read", boolean>
>;

function contextOver(
  options: {
    grants?: Grants;
    params?: Record<string, string>;
    apiKey?: string;
  } = {}
) {
  const grants: Grants = {
    create: true,
    publish: true,
    update: true,
    read: true,
    ...options.grants,
  };
  const journal: string[] = [];
  const services = {
    createEntry: vi.fn((_slug: string, _data: Record<string, unknown>) => {
      journal.push("create");
      return Promise.resolve({ item: { id: "copy-1" } });
    }),
    updateEntry: vi.fn(
      (_slug: string, _id: string, _data: Record<string, unknown>) => {
        journal.push("update");
        return Promise.resolve({ item: { id: "x" } });
      }
    ),
    withTransaction: vi.fn(async <T>(work: (tx: unknown) => Promise<T>) => {
      journal.push("begin");
      const done = await work({});
      journal.push("commit");
      return done;
    }),
    createEntryInTransaction: vi.fn(() => {
      journal.push("create-in-tx");
      return Promise.resolve({ id: "copy-1" });
    }),
    updateEntryInTransaction: vi.fn(
      (
        _tx: unknown,
        _slug: string,
        _id: string,
        _data: Record<string, unknown>
      ) => {
        journal.push("update-in-tx");
        return Promise.resolve({ id: "x" });
      }
    ),
    warmLocalizedReadiness: () => Promise.resolve(),
  };
  const ctx = {
    self: { collections: {} },
    user: { id: "u1", email: "u1@example.test" },
    authenticatedScope: undefined,
    params: options.params ?? {},
    caller: {
      authMethod: options.apiKey === undefined ? "session" : "api-key",
      ...(options.apiKey === undefined ? {} : { apiKeyId: options.apiKey }),
      identity: () => Promise.resolve({}),
      can: (action: keyof Grants) => Promise.resolve(grants[action] === true),
    },
    services: { collections: services },
  } as unknown as CompositionRouteContext;
  return { ctx, journal, services };
}

/** A stored page as a read gives it: the document and the read's version. */
function pageRead(document: BlockDocument, rev?: string): StoredPageRead {
  return { document, rev };
}

function readsOver(
  options: {
    shown?: Record<string, ReadComponent>;
    published?: Record<string, ReadComponent>;
    stored?: BlockDocument | null;
    /** The version each successive page read gives, the last one repeated. */
    revs?: readonly string[];
    pattern?: unknown;
  } = {}
): ComponentActionReads {
  let reads = 0;
  return {
    page: () => {
      const revs = options.revs ?? [];
      const rev = revs[Math.min(reads, revs.length - 1)];
      reads += 1;
      return Promise.resolve(
        options.stored ? pageRead(options.stored, rev) : null
      );
    },
    shown: id => Promise.resolve(options.shown?.[id] ?? null),
    published: id => Promise.resolve(options.published?.[id] ?? null),
    pattern: () => Promise.resolve(options.pattern ?? null),
  };
}

const card = (document: ComponentDocument): ReadComponent => ({
  title: "Card",
  document,
});

function request(body: unknown): Request {
  return new Request("https://example.test/x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function itemOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { item: T }).item;
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

describe("detaching a placement", () => {
  const doc = page([
    heading("before", "Before"),
    placement("p", "card", { overrides: { title: "This page's title" } }),
  ]);

  it("answers ops that leave the placement's content as plain blocks, writing nothing", async () => {
    const { ctx, journal } = contextOver();
    const reads = readsOver({
      shown: { card: card(CARD) },
      published: { card: card(CARD) },
    });

    const item = await itemOf<DetachResult>(
      await detachPlacement(request({ document: doc, instanceId: "p" }), ctx, {
        reads,
      })
    );

    expect(journal).toEqual([]);
    const after = applyOps(doc, item.pageOps as BuilderOp[]).document;
    expect(after.nodes.map(n => n.type)).toEqual([
      "core/heading",
      "core/heading",
    ]);
    expect(after.nodes[1]?.props?.text).toBe("This page's title");
    expect(item.unpublishedChanges).toBe(false);
    expect(item.component).toEqual({ id: "card", title: "Card" });
  });

  it("detaches what the canvas shows, and says the component has unpublished changes", async () => {
    const { ctx } = contextOver();
    const reads = readsOver({
      shown: { card: card(CARD_DRAFT) },
      published: { card: card(CARD) },
    });

    const item = await itemOf<DetachResult>(
      await detachPlacement(
        request({ document: page([placement("p", "card")]), instanceId: "p" }),
        ctx,
        { reads }
      )
    );

    expect(item.unpublishedChanges).toBe(true);
    const after = applyOps(
      page([placement("p", "card")]),
      item.pageOps as BuilderOp[]
    ).document;
    expect(after.nodes[0]?.props?.text).toBe(
      "A newer title, not yet published"
    );
  });

  it("writes the stored page in stored mode, as the caller", async () => {
    const { ctx, services } = contextOver();
    const reads = readsOver({
      stored: doc,
      shown: { card: card(CARD) },
      published: { card: card(CARD) },
    });

    await detachPlacement(
      request({
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        instanceId: "p",
      }),
      ctx,
      { reads }
    );

    const [slug, id, data] = services.updateEntry.mock.calls[0] ?? [];
    expect([slug, id]).toEqual(["pages", "page-1"]);
    const written = (data as { content: BlockDocument }).content;
    expect(written.nodes.map(n => n.type)).toEqual([
      "core/heading",
      "core/heading",
    ]);
  });

  it("writes nothing in stored mode on a dry run", async () => {
    const { ctx, journal } = contextOver();
    const reads = readsOver({
      stored: doc,
      shown: { card: card(CARD) },
      published: { card: card(CARD) },
    });

    const item = await itemOf<DetachResult>(
      await detachPlacement(
        request({
          apply: "stored",
          dryRun: true,
          page: { collection: "pages", id: "page-1" },
          instanceId: "p",
        }),
        ctx,
        { reads }
      )
    );

    expect(item.dryRun).toBe(true);
    expect(journal).toEqual([]);
  });

  it("reads the definitions in the language the editor shows", async () => {
    const { ctx } = contextOver();
    const asked: unknown[] = [];
    const reads: ComponentActionReads = {
      ...readsOver({ published: { card: card(CARD) } }),
      shown: (id, _ctx, locale) => {
        asked.push(locale);
        return Promise.resolve(id === "card" ? card(CARD) : null);
      },
    };

    await detachPlacement(
      request({ document: doc, instanceId: "p", locale: "fr" }),
      ctx,
      { reads }
    );

    expect(asked).toContain("fr");
  });

  it("reads and writes a stored page in the language named", async () => {
    const { ctx, services } = contextOver();
    const reads = readsOver({
      stored: doc,
      shown: { card: card(CARD) },
      published: { card: card(CARD) },
    });

    await detachPlacement(
      request({
        apply: "stored",
        page: { collection: "pages", id: "page-1", locale: "fr" },
        instanceId: "p",
      }),
      ctx,
      { reads }
    );

    expect(services.updateEntry.mock.calls[0]?.[3]).toMatchObject({
      locale: "fr",
    });
  });

  it("refuses a stored detach, writing nothing, when the page changed meanwhile", async () => {
    const { ctx, journal } = contextOver();
    const edited = page([
      heading("before", "Edited elsewhere"),
      placement("p", "card"),
    ]);
    let read = 0;
    const reads: ComponentActionReads = {
      ...readsOver({
        shown: { card: card(CARD) },
        published: { card: card(CARD) },
      }),
      page: () => {
        read += 1;
        return Promise.resolve(pageRead(read === 1 ? doc : edited));
      },
    };

    const error = await thrownBy(
      detachPlacement(
        request({
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          instanceId: "p",
        }),
        ctx,
        { reads }
      )
    );

    expect(error.statusCode).toBe(409);
    expect(journal).toEqual([]);
  });

  it("reads only the components the selected placement reaches", async () => {
    const { ctx } = contextOver();
    const asked: string[] = [];
    const reads: ComponentActionReads = {
      ...readsOver({ published: { card: card(CARD) } }),
      shown: id => {
        asked.push(id);
        return Promise.resolve(id === "card" ? card(CARD) : null);
      },
    };

    await detachPlacement(
      request({
        document: page([
          placement("other", "elsewhere"),
          placement("p", "card"),
        ]),
        instanceId: "p",
      }),
      ctx,
      { reads }
    );

    expect(asked).toEqual(["card"]);
  });

  it("refuses a block that is not a placement", async () => {
    const { ctx } = contextOver();
    const error = await thrownBy(
      detachPlacement(request({ document: doc, instanceId: "before" }), ctx, {
        reads: readsOver(),
      })
    );
    expect(error.statusCode).toBe(400);
  });

  it("refuses a stored detach of a page the caller may not update", async () => {
    const { ctx, journal } = contextOver({ grants: { update: false } });
    const error = await thrownBy(
      detachPlacement(
        request({
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          instanceId: "p",
        }),
        ctx,
        { reads: readsOver({ stored: doc }) }
      )
    );
    expect(error.statusCode).toBe(403);
    expect(journal).toEqual([]);
  });
});

describe("duplicating a component", () => {
  const twoPlacements = page([
    placement("p1", "card", { overrides: { title: "Mine" } }),
    placement("p2", "card"),
  ]);

  it("copies the published definition, records its origin, and re-points only the placement it came from", async () => {
    const { ctx, services } = contextOver({ params: { id: "card" } });
    const record = vi.fn(() => Promise.resolve());
    const origins: OriginStore = {
      record,
      sourceOf: () => Promise.resolve(null),
    };

    const item = await itemOf<DuplicateResult>(
      await duplicateComponent(
        request({ placement: { document: twoPlacements, instanceId: "p1" } }),
        ctx,
        {
          reads: readsOver({
            published: { card: card(CARD) },
            shown: { card: card(CARD_DRAFT) },
          }),
          origins: () => origins,
        }
      )
    );

    const [slug, data] = services.createEntry.mock.calls[0] ?? [];
    expect(slug).toBe("components");
    expect(data).toMatchObject({ title: "Card copy", status: "published" });
    const copied = (data as { content: ComponentDocument }).content;
    // The published definition, independent of the source: fresh node ids,
    // the same exposed ids so the placement's own values carry over.
    expect(copied.nodes[0]?.props?.text).toBe("Card title");
    expect(copied.nodes[0]?.id).not.toBe("title");
    expect(copied.exposed?.[0]?.id).toBe("title");
    expect(record).toHaveBeenCalledWith("copy-1", "card");

    const after = applyOps(twoPlacements, item.pageOps as BuilderOp[]).document;
    expect(after.nodes[0]?.props).toEqual({
      componentId: "copy-1",
      overrides: { title: "Mine" },
    });
    expect(after.nodes[1]?.props).toEqual({ componentId: "card" });
  });

  it("only copies when asked from the library", async () => {
    const { ctx } = contextOver({ params: { id: "card" } });
    const item = await itemOf<DuplicateResult>(
      await duplicateComponent(request({}), ctx, {
        reads: readsOver({ published: { card: card(CARD) } }),
      })
    );
    expect(item.pageOps).toEqual([]);
  });

  it("writes nothing on a dry run", async () => {
    const { ctx, journal } = contextOver({ params: { id: "card" } });
    const record = vi.fn(() => Promise.resolve());
    await duplicateComponent(request({ dryRun: true }), ctx, {
      reads: readsOver({ published: { card: card(CARD) } }),
      origins: () => ({ record, sourceOf: () => Promise.resolve(null) }),
    });
    expect(journal).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("re-points a stored placement in the same transaction as the create", async () => {
    const { ctx, journal, services } = contextOver({ params: { id: "card" } });
    await duplicateComponent(
      request({
        placement: {
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          instanceId: "p2",
        },
      }),
      ctx,
      {
        reads: readsOver({
          stored: twoPlacements,
          published: { card: card(CARD) },
        }),
      }
    );
    expect(journal).toEqual([
      "begin",
      "create-in-tx",
      "update-in-tx",
      "commit",
    ]);
    const written = (
      services.updateEntryInTransaction.mock.calls[0]?.[3] as {
        content: BlockDocument;
      }
    ).content;
    expect(written.nodes.map(n => n.props?.componentId)).toEqual([
      "card",
      "copy-1",
    ]);
  });

  it("rolls the copy back when the stored page changed before the re-point", async () => {
    const { ctx, journal } = contextOver({ params: { id: "card" } });
    let read = 0;
    const reads: ComponentActionReads = {
      ...readsOver({ published: { card: card(CARD) } }),
      page: () => {
        read += 1;
        return Promise.resolve(
          pageRead(read === 1 ? twoPlacements : page([placement("p2", "card")]))
        );
      },
    };

    await expect(
      duplicateComponent(
        request({
          placement: {
            apply: "stored",
            page: { collection: "pages", id: "page-1" },
            instanceId: "p2",
          },
        }),
        ctx,
        { reads }
      )
    ).rejects.toThrow();
    expect(journal).toEqual(["begin", "create-in-tx"]);
  });

  it("refuses an author who may not publish components", async () => {
    const { ctx, journal } = contextOver({
      params: { id: "card" },
      grants: { publish: false },
    });
    const error = await thrownBy(
      duplicateComponent(request({}), ctx, {
        reads: readsOver({ published: { card: card(CARD) } }),
      })
    );
    expect(error.statusCode).toBe(403);
    expect(journal).toEqual([]);
  });

  it("refuses a host that keeps components in a store of its own", async () => {
    const { ctx, journal } = contextOver({ params: { id: "card" } });
    const error = await thrownBy(
      duplicateComponent(request({}), ctx, {
        reads: readsOver({ published: { card: card(CARD) } }),
        store: { collection: "site_blocks", field: "body" },
      })
    );
    expect(error.statusCode).toBe(422);
    expect(journal).toEqual([]);
  });

  it("answers 404 for a source the caller may not read", async () => {
    const { ctx, journal } = contextOver({ params: { id: "card" } });
    const error = await thrownBy(
      duplicateComponent(request({}), ctx, { reads: readsOver({}) })
    );
    expect(error.statusCode).toBe(404);
    expect(journal).toEqual([]);
  });

  it("still answers success when the origin cannot be recorded", async () => {
    const { ctx } = contextOver({ params: { id: "card" } });
    const response = await duplicateComponent(request({}), ctx, {
      reads: readsOver({ published: { card: card(CARD) } }),
      origins: () => ({
        record: () => Promise.reject(new Error("bookkeeping unavailable")),
        sourceOf: () => Promise.resolve(null),
      }),
    });
    expect(response.status).toBe(201);
  });

  it("refuses a placement of a different component", async () => {
    const { ctx } = contextOver({ params: { id: "other" } });
    const error = await thrownBy(
      duplicateComponent(
        request({ placement: { document: twoPlacements, instanceId: "p1" } }),
        ctx,
        { reads: readsOver({ published: { other: card(CARD) } }) }
      )
    );
    expect(error.statusCode).toBe(400);
  });
});

describe("updating a pattern from a selection", () => {
  const doc = page([heading("a", "New hero"), heading("b", "Elsewhere")]);

  it("replaces the pattern's content, published, as the caller", async () => {
    const { ctx, services } = contextOver({ params: { id: "pat-1" } });
    const item = await itemOf<UpdatePatternResult>(
      await updatePatternFromSelection(
        request({ document: doc, selectedIds: ["a"] }),
        ctx,
        { reads: readsOver({ pattern: { id: "pat-1" } }) }
      )
    );
    const [slug, id, data] = services.updateEntry.mock.calls[0] ?? [];
    expect([slug, id]).toEqual(["patterns", "pat-1"]);
    expect(data).toMatchObject({ status: "published" });
    const stored = (data as { content: BlockDocument }).content;
    expect(stored.nodes.map(n => n.props?.text)).toEqual(["New hero"]);
    expect(item.pattern).toEqual({ id: "pat-1" });
  });

  it("writes nothing on a dry run", async () => {
    const { ctx, journal } = contextOver({ params: { id: "pat-1" } });
    await updatePatternFromSelection(
      request({ document: doc, selectedIds: ["a"], dryRun: true }),
      ctx,
      { reads: readsOver({ pattern: { id: "pat-1" } }) }
    );
    expect(journal).toEqual([]);
  });

  it("refuses an author who may not publish patterns", async () => {
    const { ctx, journal } = contextOver({
      params: { id: "pat-1" },
      grants: { publish: false },
    });
    const error = await thrownBy(
      updatePatternFromSelection(
        request({ document: doc, selectedIds: ["a"] }),
        ctx,
        { reads: readsOver({ pattern: { id: "pat-1" } }) }
      )
    );
    expect(error.statusCode).toBe(403);
    expect(journal).toEqual([]);
  });

  it("answers 404 for a pattern the caller cannot read", async () => {
    const { ctx } = contextOver({ params: { id: "nope" } });
    const error = await thrownBy(
      updatePatternFromSelection(
        request({ document: doc, selectedIds: ["a"] }),
        ctx,
        { reads: readsOver({ pattern: null }) }
      )
    );
    expect(error.statusCode).toBe(404);
  });
});

describe("the version each write sends", () => {
  // A write made from a read sends the version that read gave, so a save of
  // the page made in between refuses the write instead of being overwritten.
  // A stored page is read twice, to plan and again just before the write; the
  // second read is the one the write is made from.
  const detachable = page([
    heading("before", "Before"),
    placement("p", "card"),
  ]);
  const duplicable = page([placement("p1", "card"), placement("p2", "card")]);

  it("detaching on a stored page sends the version read just before the write", async () => {
    const { ctx, services } = contextOver();
    await detachPlacement(
      request({
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        instanceId: "p",
      }),
      ctx,
      {
        reads: readsOver({
          stored: detachable,
          revs: ["7", "8"],
          shown: { card: card(CARD) },
          published: { card: card(CARD) },
        }),
      }
    );
    expect(services.updateEntry.mock.calls[0]?.[2]).toMatchObject({
      _rev: "8",
    });
  });

  it("re-pointing a stored placement after a duplicate sends the version read just before the write", async () => {
    const { ctx, services } = contextOver({ params: { id: "card" } });
    await duplicateComponent(
      request({
        placement: {
          apply: "stored",
          page: { collection: "pages", id: "page-1" },
          instanceId: "p2",
        },
      }),
      ctx,
      {
        reads: readsOver({
          stored: duplicable,
          revs: ["7", "8"],
          published: { card: card(CARD) },
        }),
      }
    );
    expect(services.updateEntryInTransaction.mock.calls[0]?.[3]).toMatchObject({
      _rev: "8",
    });
  });

  it("updating a pattern sends the version the pattern was read at", async () => {
    const { ctx, services } = contextOver({ params: { id: "pat-1" } });
    await updatePatternFromSelection(
      request({
        document: page([heading("a", "New hero")]),
        selectedIds: ["a"],
      }),
      ctx,
      { reads: readsOver({ pattern: { id: "pat-1", _rev: "3" } }) }
    );
    expect(services.updateEntry.mock.calls[0]?.[2]).toMatchObject({
      _rev: "3",
    });
  });

  it("sends no version when the read gave none", async () => {
    // A server that issues no versions is written to as before.
    const { ctx, services } = contextOver();
    await detachPlacement(
      request({
        apply: "stored",
        page: { collection: "pages", id: "page-1" },
        instanceId: "p",
      }),
      ctx,
      {
        reads: readsOver({
          stored: detachable,
          shown: { card: card(CARD) },
          published: { card: card(CARD) },
        }),
      }
    );
    expect(services.updateEntry.mock.calls[0]?.[2]).not.toHaveProperty("_rev");
  });
});
