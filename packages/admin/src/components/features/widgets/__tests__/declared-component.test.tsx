/**
 * A widget declared with `defineWidget` and drawn by its own component: the
 * frame draws loading, no permission and error itself, the component is called
 * only once there is data and is handed the props its declaration types
 * (`WidgetProps`), its size follows the card's tier, and a throw while drawing
 * is that card's error alone, with a Retry that draws it again.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { DeclaredComponent } from "../declared-component";
import { CardTierContext } from "../frame/tier";
import { WidgetRenderer } from "../WidgetRenderer";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

const PATH = "@acme/admin#Revenue";

/** As the server publishes a declared widget drawn by its own component. */
const declared: DashboardWidget = {
  id: "acme/revenue",
  title: "Revenue",
  archetype: "custom",
  size: "md",
  component: PATH,
  serverData: true,
};

const dataSlot = (data: number | Record<string, number>): WidgetSlot => ({
  ok: true,
  result: { op: "data", data },
});

/** Records the props each call was handed, and draws them. */
function recording() {
  const seen: DeclaredComponentProps[] = [];
  const Revenue = (props: DeclaredComponentProps): JSX.Element => {
    seen.push(props);
    return <p data-testid="revenue">{JSON.stringify(props.data)}</p>;
  };
  registerComponent(PATH, Revenue);
  return seen;
}

describe("a declared widget drawn by its own component", () => {
  it("is drawn by the frame while its data is coming, and the component is not called", () => {
    const seen = recording();
    render(<WidgetRenderer definition={declared} slot={undefined} />);
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
    expect(seen).toEqual([]);
  });

  it("is drawn by the frame when its data is not the reader's, or failed", () => {
    const seen = recording();
    const { unmount } = render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: false, code: "unavailable", error: "forbidden" }}
      />
    );
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    unmount();
    const onRetry = vi.fn();
    render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: false, error: "The store did not answer." }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    // 🔴 The component never decides what an absent answer looks like.
    expect(seen).toEqual([]);
  });

  it("hands the component its data, settings, size, refreshing and retry", async () => {
    const seen = recording();
    const onRetry = vi.fn();
    render(
      <WidgetRenderer
        definition={declared}
        slot={dataSlot({ total: 42 })}
        placement={{ id: "card-1", settings: { range: "30d" }, width: "third" }}
        isFetching
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId("revenue")).toHaveTextContent('{"total":42}');
    const props = seen.at(-1)!;
    expect(props).toMatchObject({
      widgetId: "acme/revenue",
      placementId: "card-1",
      settings: { range: "30d" },
      data: { total: 42 },
      refreshing: true,
    });
    expect(props.size.width).toBe("third");
    props.retry();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("follows the card's size as its tier changes", () => {
    const seen = recording();
    const card = (tier: "small" | "large") => (
      <CardTierContext.Provider value={tier}>
        <DeclaredComponent
          definition={declared}
          placement={{ id: "card-1", settings: {}, width: "quarter" }}
          data={1}
          refreshing={false}
        />
      </CardTierContext.Provider>
    );
    const { rerender } = render(card("small"));
    expect(seen.at(-1)?.size).toEqual({ width: "quarter", class: "small" });
    rerender(card("large"));
    // 🔴 The size is read on every draw, not fixed at the first.
    expect(seen.at(-1)?.size.class).toBe("large");
  });

  it("shows a throw while drawing as that card's error alone, and Retry draws it again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const Revenue = (): JSX.Element => {
      if (fail) throw new Error("boom");
      return <p data-testid="revenue">drawn</p>;
    };
    registerComponent(PATH, Revenue);
    registerComponent("@acme/admin#Other", () => <p>other card</p>);
    const onRetry = vi.fn();
    render(
      <>
        <WidgetRenderer
          definition={declared}
          slot={dataSlot(1)}
          onRetry={onRetry}
        />
        <WidgetRenderer
          definition={{
            ...declared,
            id: "acme/other",
            title: "Other",
            component: "@acme/admin#Other",
          }}
          slot={dataSlot(2)}
        />
      </>
    );
    // The card's own error state, not the plugin boundary's generic message.
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    expect(
      screen.queryByText(/This plugin component failed to load/)
    ).toBeNull();
    // The card beside it is untouched.
    expect(screen.getByText("other card")).toBeInTheDocument();
    fail = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Retry Revenue" })
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("revenue")).toHaveTextContent("drawn");
  });

  it("leaves a core custom card, which asks its own questions, drawing its own states", () => {
    // The control: without `serverData` a custom card is self-drawn, handed
    // its slot, as core's own custom cards are.
    const props: unknown[] = [];
    registerComponent(PATH, (p: unknown) => {
      props.push(p);
      return <p>self drawn</p>;
    });
    render(
      <WidgetRenderer
        definition={{ ...declared, serverData: undefined }}
        slot={undefined}
      />
    );
    expect(screen.getByText("self drawn")).toBeInTheDocument();
    expect(props.at(-1)).toHaveProperty("slot", undefined);
  });
});
