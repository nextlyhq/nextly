// @vitest-environment jsdom

/**
 * When the page data meter shows, and what it says.
 *
 * The top bar shows it only once a page nears its limit (80% of it), in the
 * warning colour, and in the danger colour once the limit is spent or passed;
 * never while the page is counted, far under the limit, or where the site
 * sets no limit. A count that could not be made shows too, since a hidden
 * failure could hide a page over its limit. Page settings shows the count at
 * every level. Each is one button, named with the numbers and the standing.
 *
 * The site limit here is 200, so its 80% is 160.
 *
 * @module read-budget-meter.standing.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageReadReport } from "./read-budget";
import {
  ReadBudgetMeter,
  type ReadBudgetMeterProps,
} from "./read-budget-meter";

afterEach(() => {
  cleanup();
});

const pageDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "list-1",
      type: "core/collection-loop",
      version: 1,
      name: "Latest posts",
      props: {},
      slots: { children: [] },
    },
  ],
} as unknown as BlockDocument;

const editor = { document: pageDocument, select: vi.fn() };

/** A count of `used` reads against a limit of `cap`. */
function counted(
  used: number,
  cap = 200,
  extra: Partial<PageReadReport> = {}
): PageReadReport {
  return {
    cap,
    used,
    refused: 0,
    byKind: used === 0 ? {} : { entries: used },
    unread: [],
    ...extra,
  };
}

/** Over the limit: the list's read was refused. */
const over = counted(200, 200, {
  refused: 3,
  unread: [{ nodeId: "list-1", what: "entries" }],
});

function bar(props: Partial<ReadBudgetMeterProps>) {
  return render(
    <ReadBudgetMeter report={undefined} editor={editor} {...props} />
  );
}

function settings(props: Partial<ReadBudgetMeterProps>) {
  return render(
    <ReadBudgetMeter
      report={undefined}
      editor={editor}
      place="settings"
      {...props}
    />
  );
}

describe("the top bar's meter", () => {
  it.each([
    ["at 0%", counted(0)],
    ["at 79%", counted(158)],
    ["while counting", undefined],
    ["where the site sets no limit", counted(4000, Infinity)],
  ])("shows nothing %s", (_case, report) => {
    const { container } = bar({ report });
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows from 80%, in the warning colour, with what's this?", () => {
    bar({ report: counted(160) });
    const meter = screen.getByRole("button");
    expect(meter.textContent).toBe("Page data: 160 of 200 · what's this?");
    expect(meter.getAttribute("data-standing")).toBe("near");
    expect(meter.getAttribute("aria-label")).toBe(
      "Page data: 160 of 200, near the limit. What's this?"
    );
    // "what's this?" is drawn as a link inside the one button, not a
    // second control.
    expect(meter.querySelector(".nx-read-meter__link")?.textContent).toBe(
      "what's this?"
    );
  });

  it("is in the danger colour at 100%, with over the limit", () => {
    bar({ report: counted(200) });
    const meter = screen.getByRole("button");
    expect(meter.textContent).toBe("Page data: 200 of 200 · over the limit");
    expect(meter.getAttribute("data-standing")).toBe("over");
    expect(meter.getAttribute("aria-label")).toBe(
      "Page data: 200 of 200, over the limit. What's this?"
    );
  });

  it("is in the danger colour over the limit, and its explanation names the blocks that come up empty", () => {
    bar({ report: over });
    const meter = screen.getByRole("button");
    expect(meter.textContent).toBe("Page data: 200 of 200 · over the limit");
    expect(meter.getAttribute("data-standing")).toBe("over");
    fireEvent.click(meter);
    const panel = screen.getByRole("dialog", { name: "Page data" });
    expect(panel.textContent).toContain("1 block comes up empty");
    expect(panel.textContent).toContain("Latest posts");
    expect(panel.textContent).toContain("Its entries don't load");
    // The limit is the site's, said as it is, not as the default.
    expect(panel.textContent).toContain("Limit 200");
    expect(panel.textContent).not.toContain("(the default)");
    expect(panel.textContent).toContain("Warning from 160");
  });

  it("says a count that could not be made, and Retry counts again", () => {
    const retry = vi.fn();
    bar({ failed: { retry } });
    const meter = screen.getByRole("button");
    expect(meter.textContent).toBe("Page data: couldn't count · Retry");
    expect(meter.getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    fireEvent.click(meter);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("is one Tab stop", () => {
    bar({ report: counted(180) });
    const meter = screen.getByRole("button");
    meter.focus();
    expect(document.activeElement).toBe(meter);
    expect(meter.getAttribute("tabindex")).toBeNull();
    // Nothing inside it takes focus of its own.
    expect(meter.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(
      0
    );
  });

  it("never calls its unit reads", () => {
    for (const report of [counted(160), counted(200), over]) {
      const { unmount } = bar({ report });
      const meter = screen.getByRole("button");
      expect(meter.textContent).not.toMatch(/\breads?\b/i);
      expect(meter.getAttribute("aria-label")).not.toMatch(/\breads?\b/i);
      unmount();
    }
  });
});

describe("the Page settings line", () => {
  it("shows the count well under the limit, with the same explanation", () => {
    settings({ report: counted(12, 500) });
    const line = screen.getByRole("button", {
      name: "Page data: 12 of 500, within the limit. What's this?",
    });
    expect(line.textContent).toBe("Page data: 12 of 500");
    expect(line.getAttribute("data-standing")).toBe("within");
    fireEvent.click(line);
    const panel = screen.getByRole("dialog", { name: "Page data" });
    expect(panel.textContent).toContain("Within the limit");
    expect(panel.textContent).toContain("Limit 500 (the default)");
  });

  it("says counting while the page is counted", () => {
    settings({ report: undefined });
    const line = screen.getByRole("button");
    expect(line.textContent).toBe("Page data: counting…");
    expect(line.getAttribute("aria-busy")).toBe("true");
  });

  it("is in the warning colour near the limit and the danger colour over it", () => {
    const { rerender } = settings({ report: counted(170) });
    expect(screen.getByRole("button").getAttribute("data-standing")).toBe(
      "near"
    );
    expect(screen.getByRole("button").textContent).toBe(
      "Page data: 170 of 200 · what's this?"
    );
    rerender(
      <ReadBudgetMeter report={over} editor={editor} place="settings" />
    );
    expect(screen.getByRole("button").getAttribute("data-standing")).toBe(
      "over"
    );
    expect(screen.getByRole("button").textContent).toBe(
      "Page data: 200 of 200 · over the limit"
    );
  });

  it("says no limit where the site sets none", () => {
    settings({ report: counted(4000, Infinity) });
    expect(screen.getByRole("button").textContent).toBe(
      "Page data: 4,000 (no limit)"
    );
  });

  it("says a count that could not be made, as the bar does", () => {
    settings({ failed: { retry: vi.fn() } });
    expect(screen.getByRole("button").textContent).toBe(
      "Page data: couldn't count · Retry"
    );
  });
});
