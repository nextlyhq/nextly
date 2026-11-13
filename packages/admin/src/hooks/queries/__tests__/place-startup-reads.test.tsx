/**
 * A page starting the reads its places' contributions declare, as it first
 * renders: under the key and with the read `usePluginRoute` uses, so the
 * component's first mount takes the started read and sends nothing of its
 * own, and every later mount reads afresh as before.
 *
 * The separating properties: the started read must be the one the hook takes
 * (a key spelled apart would make two requests, which the count below sees),
 * and only the FIRST mount may take it (a mark never consumed would leave the
 * section stale on every later visit).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { DeliveredAdminEntry } from "nextly/config";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSpy, branding } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  branding: {
    current: {} as { contributions?: Record<string, unknown> },
  },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: getSpy },
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding.current,
}));

import {
  STARTED_READ_HANDOFF_MS,
  usePlaceStartupReads,
  usePluginRoute,
} from "../usePluginRoute";

const PLUGIN = "@acme/designs";
const TEMPLATE = "/designs?collection={collection}&entry={entryId}";
const FILLED = "/designs?collection=posts&entry=a%2Fb";
const ROUTE = `/plugins/${PLUGIN}${FILLED}`;

/** A Design section delivered at `collection.edit`, as admin-meta sends it. */
function deliver(item: Partial<Record<string, unknown>> = {}): void {
  const section = {
    id: "acme-designs.design",
    kind: "sidebarSection",
    plugin: PLUGIN,
    label: "Design",
    component: "@acme/designs/admin#Design",
    startupReads: [{ path: TEMPLATE }],
    ...item,
  } as unknown as DeliveredAdminEntry;
  branding.current = {
    contributions: {
      "collection.edit": {
        sidebarSection: [{ builtIn: "status" }, section],
      },
    },
  };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const IDS = { collection: "posts", entryId: "a/b" };

/** The section's own read, as its component asks it. */
const sectionRead = () =>
  usePluginRoute<{ items: unknown[] }>({
    plugin: PLUGIN,
    path: FILLED,
    staleTime: 0,
  });

let client: QueryClient;

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockResolvedValue({ items: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  deliver();
});

describe("a page starting its parts' reads", () => {
  it("asks the filled path at once, before any part has mounted", async () => {
    const { result } = renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      { wrapper: wrapper(client) }
    );
    expect(getSpy).toHaveBeenCalledWith(ROUTE);
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("hands the part's first mount the started read, and reads again on the next", async () => {
    const page = renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(page.result.current.pending).toBe(false));
    expect(getSpy).toHaveBeenCalledTimes(1);

    const first = renderHook(sectionRead, { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.pending).toBe(false));
    // The started read was the section's: no request of its own.
    expect(getSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    // A later mount reads afresh, as a fresh-on-mount read always has.
    const second = renderHook(sectionRead, { wrapper: wrapper(client) });
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it("starts nothing the page has no id for, as a new entry has none", () => {
    renderHook(
      () =>
        usePlaceStartupReads([
          {
            place: "collection.edit",
            ids: { collection: "posts", entryId: null },
          },
        ]),
      { wrapper: wrapper(client) }
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("starts nothing for a part offered on other collections", () => {
    deliver({ collections: ["pages"] });
    renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      {
        wrapper: wrapper(client),
      }
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("starts a part with a rule, which only its entry can settle", () => {
    deliver({ visibleWhen: { field: "status", equals: "draft" } });
    renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      {
        wrapper: wrapper(client),
      }
    );
    expect(getSpy).toHaveBeenCalledWith(ROUTE);
  });

  it("starts once, however often the page draws again", async () => {
    const page = renderHook(
      () =>
        usePlaceStartupReads([{ place: "collection.edit", ids: { ...IDS } }]),
      { wrapper: wrapper(client) }
    );
    await act(async () => {
      page.rerender();
      page.rerender();
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("forgets a start no part took once the page goes, so a later mount reads afresh", async () => {
    const page = renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(page.result.current.pending).toBe(false));
    page.unmount();

    const later = renderHook(sectionRead, { wrapper: wrapper(client) });
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    later.unmount();
  });
});

describe("a started read on a revisit, and a part that mounts late", () => {
  afterEach(() => vi.restoreAllMocks());

  it("waits for the started read again where an earlier answer is kept", async () => {
    // A first visit leaves the section's answer in the cache.
    const first = renderHook(sectionRead, { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.pending).toBe(false));
    first.unmount();
    // The revisit's started read is still on its way: the page waits for
    // it, rather than drawing the kept answer it may change.
    let answer: (body: unknown) => void = () => {};
    getSpy.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answer = resolve;
        })
    );
    const page = renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      { wrapper: wrapper(client) }
    );
    expect(page.result.current.pending).toBe(true);
    await act(async () => {
      answer({ items: [] });
    });
    await waitFor(() => expect(page.result.current.pending).toBe(false));
  });

  it("reads afresh for a part that first mounts after the page has opened", async () => {
    const page = renderHook(
      () => usePlaceStartupReads([{ place: "collection.edit", ids: IDS }]),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(page.result.current.pending).toBe(false));
    expect(getSpy).toHaveBeenCalledTimes(1);
    // The section mounts long after the page opened (its panel opened
    // later): the answer started for the page's first draw is not handed on.
    const opened = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(opened + STARTED_READ_HANDOFF_MS + 1);
    const late = renderHook(sectionRead, { wrapper: wrapper(client) });
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    late.unmount();
  });
});

describe("the form inside the editor", () => {
  it("starts the reads its parts declare, with the form's own ids", () => {
    branding.current = {
      contributions: {
        "entry.form": {
          block: [
            {
              id: "acme-notes.notes",
              kind: "block",
              plugin: "@acme/notes",
              component: "@acme/notes/admin#Notes",
              startupReads: [{ path: "/notes?{kind}={slug}&entry={entryId}" }],
            },
          ],
        },
      },
    };
    renderHook(
      () =>
        usePlaceStartupReads([
          { place: "collection.edit", ids: IDS },
          {
            place: "entry.form",
            ids: { kind: "collection", slug: "posts", entryId: "a/b" },
          },
        ]),
      { wrapper: wrapper(client) }
    );
    expect(getSpy).toHaveBeenCalledWith(
      "/plugins/@acme/notes/notes?collection=posts&entry=a%2Fb"
    );
  });
});
