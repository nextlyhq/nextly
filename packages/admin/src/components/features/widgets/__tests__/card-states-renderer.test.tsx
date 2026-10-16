/**
 * How a widget's answer becomes one of the frame's states. Each test separates the right state
 * from the plausible wrong one: "not available" drawn as an error with Retry, an empty list
 * drawn as a blank body, a first load drawn as an empty busy card.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { UNAVAILABLE_TITLE } from "../frame/states";
import { resolveWidgetOutcome } from "../outcome";
import { WidgetRenderer } from "../WidgetRenderer";

const list: DashboardWidget = {
  id: "core/recent-posts",
  title: "Recent posts",
  archetype: "list",
  size: "md",
  query: { source: "collection:posts", op: "list", select: ["title"] },
};

const unavailable: WidgetSlot = {
  ok: false,
  error: "Invalid widget query: unavailable source or unsupported op",
  code: "unavailable",
};

describe("card states from a widget's answer", () => {
  it("draws a source that is not available as the one unavailable state, without Retry", () => {
    expect(resolveWidgetOutcome(list, unavailable)).toEqual({
      state: "unavailable",
    });
    render(
      <WidgetRenderer definition={list} slot={unavailable} onRetry={() => {}} />
    );
    expect(screen.getByText(UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("draws the declaration's description under the title", () => {
    // The frame's one optional line, which a real declaration reaches only through the renderer.
    render(
      <WidgetRenderer
        definition={{ ...list, description: "Newest first" }}
        slot={{ ok: true, result: { op: "list", items: [{ title: "Hello" }] } }}
      />
    );
    expect(screen.getByText("Newest first")).toBeInTheDocument();
  });

  it("draws any other failure as an error with Retry", () => {
    const failed: WidgetSlot = {
      ok: false,
      error: "This widget took too long to answer",
    };
    expect(resolveWidgetOutcome(list, failed)).toEqual({
      state: "failed",
      message: "This widget took too long to answer",
    });
    render(
      <WidgetRenderer definition={list} slot={failed} onRetry={() => {}} />
    );
    expect(
      screen.getByRole("button", { name: "Retry Recent posts" })
    ).toBeInTheDocument();
  });

  it("draws a list with no rows as the frame's empty state", () => {
    const empty: WidgetSlot = { ok: true, result: { op: "list", items: [] } };
    expect(resolveWidgetOutcome(list, empty)).toMatchObject({ state: "empty" });
    render(<WidgetRenderer definition={list} slot={empty} />);
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
  });

  it("draws a first load as a skeleton shaped like the archetype's body", () => {
    render(<WidgetRenderer definition={list} slot={undefined} />);
    expect(screen.getByTestId("card-skeleton")).toHaveAttribute(
      "data-shape",
      "rows"
    );
  });
});
