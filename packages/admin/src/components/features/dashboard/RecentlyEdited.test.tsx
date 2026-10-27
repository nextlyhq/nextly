/**
 * The dashboard's Recently edited card, drawn from its `system:recent-edits`
 * answer: a link per document, the meta line its tier allows, its one footer,
 * its empty text, and the frame's own states.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

import { RecentlyEdited } from "./RecentlyEdited";

/** The collections the workspace payload publishes to the reader, as the test sets them. */
let mockBranding: { widgetSources?: unknown[] } = {};
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => mockBranding,
}));
afterEach(() => {
  mockBranding = {};
});

/** One row as `system:recent-edits` answers it. */
function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `save-${n}`,
    entryId: `doc-${n}`,
    entryTitle: `Doc ${n}`,
    collection: "posts",
    subjectKind: "collection",
    locale: null,
    actorType: "user",
    userId: "user-1",
    userName: "Ana",
    identityErasedAt: null,
    createdAt: "2026-10-22T12:00:00.000Z",
    status: "draft",
    pendingChanges: false,
    ...overrides,
  };
}

const QUERY = { source: "system:recent-edits", op: "list" as const, limit: 5 };

function draw(props: Partial<WidgetComponentProps>, tier: SizeTier = "medium") {
  const full: WidgetComponentProps = {
    widgetId: "core/recently-edited",
    placementId: "card-1",
    settings: {},
    slot: undefined,
    isFetching: false,
    query: QUERY,
    ...props,
  };
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(<RecentlyEdited {...full} />)}
    </CardTierContext.Provider>
  );
}

const answered = (
  items: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Partial<WidgetComponentProps> => ({
  slot: { ok: true, result: { op: "list", items, ...extra } },
});

describe("the Recently edited card", () => {
  it("links each title to its document", () => {
    draw(
      answered([row(1), row(2, { subjectKind: "single", collection: "home" })])
    );
    // Each row is one link, so its title is inside the link it names.
    expect(screen.getByText("Doc 1").closest("a")).toHaveAttribute(
      "href",
      "/admin/collections/posts/doc-1"
    );
    expect(screen.getByText("Doc 2").closest("a")).toHaveAttribute(
      "href",
      "/admin/singles/home"
    );
  });

  it("shows the collection, who saved it and when on the meta line, and its status at the end, at medium", () => {
    const items = [row(1, { pendingChanges: true, status: "published" })];
    draw(answered(items), "medium");
    const meta = screen.getByTestId("entity-row-meta");
    expect(meta).toHaveTextContent(/^posts · Ana · /);
    expect(screen.getByTestId("entity-row-trailing")).toHaveTextContent(
      "Changes not published"
    );
    // When, as a relative time over the exact instant.
    expect(within(meta).getByText(/ago|just now|Oct/)).toHaveAttribute(
      "datetime",
      "2026-10-22T12:00:00.000Z"
    );
  });

  it("leads each row with its collection's initial, and draws its status as a pill in its tone", () => {
    draw(
      answered([
        row(1, { status: "published" }),
        row(2, { pendingChanges: true, status: "published" }),
        row(3),
        row(4, { subjectKind: "single", collection: "home" }),
      ])
    );
    const leading = screen
      .getAllByTestId("entity-row")
      .map(each => within(each).getByTestId("entity-row-leading").textContent);
    // A Single belongs to no collection, so it is led by "S".
    expect(leading).toEqual(["P", "P", "P", "S"]);
    // 🔴 Done reads as done and a held change as waiting: one tone for all says neither.
    const pills = screen
      .getAllByTestId("status-pill")
      .map(pill => [pill.textContent, pill.dataset.tone]);
    expect(pills).toEqual([
      ["Published", "good"],
      ["Changes not published", "warn"],
      ["Draft", "neutral"],
      ["Draft", "neutral"],
    ]);
  });

  it("names the collection as the reader is shown it, and by its slug where it is shown none", () => {
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
    draw(answered([row(1), row(2, { collection: "pages" })]));
    const [labelled, unlabelled] = screen.getAllByTestId("entity-row");
    // 🔴 A row naming the slug says "posts" where every other surface says "Blog posts".
    expect(within(labelled!).getByTestId("entity-row-meta")).toHaveTextContent(
      /^Blog posts · /
    );
    expect(
      within(labelled!).getByTestId("entity-row-leading")
    ).toHaveTextContent("B");
    expect(
      within(unlabelled!).getByTestId("entity-row-meta")
    ).toHaveTextContent(/^pages · /);
  });

  it("keeps who saved it and its status when small", () => {
    // Below large a row's slots stack the same way at every width, so a small card's row
    // says what a medium one says.
    const items = [row(1, { pendingChanges: true, status: "published" })];
    draw(answered(items), "small");
    const small = screen.getByTestId("entity-row");
    expect(small).toHaveTextContent("Doc 1");
    expect(small).toHaveTextContent("Ana");
    expect(small).toHaveTextContent("Changes not published");
  });

  it("lists an untitled document as 'Untitled', never by its id", () => {
    draw(answered([row(1, { entryTitle: null })]));
    expect(screen.getByText("Untitled").closest("a")).toHaveAttribute(
      "href",
      "/admin/collections/posts/doc-1"
    );
    expect(screen.queryByText(/doc-1/)).toBeNull();
  });

  it("draws its number of items, and no footer, since its source has no list to open", () => {
    // Asked for 5: the batch asked 6, and the sixth is not drawn. Its source reads across
    // collections and has no list view to open, and a footer holds a link, never a bare count.
    const { unmount } = draw(answered([1, 2, 3, 4, 5, 6].map(n => row(n))));
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
    unmount();

    // And an answer no longer than the rows drawn draws them all, and no footer either.
    draw(answered([1, 2, 3, 4, 5].map(n => row(n))));
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.queryByTestId("list-card-footer")).not.toBeInTheDocument();
  });

  it("says how far back it looked when there are no edits", () => {
    const { unmount } = draw(answered([], { window: { days: 90 } }));
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No edits in the last 90 days"
    );
    unmount();
    draw(answered([]));
    expect(screen.getByTestId("card-empty")).toHaveTextContent("No edits yet");
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
