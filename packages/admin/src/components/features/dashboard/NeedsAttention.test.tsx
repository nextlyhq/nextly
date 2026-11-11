/**
 * The Needs your attention card's rows: each item's severity by shape, its
 * label and count, its reason and one Review; a failed item's "Not all
 * checked" with a Retry that asks the card again; no control that dismisses
 * an item; and the fold that shows the items its stored height does not hold
 * on asking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { cardBodyHeightPx } from "@admin/components/features/widgets/frame/measures";
import { CardHeightContext } from "@admin/components/features/widgets/frame/tier";
import { HiddenWhileEmptyContext } from "@admin/components/features/widgets/hidden-while-empty";
import { fireEvent, render, screen, within } from "@admin/__tests__/utils";

import type { ReleaseListResponse } from "@admin/services/releaseApi";

import { NeedsAttention } from "./NeedsAttention";

// The releases a release row names, read from the Releases list's own Needs
// attention tab; answered with none unless a test says otherwise.
const releaseReads = vi.hoisted(() => ({ fetchReleases: vi.fn() }));
vi.mock("@admin/services/releaseApi", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/services/releaseApi")
  >("@admin/services/releaseApi");
  return { ...actual, fetchReleases: releaseReads.fetchReleases };
});

function releasesAnswer(
  items: readonly { id: string; title: string; state: string }[]
): ReleaseListResponse {
  return {
    items,
    meta: { total: items.length, page: 1, limit: 3 },
  } as unknown as ReleaseListResponse;
}

beforeEach(() => {
  releaseReads.fetchReleases.mockReset();
  releaseReads.fetchReleases.mockResolvedValue(releasesAnswer([]));
});

const STOPPED = {
  id: "core/stopped-releases",
  kind: "stopped",
  label: "Releases that stopped",
  count: 1,
  severity: "critical",
  link: "releases?tab=attention&reason=stopped",
  reason: "A scheduled publish failed.",
};
const OVERDUE = {
  id: "core/overdue-releases",
  kind: "overdue",
  label: "Overdue releases",
  count: 2,
  severity: "critical",
  link: "releases?tab=attention&reason=overdue",
  reason: "Still scheduled after its time.",
};
const SEO = {
  id: "seo/missing-descriptions",
  kind: "plugin",
  label: "Pages with no description",
  count: 120,
  atLeast: true,
  severity: "warning",
  link: "collections/pages",
};

function draw(
  items: readonly object[],
  props: { refreshing?: boolean; retry?: () => void; revealed?: boolean } = {}
) {
  const card = inFrame(
    <NeedsAttention
      widgetId="core/needs-attention"
      placementId="attention"
      settings={{}}
      size={{ w: 8, h: 3, tier: "medium" }}
      data={{ items }}
      refreshing={props.refreshing ?? false}
      retry={props.retry ?? (() => undefined)}
    />,
    "Needs your attention"
  );
  // As the dashboard holds it: a card it drew without at first, then showed.
  return render(
    props.revealed === true ? (
      <HiddenWhileEmptyContext.Provider
        value={{
          hidden: new Set(),
          revealed: new Set(["attention"]),
          hiddenWhenAnswerEmpty: new Set(),
        }}
      >
        {card}
      </HiddenWhileEmptyContext.Provider>
    ) : (
      card
    )
  );
}

/**
 * Lays the card out as the frame draws it at `h` grid rows: a body of `cardBodyHeightPx(h)`, rows
 * `rowPx` high from its top (the list's own height unless a case wraps them taller), and the
 * fold's control wherever it is drawn. `drawnBodyPx` draws the body shorter than its rows give
 * it, as a card as tall as its content stands while it loads.
 */
function layOut(
  h: number,
  rowPx = LIST_ROW_HEIGHT_PX.default,
  drawnBodyPx = cardBodyHeightPx(h)
): void {
  const rect = (top: number, bottom: number) =>
    ({
      top,
      bottom,
      left: 0,
      right: 600,
      width: 600,
      height: bottom - top,
    }) as DOMRect;
  const row = rowPx;
  const body = drawnBodyPx;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-testid") === "widget-card-body")
        return rect(0, body);
      // What the card's body draws: its rows, one under another from the body's top.
      if (this.getAttribute("data-testid") === "needs-attention")
        return rect(0, row * this.querySelectorAll("[data-fold-row]").length);
      if (this.hasAttribute("data-fold-row")) {
        const index = [
          ...(this.parentElement?.querySelectorAll("[data-fold-row]") ?? []),
        ].indexOf(this);
        return rect(row * index, row * (index + 1));
      }
      if (this.hasAttribute("aria-controls")) return rect(body + 12, body + 40);
      return rect(0, 0);
    }
  );
}

