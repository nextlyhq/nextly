/**
 * `createPublicContentRoute`'s draft hook, asked only on a draft-mode request.
 *
 * A public route is static and cached. Its draft hook reads the request's
 * preview cookie, which would make every render dynamic, so the route asks it
 * only when Next's draft mode is on: Next renders those requests on demand and
 * never stores them. Every other request reads the draft-mode flag alone and
 * stays static. These pin both halves against a stubbed reader (no DB), with
 * `next/headers` standing in for the request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FindArgs,
  FindByIDArgs,
} from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute, createPublicContentRoute } from "../content-route";
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

/** What `draftMode()` answers for the request in hand, set per test. */
const request = vi.hoisted(() => ({
  draftMode: false as boolean | "outside a request",
}));

vi.mock("next/headers", () => ({
  draftMode: async () => {
    if (request.draftMode === "outside a request") {
      // What Next throws when no request is in scope, as in a build's scan.
      throw new Error("`draftMode` was called outside a request scope.");
    }
    return { isEnabled: request.draftMode };
  },
}));

afterEach(() => {
  request.draftMode = false;
});

function stubReader(): {
  reader: NextlyContentReader;
  calls: FindArgs[];
  byIdCalls: FindByIDArgs[];
} {
  const calls: FindArgs[] = [];
  const byIdCalls: FindByIDArgs[] = [];
  const row = { id: "1", slug: "a", status: "published", title: "Live" };
  const reader: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      calls.push(args);
      return {
        items: [row],
        meta: {
          total: 1,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async (args): Promise<Record<string, unknown> | null> => {
      byIdCalls.push(args);
      return { ...row, title: "Draft", _isWorkingDraft: true };
    },
  };
  return { reader, calls, byIdCalls };
}

const params = { params: { slug: ["a"] } };

/** A draft hook that grants entry `1`, recording each time it is asked. */
function grantingHook() {
  return vi.fn(async () => ({ entryId: "1" }));
}

describe("createPublicContentRoute with a draft hook", () => {
  it("accepts a draft hook, which a public route used to refuse", () => {
    const { reader } = stubReader();

    expect(() =>
      createPublicContentRoute({
        collections: ["pages"],
        nextly: reader,
        render: (entry: ContentEntry) => entry,
        draft: grantingHook(),
      })
    ).not.toThrow();
  });

  it("does not ask the hook on an ordinary visit, and serves the published page", async () => {
    const { reader, byIdCalls } = stubReader();
    const draft = grantingHook();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      draft,
    });

    request.draftMode = false;
    const page = (await route.ContentPage(params)) as unknown as ContentEntry;

    // Not asked at all, so nothing in it (the preview cookie) is read and the
    // render stays static.
    expect(draft).not.toHaveBeenCalled();
    expect(byIdCalls).toHaveLength(0);
    expect(page.title).toBe("Live");
  });

  it("asks the hook on a draft-mode request, and serves the granted draft", async () => {
    const { reader, byIdCalls } = stubReader();
    const draft = grantingHook();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      draft,
    });

    request.draftMode = true;
    const page = (await route.ContentPage(params)) as unknown as ContentEntry;

    expect(draft).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "pages", slug: "a" })
    );
    // The grant names the entry, so it is read by that id, as a draft.
    expect(byIdCalls[0]).toEqual(expect.objectContaining({ id: "1" }));
    expect(page.title).toBe("Draft");
  });

  it("serves the published page when draft mode is on but the hook grants nothing", async () => {
    const { reader, byIdCalls } = stubReader();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      // What `previewDraftGate` answers without a valid token for the entry.
      draft: async () => false,
    });

    request.draftMode = true;
    const page = (await route.ContentPage(params)) as unknown as ContentEntry;

    expect(byIdCalls).toHaveLength(0);
    expect(page.title).toBe("Live");
  });

  it("serves the published page outside a request, without asking the hook", async () => {
    const { reader } = stubReader();
    const draft = grantingHook();
    const route = createPublicContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      draft,
    });

    request.draftMode = "outside a request";
    const page = (await route.ContentPage(params)) as unknown as ContentEntry;

    expect(draft).not.toHaveBeenCalled();
    expect(page.title).toBe("Live");
  });

  it("still refuses `draft: true`, which would serve drafts to every visitor", () => {
    const { reader } = stubReader();

    expect(() =>
      createPublicContentRoute({
        collections: ["pages"],
        nextly: reader,
        render: (entry: ContentEntry) => entry,
        draft: true,
      })
    ).toThrow(/cannot serve drafts/i);
  });
});

describe("createContentRoute's draft hook is unchanged", () => {
  it("is asked whether or not draft mode is on", async () => {
    const { reader } = stubReader();
    const draft = grantingHook();
    const route = createContentRoute({
      collections: ["pages"],
      nextly: reader,
      render: (entry: ContentEntry) => entry,
      draft,
    });

    request.draftMode = false;
    await route.ContentPage(params);

    // The enforced route is already per request, so it keeps asking its hook
    // on every visit, as before.
    expect(draft).toHaveBeenCalled();
  });
});
