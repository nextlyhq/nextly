/**
 * The dashboard's Recently edited card, drawn from its `system:recent-edits`
 * answer: a link per document, the detail line its tier allows, its empty text,
 * and the frame's own states.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

import { RecentlyEdited } from "./RecentlyEdited";

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
      <RecentlyEdited {...full} />
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
    expect(screen.getByRole("link", { name: "Doc 1" })).toHaveAttribute(
      "href",
      "/admin/collections/posts/doc-1"
    );
    expect(screen.getByRole("link", { name: "Doc 2" })).toHaveAttribute(
      "href",
      "/admin/singles/home"
    );
  });

  it("shows the collection, who saved it, when and its status at medium, and the title alone when small", () => {
    const items = [row(1, { pendingChanges: true, status: "published" })];
    const { unmount } = draw(answered(items), "medium");
    const line = screen.getByTestId("recent-edit");
    expect(line).toHaveTextContent("posts");
    expect(line).toHaveTextContent("Ana");
    expect(line).toHaveTextContent("Changes not published");
    // When, as a relative time over the exact instant.
    expect(within(line).getByText(/ago|just now|Oct/)).toHaveAttribute(
      "datetime",
      "2026-10-22T12:00:00.000Z"
    );
    unmount();

    draw(answered(items), "small");
    const small = screen.getByTestId("recent-edit");
    expect(small).toHaveTextContent("Doc 1");
    expect(small).not.toHaveTextContent("Ana");
    expect(small).not.toHaveTextContent("Changes not published");
  });

  it("lists an untitled document as 'Untitled', never by its id", () => {
    draw(answered([row(1, { entryTitle: null })]));
    expect(screen.getByRole("link", { name: "Untitled" })).toBeInTheDocument();
    expect(screen.queryByText(/doc-1/)).toBeNull();
  });

  it("draws its number of items, and says more exist when the answer holds one more", () => {
    // Asked for 5: the batch asked 6, and the sixth says more exist.
    const { unmount } = draw(answered([1, 2, 3, 4, 5, 6].map(n => row(n))));
    expect(screen.getAllByTestId("recent-edit")).toHaveLength(5);
    expect(screen.getByText("More exist")).toBeInTheDocument();
    unmount();

    // The must-differ half: an answer no longer than the rows drawn says nothing more.
    draw(answered([1, 2, 3, 4, 5].map(n => row(n))));
    expect(screen.getAllByTestId("recent-edit")).toHaveLength(5);
    expect(screen.queryByText("More exist")).not.toBeInTheDocument();
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
