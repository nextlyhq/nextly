/**
 * What actually reaches the table when an author saves a selection.
 *
 * The assertions that matter most are the ones an author never sees. That the
 * write runs as the USER rather than with the instance's identity, that it names
 * the collection the host actually has, that the tree is stored under the field
 * the collection declares, and that the row is created in a state the library
 * will offer — each of those fails silently. A pattern written with the
 * instance's identity is a permission check nobody performs; one written to the
 * declared slug on a renamed collection is a table that does not exist; one
 * stored under the wrong field is a row the panel drops without a word; and one
 * left in the default state is a save the author cannot find afterwards.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import { describe, expect, it, vi } from "vitest";

import { PATTERNS_SLUG, patternsCollection } from "./collections/patterns";
import {
  savePattern,
  type SavePatternRouteContext,
} from "./save-pattern-route";

function node(id: string, type = "core/box"): BlockNode {
  return { id, type, version: 1, props: {} };
}

/** A page holding three top-level siblings, so a run and a gap are both sayable. */
const pageDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [node("a"), node("b", "core/text"), node("c")],
};

/** The metadata the collection requires of every pattern. */
const fields = { title: "Hero", granularity: "section" };

function request(body: unknown): Request {
  return new Request("https://example.test/save-as-pattern", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * A context whose service records the write rather than performing one.
 *
 * The spy is the point: what this route decides is WHAT it writes and AS WHOM,
 * so the arguments it passed are the observable behaviour.
 */
function contextOver(
  self: Record<string, string | undefined> = {},
  answer: { item: unknown; warnings?: unknown } = { item: { id: "p1" } }
) {
  const createEntry = vi.fn(
    (_slug: string, _data: Record<string, unknown>, _ctx: unknown) =>
      Promise.resolve(answer as { item: unknown })
  );
  const ctx = {
    self: { collections: self },
    user: { id: "u1" },
    services: { collections: { createEntry } },
  } as unknown as SavePatternRouteContext;
  return { ctx, createEntry };
}

/** The data the route handed the collection service. */
function written(createEntry: ReturnType<typeof contextOver>["createEntry"]) {
  return createEntry.mock.calls[0]?.[1] as Record<string, unknown>;
}

/** The error a call threw, refusing to let a resolved promise pass as one. */
async function thrownBy(run: Promise<unknown>): Promise<NextlyError> {
  try {
    await run;
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("expected the save to be refused, and it was not");
}

describe("where a saved pattern goes", () => {
  it("writes to the collection the host actually has", async () => {
    // A host may rename a plugin's collection. Writing to the DECLARED slug
    // then writes to a table that does not exist, and the failure names a
    // collection nobody has heard of.
    const { ctx, createEntry } = contextOver({
      [PATTERNS_SLUG]: "site_blocks",
    });

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields }),
      ctx
    );

    expect(createEntry.mock.calls[0]?.[0]).toBe("site_blocks");
  });

  it("falls back to the declared slug when the host renamed nothing", async () => {
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields }),
      ctx
    );

    expect(createEntry.mock.calls[0]?.[0]).toBe(PATTERNS_SLUG);
  });

  it("writes AS THE USER, not with the instance's identity", async () => {
    // What makes an authenticated route also AUTHORIZED. A write with the
    // instance's own identity lets any signed-in caller create a pattern
    // whatever the collection's permissions say, and records the wrong author
    // on the version it writes.
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields }),
      ctx
    );

    expect(createEntry.mock.calls[0]?.[2]).toEqual({
      as: "user",
      user: { id: "u1" },
    });
  });
});

