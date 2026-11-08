// @vitest-environment jsdom

/**
 * The read meter's list of unread blocks, for a block the page's own
 * document does not hold: a header's or a footer's, drawn from the Layout.
 * Such a block is named with the Layout it comes from and offers that
 * Layout's editor, rather than reading as a block the page removed.
 *
 * @module read-budget-meter.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  regionDocument,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanvasRegion } from "./canvas-regions";
import type { PageReadReport } from "./read-budget";
import { ReadBudgetMeter } from "./read-budget-meter";

afterEach(() => {
  cleanup();
});

const pageDocument: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [],
};

/** A header region placing component `hdr`, as the canvas draws it. */
const header: CanvasRegion = {
  area: "header",
  document: regionDocument([{ area: "header", componentId: "hdr" }]),
  label: "Header, from Layout Main",
  badge: "Header · from Layout",
  edit: {
    href: "/admin/layouts/main",
    text: "Edit Layout ↗",
    name: "Edit Layout Main (opens in a new tab)",
  },
};

/** Over the limit, the header's placement the one block left unread. */
const over: PageReadReport = {
  cap: 2,
  used: 2,
  refused: 1,
  byKind: { entries: 2 },
  unread: [{ nodeId: "nextly-region-header", what: "entries" }],
};

function openPanel(regions?: readonly CanvasRegion[]) {
  const select = vi.fn();
  render(
    <ReadBudgetMeter
      report={over}
      editor={{ document: pageDocument, select }}
      componentTitle={id => (id === "hdr" ? "Site header" : undefined)}
      {...(regions === undefined ? {} : { regions })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /reads/i }));
  return select;
}

describe("a Layout region's unread block", () => {
  it("is named with its Layout and offers the Layout's editor", () => {
    openPanel([header]);
    expect(screen.getByText("Site header")).toBeTruthy();
    expect(screen.getByText(/Header, from Layout Main/)).toBeTruthy();
    const edit = screen.getByRole("link", {
      name: "Edit Layout Main (opens in a new tab)",
    });
    expect(edit.getAttribute("href")).toBe("/admin/layouts/main");
    expect(screen.queryByText("A removed block")).toBeNull();
    // The count's own default, said as the default limit is.
    expect(
      screen.getByText(/Images are counted as the media library reads them/)
    ).toBeTruthy();
  });

  it("reads as a removed block where the editor is not told of the Layout", () => {
    openPanel();
    expect(screen.getByText("A removed block")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("a count that could not be made", () => {
  it("says so in the meter's place, its tooltip the same words, and retries when pressed", () => {
    const retry = vi.fn();
    render(
      <ReadBudgetMeter
        report={undefined}
        editor={{ document: pageDocument, select: vi.fn() }}
        failed={{ retry }}
      />
    );
    const meter = screen.getByRole("button", {
      name: "Couldn't count page reads. Retry",
    });
    expect(meter.getAttribute("title")).toBe(
      "Couldn't count page reads. Retry"
    );
    // Never "Counting": the count is not on its way.
    expect(meter.getAttribute("aria-busy")).toBeNull();
    expect(meter.textContent).toContain("Couldn't count reads");
    fireEvent.click(meter);
    expect(retry).toHaveBeenCalledTimes(1);
    // A press retries; it opens no panel, which would have nothing to say.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