const plugin = (n: number) => ({
  ...SEO,
  id: `seo/item-${n}`,
  label: `Item ${n}`,
  count: n,
});

afterEach(() => vi.restoreAllMocks());

describe("NeedsAttention's release rows", () => {
  it("names each stopped release under its row, linked to its page, from the stopped part of Needs attention", async () => {
    releaseReads.fetchReleases.mockImplementation(
      (params: { reason?: string }) =>
        Promise.resolve(
          params.reason === "stopped"
            ? releasesAnswer([
                { id: "r-1", title: "Autumn launch", state: "blocked" },
              ])
            : releasesAnswer([])
        )
    );
    draw([STOPPED, SEO]);
    const [stopped] = screen.getAllByTestId("needs-attention-item");

    const named = await within(stopped).findByRole("link", {
      name: "Autumn launch",
    });
    expect(named.getAttribute("href")).toMatch(/\/releases\/r-1$/);
    expect(releaseReads.fetchReleases).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "attention", reason: "stopped" })
    );
  });

  it("names each overdue release under its row", async () => {
    releaseReads.fetchReleases.mockImplementation(
      (params: { reason?: string }) =>
        Promise.resolve(
          params.reason === "overdue"
            ? releasesAnswer([
                { id: "r-2", title: "Spring sale", state: "scheduled" },
                { id: "r-3", title: "Price change", state: "scheduled" },
              ])
            : releasesAnswer([])
        )
    );
    draw([OVERDUE]);
    const [overdue] = screen.getAllByTestId("needs-attention-item");

    expect(
      await within(overdue).findByRole("link", { name: "Spring sale" })
    ).toBeInTheDocument();
    expect(
      within(overdue).getByRole("link", { name: "Price change" })
    ).toBeInTheDocument();
  });

  it("reads no releases for a row that is not about releases", () => {
    draw([SEO]);
    expect(releaseReads.fetchReleases).not.toHaveBeenCalled();
  });
});

/** The card with `items`, its stored rows four, as the dashboard draws it in its cell. */
function drawStoredFour(items: readonly object[]) {
  return render(
    <CardHeightContext.Provider value={4}>
      {inFrame(
        <NeedsAttention
          widgetId="core/needs-attention"
          placementId="attention"
          settings={{}}
          size={{ w: 8, h: 4, tier: "medium" }}
          data={{ items }}
          refreshing={false}
          retry={() => undefined}
        />,
        "Needs your attention"
      )}
    </CardHeightContext.Provider>
  );
}

