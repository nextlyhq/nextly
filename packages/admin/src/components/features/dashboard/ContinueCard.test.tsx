/**
 * Continue where you left off, drawn from its `system:continue` answer: a link
 * per document led by its collection's icon, its meta line on each tab, its
 * status pill, the Pin or Unpin its row menu offers, its empty text per tab,
 * and the frame's own states.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import userEvent from "@testing-library/user-event";
import type { WidgetComponentProps } from "nextly/widget-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

const { post, del, toast } = vi.hoisted(() => ({
  post: vi.fn(),
  del: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn(), post, delete: del },
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

/** The collections the workspace payload publishes to the reader, as the test sets them. */
let mockBranding: { widgetSources?: unknown[] } = {};
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => mockBranding,
}));

import { ContinueCard } from "./ContinueCard";

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ message: "Pinned." });
  del.mockResolvedValue({ message: "Unpinned." });
});
afterEach(() => {
  mockBranding = {};
});

/** One row as `system:continue` answers it: a save by Ben, unless overridden. */
function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `save-${n}`,
    entryId: `doc-${n}`,
    entryTitle: `Doc ${n}`,
    collection: "posts",
    subjectKind: "collection",
    icon: null,
    locale: null,
    actorType: "user",
    userId: "user-ben",
    userName: "Ben",
    identityErasedAt: null,
    editedAt: "2026-10-22T12:00:00.000Z",
    status: "draft",
    pendingChanges: false,
    pinned: false,
    ...overrides,
  };
}

/** A pin's row: no saver, edited when the document last was. */
function pinRow(n: number, overrides: Record<string, unknown> = {}) {
  return row(n, {
    id: `pin-${n}`,
    actorType: null,
    userId: null,
    userName: null,
    pinned: true,
    ...overrides,
  });
}

const QUERY = { source: "system:continue", op: "list" as const, limit: 5 };

function draw(
  props: Partial<WidgetComponentProps>,
  tier: SizeTier = "medium",
  tab: "mine" | "team" = "mine"
) {
  const full: WidgetComponentProps = {
    widgetId: "core/continue",
    placementId: "card-1",
    settings: { tab },
    slot: undefined,
    isFetching: false,
    query: { ...QUERY, where: { tab } },
    ...props,
  };
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(<ContinueCard {...full} />)}
    </CardTierContext.Provider>
  );
}

const answered = (
  items: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Partial<WidgetComponentProps> => ({
  slot: { ok: true, result: { op: "list", items, ...extra } },
});

describe("Continue where you left off", () => {
  it("draws Mine's rows in the answer's order, pins first, each linking to its document", () => {
    draw(
      answered([
        pinRow(1),
        pinRow(2, { subjectKind: "single", collection: "home", entryId: "" }),
        row(3, { userId: "user-ana", userName: "Ana" }),
      ])
    );
    const titles = screen
      .getAllByTestId("entity-row-title")
      .map(title => title.textContent);
    expect(titles).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.getByText("Doc 1").closest("a")).toHaveAttribute(
      "href",
      "/admin/collections/posts/doc-1"
    );
    expect(screen.getByText("Doc 2").closest("a")).toHaveAttribute(
      "href",
      "/admin/singles/home"
    );
  });

  it("says '<collection> · edited <time>' on Mine, and names who saved it on Team", () => {
    mockBranding = {
      widgetSources: [
        {
          collection: "posts",
          label: "Blog posts",
          lifecycle: true,
          fields: [],
        },
      ],
    };
    const { unmount } = draw(answered([row(1)]), "medium", "mine");
    const mine = screen.getByTestId("entity-row-meta");
    expect(mine).toHaveTextContent(/^Blog posts · edited /);
    // Mine is the reader's own: no saver on its line.
    expect(mine).not.toHaveTextContent("Ben");
    // When, as a relative time over the exact instant.
    expect(within(mine).getByText(/edited/)).toHaveAttribute(
      "datetime",
      "2026-10-22T12:00:00.000Z"
    );
    unmount();

    draw(answered([row(1)]), "medium", "team");
    expect(screen.getByTestId("entity-row-meta")).toHaveTextContent(
      /^Blog posts · edited .* · Ben$/
    );
  });

  it("leads each row with its collection's icon, and draws its status as a pill in its tone", () => {
    draw(
      answered([
        row(1, { status: "published", icon: "Bookmark" }),
        row(2, { pendingChanges: true, status: "published" }),
        row(3),
        row(4, { status: "scheduled" }),
      ])
    );
    const leading = screen
      .getAllByTestId("entity-row")
      .map(each => within(each).getByTestId("entity-row-leading"));
    for (const each of leading) {
      // An icon, never a letter standing in for one.
      expect(each.querySelector("svg")).not.toBeNull();
    }
    // The collection's own icon where it names one, and the default otherwise.
    expect(leading[0]!.innerHTML).not.toBe(leading[2]!.innerHTML);
    expect(leading[1]!.innerHTML).toBe(leading[2]!.innerHTML);
    const pills = screen
      .getAllByTestId("status-pill")
      .map(pill => [pill.textContent, pill.dataset.tone]);
    expect(pills).toEqual([
      ["Published", "good"],
      ["Changed", "warn"],
      ["Draft", "neutral"],
      ["Scheduled", "neutral"],
    ]);
  });

  it("offers Unpin on a pinned row and Pin on another, each writing that row's document", async () => {
    const user = userEvent.setup();
    draw(answered([pinRow(1), row(2)]));

    await user.click(screen.getByRole("button", { name: "Actions for Doc 1" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Unpin from dashboard" })
    );
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/dashboard/pins", {
        targetType: "collection",
        targetSlug: "posts",
        entryId: "doc-1",
      })
    );

    await user.click(screen.getByRole("button", { name: "Actions for Doc 2" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Pin to dashboard" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/dashboard/pins", {
        targetType: "collection",
        targetSlug: "posts",
        entryId: "doc-2",
      })
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Pinned to your dashboard.",
        expect.anything()
      )
    );
  });

  it("shows a refusal of a pin in the server's own words", async () => {
    post.mockRejectedValueOnce(
      new Error("You can pin at most 20 entries and Singles.")
    );
    const user = userEvent.setup();
    draw(answered([row(1)]));
    await user.click(screen.getByRole("button", { name: "Actions for Doc 1" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Pin to dashboard" })
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can pin at most 20 entries and Singles."
      )
    );
  });

  it("never draws a row without a title, nor names it by its id", () => {
    draw(answered([row(1, { entryTitle: null }), row(2)]));
    expect(screen.getAllByTestId("entity-row")).toHaveLength(1);
    expect(screen.queryByText(/doc-1/)).toBeNull();
    expect(screen.queryByText("Untitled")).toBeNull();
  });

  it("draws at most its number of items, and no footer, since it has no list to open", () => {
    // Asked for 5: the batch asked 6, and the sixth is not drawn.
    draw(answered([1, 2, 3, 4, 5, 6].map(n => row(n))));
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("says what fills each tab when it is empty, and how far back Team looked", () => {
    const { unmount } = draw(answered([]), "medium", "mine");
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "Nothing to continue yet"
    );
    unmount();
    draw(answered([], { window: { days: 90 } }), "medium", "team");
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No edits by others in the last 90 days"
    );
  });

  it("says it is not available, or that it failed, in the frame's own words", () => {
    const { unmount } = draw({
      slot: { ok: false, error: "Not available", code: "unavailable" },
    });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    unmount();
    draw({ slot: { ok: false, error: "The database did not answer." } });
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "The database did not answer."
    );
  });
});
