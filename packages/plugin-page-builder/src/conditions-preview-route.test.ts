/**
 * What the conditions preview's read decides: which documents it reads at
 * all, that every refusal is the same answer, and that it answers only what a
 * visitor reads, never the editor's values or a draft's.
 *
 * @module conditions-preview-route.test
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, with its reads recorded. */
const nextly = vi.hoisted(() => ({
  find: vi.fn(),
  findByID: vi.fn(),
  findSingle: vi.fn(),
}));

// The handle is replaced and nothing else is, so the editor and public
// readers the route builds run as they do in production.
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
  bindingFieldShapes: async () => [{ name: "audience", type: "text" }],
}));

import { CONDITIONS_PREVIEW_ENTRY_PATH } from "./conditions-preview-contract";
import {
  conditionsPreviewEntryRoute,
  readConditionsPreview,
  type ConditionsPreviewReads,
} from "./conditions-preview-route";
import type { TemplateGuardSetup } from "./templates/template-guard";

/** A collection whose entries are built with blocks, and one whose are not. */
const RECORDS: Record<string, Record<string, unknown>> = {
  pages: {
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      { name: "title", type: "text" },
      { name: "content", type: "blocks" },
    ],
  },
  authors: {
    slug: "authors",
    labels: { singular: "Author", plural: "Authors" },
    fields: [{ name: "name", type: "text" }],
  },
};

const PUBLISHED = { id: "p1", title: "Join the journal", audience: "everyone" };

function reads(
  overrides: Partial<ConditionsPreviewReads> = {}
): ConditionsPreviewReads {
  return {
    readCollection: async slug => RECORDS[slug] ?? null,
    editorEntry: async request =>
      request.id === "p1"
        ? { ...PUBLISHED, audience: "members", _isWorkingDraft: true }
        : null,
    publicEntry: async request => (request.id === "p1" ? PUBLISHED : null),
    publicFields: async () => [{ name: "audience", type: "text" }],
    ...overrides,
  };
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

describe("what a visitor reads of a page being edited", () => {
  it("answers the page's published values and public fields, never the editor's draft", async () => {
    const answer = await readConditionsPreview(
      { collection: "pages", id: "p1" },
      reads()
    );
    expect(answer).toEqual({
      id: "p1",
      noun: "Page",
      publicValues: PUBLISHED,
      fields: [{ name: "audience", type: "text" }],
    });
    // The working draft's value is the editor's, and stays on the server.
    expect(JSON.stringify(answer)).not.toContain("members");
  });

  it("answers no values for a page a visitor reads none of", async () => {
    const answer = await readConditionsPreview(
      { collection: "pages", id: "p1" },
      reads({ publicEntry: async () => null })
    );
    expect(answer.publicValues).toBeNull();
  });

  it("gives every refusal the same answer, byte for byte", async () => {
    const missingCollection = await refusalOf(
      readConditionsPreview({ collection: "nowhere", id: "p1" }, reads())
    );
    const noBlocksField = await refusalOf(
      readConditionsPreview({ collection: "authors", id: "a1" }, reads())
    );
    const missingEntry = await refusalOf(
      readConditionsPreview({ collection: "pages", id: "gone" }, reads())
    );
    const unreadableEntry = await refusalOf(
      readConditionsPreview(
        { collection: "pages", id: "p1" },
        reads({
          editorEntry: async () => {
            throw NextlyError.forbidden({ logContext: { why: "test" } });
          },
        })
      )
    );
    expect(JSON.parse(missingCollection)).toMatchObject({ statusCode: 403 });
    expect(noBlocksField).toBe(missingCollection);
    expect(missingEntry).toBe(missingCollection);
    expect(unreadableEntry).toBe(missingCollection);
  });

  it("reads nothing as a visitor before the caller is shown to open the page", async () => {
    const publicEntry = vi.fn(async () => PUBLISHED);
    await refusalOf(
      readConditionsPreview(
        { collection: "pages", id: "gone" },
        reads({ publicEntry })
      )
    );
    expect(publicEntry).not.toHaveBeenCalled();
  });
});

describe("the route as bound", () => {
  beforeEach(() => {
    nextly.find.mockReset();
    nextly.findByID.mockReset();
    nextly.findSingle.mockReset();
  });

  it("answers an editor who can read a draft page with no values: the draft's never reach the switch", async () => {
    const draft = {
      id: "p2",
      title: "Members' launch",
      audience: "members",
      status: "draft",
    };
    // The editor reads the draft by id; a visitor's read, published only,
    // finds no row, as core answers it for a page never published.
    nextly.findByID.mockResolvedValue(draft);
    nextly.find.mockImplementation(async (args: Record<string, unknown>) =>
      args.status === "published"
        ? { items: [], meta: { total: 0 } }
        : { items: [draft], meta: { total: 1 } }
    );
    const ctx = {
      self: { collections: {} },
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
    const response = await conditionsPreviewEntryRoute({ guard }).handler(
      new Request(
        `http://nextly.test/plugins/x${CONDITIONS_PREVIEW_ENTRY_PATH}`,
        {
          method: "POST",
          body: JSON.stringify({ collection: "pages", id: "p2" }),
        }
      ),
      ctx
    );
    const body = JSON.stringify(await response.json());
    expect(body).toContain('"publicValues":null');
    expect(body).not.toContain("members");
    // The visitor's read asked for published rows, judged as the public.
    const visitorReads = nextly.find.mock.calls.filter(
      ([args]) => (args as Record<string, unknown>).status === "published"
    );
    expect(visitorReads.length).toBeGreaterThan(0);
    for (const [args] of visitorReads) {
      expect(args).toMatchObject({ overrideAccess: false, user: undefined });
    }
  });
});