describe("NeedsAttention", () => {
  it("keeps every row its stored rows hold though its body is drawn shorter", () => {
    // Drawn one row high, as a card as tall as its content stands, with two items its four stored
    // rows hold: judged against its drawn body the second row would fold. Judged against its
    // stored rows, both show. Fails on a fold measured against the drawn body.
    layOut(4, LIST_ROW_HEIGHT_PX.default, LIST_ROW_HEIGHT_PX.default);
    const { unmount } = drawStoredFour([STOPPED, OVERDUE]);
    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /^Show \d+ more$/ })
    ).toBeNull();
    unmount();
    // The must-differ half: with no stored rows, the body as drawn is what the rows are judged by.
    draw([STOPPED, OVERDUE]);
    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Show 1 more" })
    ).toBeInTheDocument();
  });

  it("draws each item with its severity, label and count, reason and one Review, in the answer's order", () => {
    draw([OVERDUE, SEO]);
    const [overdue, seo] = screen.getAllByTestId("needs-attention-item");

    expect(
      within(overdue).getByTestId("needs-attention-critical")
    ).toHaveTextContent("Critical");
    expect(within(overdue).getByTestId("entity-row-title")).toHaveTextContent(
      "Overdue releases · 2"
    );
    expect(within(overdue).getByTestId("entity-row-meta")).toHaveTextContent(
      "Still scheduled after its time."
    );
    const review = within(overdue).getByRole("link", {
      name: "Review overdue releases",
    });
    expect(review).toHaveTextContent("Review");
    expect(review.getAttribute("href")).toMatch(
      /\/releases\?tab=attention&reason=overdue$/
    );

    // A plugin's warning: a triangle rather than a circle, its floor capped at "99+", and no
    // reason line when the plugin gave none.
    expect(
      within(seo).getByTestId("needs-attention-warning")
    ).toHaveTextContent("Warning");
    expect(within(seo).queryByTestId("needs-attention-critical")).toBeNull();
    expect(within(seo).getByTestId("entity-row-title")).toHaveTextContent(
      "Pages with no description · 99+"
    );
    expect(within(seo).queryByTestId("entity-row-meta")).toBeNull();
    expect(
      within(seo).getByRole("link", {
        name: "Review pages with no description",
      })
    ).toBeInTheDocument();
  });

  it("offers nothing that dismisses or marks an item read, and never says all is clear", () => {
    draw([STOPPED, SEO]);
    for (const row of screen.getAllByTestId("needs-attention-item")) {
      // Review is the one control a row has.
      expect(
        within(row)
          .getAllByRole("link")
          .map(link => link.textContent)
      ).toEqual(["Review"]);
      expect(within(row).queryByRole("button")).toBeNull();
    }
    expect(screen.queryByText(/dismiss|mark (as )?read|all clear/i)).toBeNull();
  });

  it("says a failed item went unchecked, with a Retry that asks the card again once", () => {
    const retry = vi.fn();
    const { rerender } = draw([{ ...OVERDUE, count: 0, failed: true }], {
      retry,
    });
    const row = screen.getByTestId("needs-attention-item");

    expect(within(row).getByText("Overdue releases")).toBeInTheDocument();
    expect(
      within(row).getByTestId("needs-attention-unchecked")
    ).toHaveTextContent("Not all checked·Retry");
    // No number for a count that is unknown, and no Review into a list that was not read.
    expect(within(row).queryByText(/·\s*0/)).toBeNull();
    expect(within(row).queryByRole("link")).toBeNull();

    const button = within(row).getByRole("button", {
      name: "Retry overdue releases",
    });
    button.focus();
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);

    // While the card is asked again Retry keeps its focus and asks nothing more.
    rerender(
      inFrame(
        <NeedsAttention
          widgetId="core/needs-attention"
          placementId="attention"
          settings={{}}
          size={{ w: 8, h: 3, tier: "medium" }}
          data={{ items: [{ ...OVERDUE, count: 0, failed: true }] }}
          refreshing
          retry={retry}
        />,
        "Needs your attention"
      )
    );
    const waiting = screen.getByRole("button", {
      name: "Retry overdue releases",
    });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).toHaveFocus();
    fireEvent.click(waiting);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("folds the items its height does not hold behind Show N more, which shows them, moves focus and says so", () => {
    layOut(3);
    draw([STOPPED, OVERDUE, plugin(3), plugin(2)]);

    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(2);
    const control = screen.getByRole("button", { name: "Show 2 more" });
    expect(control).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(control);
    const rows = screen.getAllByTestId("needs-attention-item");
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveFocus();
    expect(screen.getByText("2 more items shown")).toBeInTheDocument();
    expect(control).toHaveAccessibleName("Show less");

    fireEvent.click(control);
    expect(screen.getAllByTestId("needs-attention-item")).toHaveLength(2);
    expect(screen.queryByText("2 more items shown")).toBeNull();
  });

  it("fills its body with whole rows at 3 and 4 rows tall, its control in the footer's room", () => {
    const items = [STOPPED, OVERDUE, plugin(5), plugin(4), plugin(3)];
    const fits = (h: number) =>
      Math.floor(cardBodyHeightPx(h) / LIST_ROW_HEIGHT_PX.default);
    for (const h of [3, 4]) {
      layOut(h);
      const { unmount } = draw(items);
      expect(
        screen.getAllByTestId("needs-attention-item"),
        `h=${h}`
      ).toHaveLength(fits(h));
      // In the footer, whose room the frame keeps for every card: none of the body's room goes
      // to it, so the rows have all of it.
      const control = screen.getByRole("button", {
        name: `Show ${items.length - fits(h)} more`,
      });
      expect(screen.getByTestId("widget-card-footer")).toContainElement(
        control
      );
      unmount();
      vi.restoreAllMocks();
    }
    // The frame's geometry: 2 rows at 3 tall, 4 at 4.
    expect([fits(3), fits(4)]).toEqual([2, 4]);
  });

  it("carries how many items there are beside its title, read with it", () => {
    draw([STOPPED, OVERDUE, SEO]);
    expect(screen.getByTestId("widget-card-title-count")).toHaveTextContent(
      "3"
    );
    expect(
      screen.getByRole("region", { name: "Needs your attention, 3 items" })
    ).toBeInTheDocument();
  });

  it("says how many items need the reader when it joined the dashboard while they were on it", () => {
    draw([STOPPED, OVERDUE], { revealed: true });
    expect(screen.getByText("2 items need your attention")).toBeInTheDocument();
  });

  it("says nothing of arriving when it was drawn from the start", () => {
    draw([STOPPED, OVERDUE]);
    expect(screen.queryByText(/need your attention/)).toBeNull();
  });
});
