/**
 * A list read as a visitor reads it, for the canvas while a document's
 * visibility conditions are applied: answered only for a document the caller
 * may open, checked first, and then only with what an anonymous visitor
 * reads, published entries and public fields.
 *
 * Core is replaced by a handle that answers as core's gate does: a published
 * read finds published rows only, and a field only a signed-in reader may see
 * comes back only to a read that names a user. So an answer holding a draft
 * entry or that field means the route read as someone other than a visitor.
 *
 * @module list-entries-route.visitor.test
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nextly = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
  findSingle: vi.fn(),
}));

vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    requireNextly: () => nextly,
    // The real public reader, told what is hidden as a reader over a stand-in
    // is: no schema is registered here for it to read that from.
    createPublicReader: (
      reader: Parameters<typeof actual.createPublicReader>[0],
      binding: Parameters<typeof actual.createPublicReader>[1]
    ) =>
      actual.createPublicReader(reader, {
        ...binding,
        declarations: { hiddenFields: async () => [] },
      }),
  };
});

import { LIST_ENTRIES_ROUTE_PATH } from "./list-entries-contract";
import { listEntriesRoute } from "./list-entries-route";
import type { TemplateGuardSetup } from "./templates/template-guard";

const RECORDS: Record<string, Record<string, unknown>> = {
  pages: {
    slug: "pages",
    label: "Page",
    fields: [
      { name: "title", type: "text" },
      { name: "content", type: "blocks" },
    ],
  },
  authors: {
    slug: "authors",
    label: "Author",
    fields: [{ name: "name", type: "text" }],
  },
};

const PUBLISHED = { id: "e1", title: "Field notes", status: "published" };
const DRAFT_ONLY = { id: "e2", title: "Members' launch", status: "draft" };

/** Core as its gate answers: the page opens; posts read as a visitor or a user would. */
function answerAsCore(args: Record<string, unknown>) {
  // The open check: the page's id, every status, as the caller.
  if (args.collection === "pages") {
    const asked = (args.where as { id?: { equals?: unknown } } | undefined)?.id
      ?.equals;
    return args.status === "all" && asked === "p1"
      ? { items: [{ id: "p1" }], meta: { total: 1 } }
      : { items: [], meta: { total: 0 } };
  }
  const signedIn = args.user !== undefined;
  const rows = (
    args.status === "published" ? [PUBLISHED] : [PUBLISHED, DRAFT_ONLY]
  ).map(row => (signedIn ? { ...row, secret: "only for members" } : row));
  return { items: rows, meta: { total: rows.length } };
}

const ctx = {
  self: { collections: {} },
  logger: { warn: () => undefined },
  caller: {
    authMethod: "session",
    can: async () => true,
    identity: async () => ({ user: { id: "u1", roles: ["editor"] } }),
  },
} as unknown as PluginRouteContext;

const guard = (): TemplateGuardSetup =>
  ({
    readCollection: async (slug: string) => RECORDS[slug] ?? null,
    ownCollections: () => new Set<string>(),
  }) as unknown as TemplateGuardSetup;

async function ask(body: unknown): Promise<Response> {
  return listEntriesRoute(() => undefined, guard).handler(
    new Request(`http://nextly.test/plugins/x${LIST_ENTRIES_ROUTE_PATH}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx
  );
}

/** A refusal as a caller receives it: everything the answer carries. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    return JSON.stringify({
      code: error.code,
      statusCode: error.statusCode,
      publicMessage: error.publicMessage,
      publicData: error.publicData ?? null,
    });
  }
  throw new Error("expected a refusal");
}

const QUERY = { collection: "posts", limit: 10 };

beforeEach(() => {
  nextly.find.mockReset();
  nextly.find.mockImplementation(async (args: Record<string, unknown>) =>
    answerAsCore(args)
  );
});

describe("a list read as a visitor reads it", () => {
  it("answers published entries only: a draft-only entry never appears", async () => {
    const response = await ask({
      visitor: { collection: "pages", id: "p1" },
      query: QUERY,
    });
    const body = JSON.stringify(await response.json());
    expect(body).toContain("Field notes");
    expect(body).not.toContain("Members' launch");
  });

  it("never carries a field only a signed-in reader may see", async () => {
    const response = await ask({
      visitor: { collection: "pages", id: "p1" },
      query: QUERY,
    });
    expect(JSON.stringify(await response.json())).not.toContain(
      "only for members"
    );
    // Read as the public: published, judged by the anonymous caller's rules.
    const listReads = nextly.find.mock.calls
      .map(([args]) => args as Record<string, unknown>)
      .filter(args => args.collection === "posts");
    expect(listReads).toHaveLength(1);
    expect(listReads[0]).toMatchObject({
      status: "published",
      overrideAccess: false,
      user: undefined,
    });
  });

  it("reads as the caller, drafts included, when no visitor is named, as before", async () => {
    const response = await ask({ query: QUERY });
    const body = JSON.stringify(await response.json());
    expect(body).toContain("Members' launch");
  });

  it("checks the document opens before reading anything as a visitor, with one answer for every refusal", async () => {
    const noBlocksField = await refusalOf(
      ask({ visitor: { collection: "authors", id: "a1" }, query: QUERY })
    );
    const missingCollection = await refusalOf(
      ask({ visitor: { collection: "nowhere", id: "p1" }, query: QUERY })
    );
    const unopened = await refusalOf(
      ask({ visitor: { collection: "pages", id: "gone" }, query: QUERY })
    );
    expect(JSON.parse(noBlocksField)).toMatchObject({ statusCode: 403 });
    expect(missingCollection).toBe(noBlocksField);
    expect(unopened).toBe(noBlocksField);
    // Nothing read from the list before any of those refusals.
    expect(
      nextly.find.mock.calls.some(
        ([args]) => (args as Record<string, unknown>).collection === "posts"
      )
    ).toBe(false);
  });
});