describe("what a saved pattern is made of", () => {
  it("stores the run as a PATTERN document, under the field the collection declares", async () => {
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a", "b"], fields }),
      ctx
    );

    // The field name is the translation this module makes: the collection calls
    // the tree `content` and every other surface calls it the document. Stored
    // under any other name, the row reads back as a pattern with no tree, which
    // the panel drops in silence.
    const stored = written(createEntry).content as {
      kind: string;
      nodes: BlockNode[];
    };
    expect(stored.kind).toBe("pattern");
    expect(stored.nodes.map(root => root.type)).toEqual([
      "core/box",
      "core/text",
    ]);
  });

  it("stores a COPY, with ids of its own", async () => {
    // Copy-on-insert is the whole difference between a pattern and a component,
    // and it starts here: a stored pattern that kept the page's ids would
    // collide with the page it was saved from the first time it was inserted
    // back into it.
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a", "b"], fields }),
      ctx
    );

    const stored = written(createEntry).content as { nodes: BlockNode[] };
    expect(stored.nodes.map(root => root.id)).not.toContain("a");
    expect(stored.nodes.map(root => root.id)).not.toContain("b");
  });

  it("creates it PUBLISHED, so the library it was saved for shows it", async () => {
    // The status column defaults to `draft`, and the library read is bounded to
    // public states — so a save that left the default answers the author with a
    // pattern their own insert panel does not list, which looks exactly like a
    // save that failed.
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields }),
      ctx
    );

    expect(written(createEntry).status).toBe("published");
  });

  it("carries the metadata the collection declares, and NOTHING else the caller sent", async () => {
    // The whole key set rather than a check per unwanted name: a route that
    // forwarded the body would keep passing a `not.toHaveProperty` written
    // about whichever key someone thought of.
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({
        document: pageDocument,
        selectedIds: ["a"],
        fields: {
          ...fields,
          description: "The top of the page",
          // A column rather than a declared field: settable here would let a
          // caller choose the row's primary key.
          id: "forged",
          // The state this route decides. A caller choosing it could save a
          // pattern nobody can find, or publish without the route saying so.
          status: "draft",
          // The planner's output. Two answers about what to store, and the one
          // the insert panel's guarantee rests on is the planner's.
          content: { kind: "pattern", nodes: [] },
          // A key no version of this collection has ever declared.
          invented: true,
        },
      }),
      ctx
    );

    expect(Object.keys(written(createEntry)).sort()).toEqual([
      "content",
      "description",
      "granularity",
      "slug",
      "status",
      "title",
    ]);
    // Present because the route derived it, not because the caller sent one —
    // which is what makes the key set above six rather than five.
    expect(written(createEntry).slug).toBe("hero");
    expect(written(createEntry).status).toBe("published");
    expect(
      (written(createEntry).content as { nodes: BlockNode[] }).nodes
    ).toHaveLength(1);
  });

  it("settles what may be sent against the collection, not against a list", async () => {
    // The guard above passes for a hardcoded allowlist too. This is the part
    // that cannot: every field the collection declares, except the one the
    // planner owns, is accepted — so a field added to the collection is
    // settable without this module being edited, and a column the collection
    // never declared is not settable however it is spelled.
    const declared = patternsCollection()
      .fields.map(field => field.name)
      .filter(
        (name): name is string => name !== undefined && name !== "content"
      );
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({
        document: pageDocument,
        selectedIds: ["a"],
        fields: Object.fromEntries(
          declared.map(name => [
            name,
            name === "granularity" ? "section" : name,
          ])
        ),
      }),
      ctx
    );

    expect(declared.length).toBeGreaterThan(1);
    for (const name of declared) {
      expect(written(createEntry)).toHaveProperty(name);
    }
  });
});

describe("what a completed save answers", () => {
  it("answers the CANONICAL mutation envelope, not a shape of its own", async () => {
    // Every other write in this codebase answers `{ message, item }`, and a
    // plugin's write inventing its own shape is the one write a shared client
    // cannot read. Asserted as the whole key set rather than by picking `item`
    // out of it, because a body that carried the row beside some other spelling
    // would satisfy a narrower check.
    const { ctx } = contextOver(
      {},
      { item: { id: "pattern-7", title: "Hero" } }
    );

    const response = await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields }),
      ctx
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["item", "message"]);
    expect(body.item).toEqual({ id: "pattern-7", title: "Hero" });
    expect(typeof body.message).toBe("string");
  });

  it("refuses to report a save it cannot address afterwards", async () => {
    // The row has already committed, so this is not a rollback — it is the
    // difference between telling the caller the save is unusable and putting a
    // row with no id in the envelope, which every surface reads as a success.
    const { ctx } = contextOver({}, { item: { title: "Hero" } });

    const error = await thrownBy(
      savePattern(
        request({ document: pageDocument, selectedIds: ["a"], fields }),
        ctx
      )
    );

    expect(error.statusCode).toBe(500);
  });
});

