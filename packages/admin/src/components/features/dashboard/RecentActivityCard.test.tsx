/**
 * The dashboard's Recent activity card, drawn from its `system:activity`
 * answer: the frame's own states, and the rows its tier and its "Number of
 * items" allow, with "More exist" from the one row more the batch asked for.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { CardTierContext } from "@admin/components/features/widgets/frame/tier";

import { RecentActivityCard } from "./RecentActivity";

/** One feed row as `system:activity` answers it. */
function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `a${n}`,
    actorType: "user",
    userId: "u1",
    userName: "Ana",
    userEmail: "ana@example.test",
    action: "update",
    collection: "posts",
    entryId: `p${n}`,
    entryTitle: `Doc ${n}`,
    subjectKind: "collection",
    createdAt: "2026-10-22T12:00:00.000Z",
    count: 1,
    countAtLeast: false,
    identityErasedAt: null,
    ...overrides,
  };
}

const LIST_QUERY = { source: "system:activity", op: "list" as const };

function draw(props: Partial<WidgetComponentProps>, tier: SizeTier = "medium") {
  const full: WidgetComponentProps = {
    widgetId: "core/recent-activity",
    placementId: "card-1",
    settings: {},
    slot: undefined,
    isFetching: false,
    ...props,
  };
  return render(
    <CardTierContext.Provider value={tier}>
      <RecentActivityCard {...full} />
    </CardTierContext.Provider>
  );
}

const titles = () => screen.queryAllByText(/^Doc \d+$/).map(n => n.textContent);

describe("the Recent activity card", () => {
  it("holds its rows' place while its first answer is on the way, and draws nothing for no request", () => {
    const { unmount } = draw({
      isFetching: true,
      query: { ...LIST_QUERY, limit: 4 },
    });
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
    unmount();

    const { container } = draw({ isFetching: false });
    expect(container).toBeEmptyDOMElement();
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

  it("uses the standard empty state when there is nothing to show", () => {
    draw({
      slot: { ok: true, result: { op: "list", items: [] } },
      query: LIST_QUERY,
    });
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No activity yet"
    );
  });

  it("draws the rows its reader asked for, and says more exist from the extra row", () => {
    // Asked for 3: the batch asked 4, and the fourth says more exist.
    const { unmount } = draw({
      slot: {
        ok: true,
        result: { op: "list", items: [1, 2, 3, 4].map(n => row(n)) },
      },
      query: { ...LIST_QUERY, limit: 3 },
    });
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.getByText("More exist")).toBeInTheDocument();
    unmount();

    // The must-differ half: an answer no longer than the rows drawn says nothing more.
    draw({
      slot: {
        ok: true,
        result: { op: "list", items: [1, 2, 3].map(n => row(n)) },
      },
      query: { ...LIST_QUERY, limit: 3 },
    });
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
    expect(screen.queryByText("More exist")).not.toBeInTheDocument();
  });

  it("draws no more rows than a small card has room for", () => {
    draw(
      {
        slot: {
          ok: true,
          result: { op: "list", items: [1, 2, 3, 4, 5].map(n => row(n)) },
        },
        query: { ...LIST_QUERY, limit: 10 },
      },
      "small"
    );
    expect(titles()).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
  });

  it("draws a run of saves with its count, and leaves out a row it cannot read", () => {
    draw({
      slot: {
        ok: true,
        result: {
          op: "list",
          items: [
            row(1, { count: 12 }),
            // No id: not a row this build can draw, so it is not drawn from guesses.
            row(2, { id: undefined }),
          ],
        },
      },
      query: LIST_QUERY,
    });
    expect(titles()).toEqual(["Doc 1"]);
    // The count's own words: a bare /12/ also matches a relative time such as "12h ago".
    expect(screen.getByText(/12 times/)).toBeInTheDocument();
  });
});
