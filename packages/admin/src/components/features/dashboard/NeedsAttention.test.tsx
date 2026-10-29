/**
 * The Needs your attention card's rows: each item's severity by shape, its
 * label and count, its reason and one Review; a failed item's "Not all
 * checked" with a Retry that asks the card again; no control that dismisses
 * an item; and the fold that grows the card for the items its height does not
 * hold.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { fireEvent, render, screen, within } from "@admin/__tests__/utils";

import { NeedsAttention } from "./NeedsAttention";

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
  props: { refreshing?: boolean; retry?: () => void } = {}
) {
  return render(
    inFrame(
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
    )
  );
}

afterEach(() => vi.restoreAllMocks());

describe("NeedsAttention", () => {
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
    // A body that ends 160 px down, rows 52 px tall from 0, and the control 36 px below the last
    // row: two whole rows fit above the control, the third would be cut.
    const rect = (top: number, bottom: number) =>
      ({
        top,
        bottom,
        left: 0,
        right: 600,
        width: 600,
        height: bottom - top,
      }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.getAttribute("data-testid") === "widget-card-body")
          return rect(0, 160);
        if (this.hasAttribute("data-fold-row")) {
          const index = [
            ...(this.parentElement?.querySelectorAll("[data-fold-row]") ?? []),
          ].indexOf(this);
          return rect(52 * index, 52 * (index + 1));
        }
        if (this.hasAttribute("aria-controls")) {
          const rows = this.parentElement?.querySelectorAll("[data-fold-row]");
          const last = 52 * (rows?.length ?? 0);
          return rect(last + 4, last + 36);
        }
        return rect(0, 0);
      }
    );
    const plugin = (n: number) => ({
      ...SEO,
      id: `seo/item-${n}`,
      label: `Item ${n}`,
      count: n,
    });
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
});