describe("the identifier a pattern is keyed by", () => {
  it("derives the slug from the title, so nobody is asked for one", async () => {
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({
        document: pageDocument,
        selectedIds: ["a"],
        fields: { title: "Hero Banner!", granularity: "section" },
      }),
      ctx
    );

    expect(written(createEntry).slug).toBe("hero-banner");
  });

  it("keeps a slug the caller stated, because an API caller may own one", async () => {
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({
        document: pageDocument,
        selectedIds: ["a"],
        fields: { title: "Hero", slug: "legacy-hero", granularity: "section" },
      }),
      ctx
    );

    expect(written(createEntry).slug).toBe("legacy-hero");
  });

  it.each([["見出しセクション"], ["Заголовок"], ["Πρότυπο"], ["!!!"]])(
    "still produces a usable slug for %s",
    async title => {
      // `slugify` keeps `[a-z0-9]`, so every one of these derives to the empty
      // string — and an empty slug is refused by a required field. Without the
      // fallback the whole feature is unavailable on any site that does not
      // write its titles in Latin script.
      const { ctx, createEntry } = contextOver();

      await savePattern(
        request({
          document: pageDocument,
          selectedIds: ["a"],
          fields: { title, granularity: "section" },
        }),
        ctx
      );

      expect(written(createEntry).slug).toEqual(expect.stringMatching(/^.+$/));
    }
  );

  it("gives two untransliterable titles DIFFERENT slugs", async () => {
    // The fallback has to be an identifier rather than a constant: one shared
    // fallback would make the second such pattern collide with the first on a
    // unique column, so a Japanese site could store exactly one pattern.
    const slugs = new Set<string>();
    for (const _ of [0, 1]) {
      const { ctx, createEntry } = contextOver();
      await savePattern(
        request({
          document: pageDocument,
          selectedIds: ["a"],
          fields: { title: "見出し", granularity: "section" },
        }),
        ctx
      );
      slugs.add(String(written(createEntry).slug));
    }

    expect(slugs.size).toBe(2);
  });
});

describe("what the route refuses, and how it says so", () => {
  it("refuses a selection the planner will not save, and names the rule", async () => {
    // `a` and `c` share a parent with `b` between them. The cause travels
    // verbatim because it is a `PlanProblem`, which is what the caller compares
    // against — a re-spelling would agree only while someone maintained it.
    const { ctx, createEntry } = contextOver();

    const error = await thrownBy(
      savePattern(
        request({ document: pageDocument, selectedIds: ["a", "c"], fields }),
        ctx
      )
    );

    expect(error.statusCode).toBe(422);
    expect(error.publicData).toEqual({
      errors: [
        { path: "selectedIds", code: "gap", message: expect.any(String) },
      ],
    });
    // Refused BEFORE the write, not after it: a refusal that has already
    // created the row is a pattern the author was told they could not save.
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("refuses an id the document does not hold", async () => {
    const { ctx } = contextOver();

    const error = await thrownBy(
      savePattern(
        request({ document: pageDocument, selectedIds: ["nowhere"], fields }),
        ctx
      )
    );

    expect(error.statusCode).toBe(422);
  });

  it("refuses a body that is not JSON at all", async () => {
    // 400 rather than the 500 an unhandled parse failure produces. A caller
    // sending a broken body is not a server fault, and reporting it as one
    // sends whoever reads the log looking at the wrong side.
    const { ctx } = contextOver();

    const error = await thrownBy(savePattern(request("{"), ctx));

    expect(error.statusCode).toBe(400);
  });

  it.each([
    ["document", { selectedIds: ["a"], fields }],
    ["document", { document: {}, selectedIds: ["a"], fields }],
    [
      "document",
      {
        document: { formatVersion: 1, kind: "page" },
        selectedIds: ["a"],
        fields,
      },
    ],
    [
      "document",
      {
        document: { formatVersion: 1, kind: "page", nodes: "x" },
        selectedIds: ["a"],
        fields,
      },
    ],
    ["selectedIds", { document: pageDocument, fields }],
    ["fields", { document: pageDocument, selectedIds: ["a"] }],
  ])("refuses a request whose %s is not one", async (path, body) => {
    const { ctx, createEntry } = contextOver();

    const error = await thrownBy(savePattern(request(body), ctx));

    expect(error.statusCode).toBe(400);
    expect(error.publicData).toMatchObject({ errors: [{ path }] });
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("refuses an empty selection rather than saving an empty pattern", async () => {
    const { ctx } = contextOver();

    const error = await thrownBy(
      savePattern(
        request({ document: pageDocument, selectedIds: [], fields }),
        ctx
      )
    );

    expect(error.statusCode).toBe(400);
  });

  it("leaves the collection's own rules to the collection", async () => {
    // Which metadata are required, how long they may be, and whether a slug is
    // taken are enforced on every other path into the same table. A second copy
    // here would drift, and it would drift silently — two copies passing looks
    // exactly like one of them being right. So a save with no title reaches the
    // service, which refuses it.
    const { ctx, createEntry } = contextOver();

    await savePattern(
      request({ document: pageDocument, selectedIds: ["a"], fields: {} }),
      ctx
    );

    expect(createEntry).toHaveBeenCalled();
    expect(written(createEntry)).not.toHaveProperty("title");
  });
});
