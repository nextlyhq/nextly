// @vitest-environment jsdom
/**
 * The editor's search as the plugin mounts it: the site's other pages, read
 * on the server once typing pauses, each opening that page in the editor; and
 * the top bar's button.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PagesSearchResponse } from "../../pages-search-contract";

const reads: Array<{ path: string; signal?: AbortSignal }> = [];
let answer: () => Promise<PagesSearchResponse> = async () => ({
  items: [],
  meta: { total: 0 } as PagesSearchResponse["meta"],
});
const navigateTo = vi.fn();
const revealNode = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: (read: { path: string; signal?: AbortSignal }) => {
    reads.push(read);
    return answer();
  },
  navigateTo: (href: string) => navigateTo(href),
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "about",
  }),
}));

vi.mock("@nextlyhq/builder", () => ({
  revealNode: (root: unknown, id: string) => revealNode(root, id),
  // The platform's own spelling, as the builder would answer.
  keyHint: (spec: string, apple: boolean) =>
    spec === "mod+k" ? (apple ? "⌘K" : "Ctrl+K") : null,
}));

/** What the palette was last handed, observed rather than rebuilt. */
let palette: Record<string, unknown> = {};
vi.mock("@nextlyhq/builder/shell", () => ({
  COMMAND_PALETTE_KEYS: "mod+k",
  EditorCommandPalette: (props: Record<string, unknown>) => {
    palette = props;
    return null;
  },
}));

const { EditorSearch, SearchButton } = await import("./editor-search");

interface Results {
  group: { name: string; status?: string };
  commands: Array<{ label: string; detail?: string; run: () => void }>;
}

function results(): Results {
  return palette.results as Results;
}

function search(query: string): void {
  act(() => {
    (palette.onSearchChange as (query: string) => void)(query);
  });
}

/** Lets the debounce lapse and the answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reads.length = 0;
  navigateTo.mockClear();
  revealNode.mockClear();
  answer = async () => ({
    items: [
      {
        id: "hq",
        collection: "pages",
        collectionLabel: "Pages",
        field: "layout",
        title: "Head office",
        status: "draft",
      },
    ],
    meta: { total: 1 } as PagesSearchResponse["meta"],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(canvas: HTMLElement | null = null): void {
  render(
    <EditorSearch
      editor={{} as never}
      canvas={canvas}
      open
      onOpenChange={() => undefined}
    />
  );
}

describe("the editor's page search", () => {
  it("asks the server once typing pauses, leaving out the page being edited", async () => {
    mount();
    search("he");
    search("head");
    // Still typing: nothing asked yet, and the group says it is searching.
    expect(reads).toHaveLength(0);
    expect(results().group.status).toBe("Searching pages…");
    // Nor a moment later: the server is asked once the pause is long enough.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(reads).toHaveLength(0);

    await settle();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.path).toContain("q=head");
    expect(decodeURIComponent(reads[0]?.path ?? "")).toContain(
      "exclude=pages:about"
    );
    expect(results().group.status).toBeUndefined();
    expect(results().commands.map(row => row.label)).toEqual(["Head office"]);
    expect(results().commands[0]?.detail).toBe("Draft");
  });

  it("names the collection when two found pages share a title", async () => {
    const twin = (collection: string, collectionLabel: string) => ({
      id: `${collection}-home`,
      collection,
      collectionLabel,
      field: "layout",
      title: "Home",
    });
    answer = async () => ({
      items: [twin("pages", "Pages"), twin("landing", "Landing pages")],
      meta: { total: 2 } as PagesSearchResponse["meta"],
    });
    mount();
    search("home");
    await settle();
    expect(results().commands.map(row => row.detail)).toEqual([
      "Pages",
      "Landing pages",
    ]);
  });

  it("opens a found page in the editor", async () => {
    mount();
    search("head");
    await settle();
    results().commands[0]?.run();
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/pages/hq/builder?field=layout"
    );
  });

  it("never lets an older answer land under a newer search", async () => {
    let release: (value: PagesSearchResponse) => void = () => undefined;
    answer = () =>
      new Promise(resolve => {
        release = resolve;
      });
    mount();
    search("head");
    await settle();
    const first = reads[0];
    const stale = release;
    search("team");
    // The first read was abandoned, and its late answer changes nothing.
    expect(first?.signal?.aborted).toBe(true);
    await act(async () => {
      stale({
        items: [
          {
            id: "hq",
            collection: "pages",
            collectionLabel: "Pages",
            field: "layout",
            title: "Head office",
          },
        ],
        meta: { total: 1 } as PagesSearchResponse["meta"],
      });
    });
    expect(results().commands).toHaveLength(0);
    expect(results().group.status).toBe("Searching pages…");
  });

  it("says a failed search plainly, and shows nothing for an empty one", async () => {
    answer = () => Promise.reject(new Error("offline"));
    mount();
    search("head");
    await settle();
    expect(results().group.status).toBe("Couldn't search pages. Try again.");

    search("");
    expect(results().group.status).toBeUndefined();
    expect(results().commands).toHaveLength(0);
  });

  it("brings a found block into view on the canvas", () => {
    const canvas = document.createElement("div");
    mount(canvas);
    (palette.revealBlock as (id: string) => void)("welcome");
    expect(revealNode).toHaveBeenCalledWith(canvas, "welcome");
  });
});

describe("the top bar's search button", () => {
  it("names no key in the server's render, before it knows the platform", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(<SearchButton onOpen={() => undefined} />);
    // The browser's first render must match this, whatever keyboard it has.
    expect(html).not.toContain("Ctrl+K");
    expect(html).not.toContain("⌘K");
  });

  it("opens the search, and names its shortcut as this platform spells it", () => {
    const onOpen = vi.fn();
    render(<SearchButton onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: "Search and commands" });
    expect(button.getAttribute("aria-keyshortcuts")).toContain("Meta+K");
    // Off a Mac there is no ⌘ key to press. jsdom reports no Apple platform.
    expect(button.textContent).toBe("Ctrl+K");
    expect(button.getAttribute("title")).toBe("Search and commands (Ctrl+K)");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
