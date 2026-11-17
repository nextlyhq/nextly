// @vitest-environment jsdom

/**
 * "Fluid…" on a size in Design: two sizes, "On small screens" and "On large
 * screens", the sentence that says what they make, and the size they store,
 * with the two sizes kept beside it. A value written by hand opens on its
 * nearest two sizes.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fluidValue } from "./fluid-size";
import { TokensPanel, type TokensPanelProps } from "./tokens-panel";

type HostedProps = Omit<TokensPanelProps, "currentTokens" | "onChange"> &
  Partial<Pick<TokensPanelProps, "onChange">>;

function Hosted(props: HostedProps): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      {...props}
      tokens={tokens}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setTokens(next);
        props.onChange?.(next);
      }}
    />
  );
}

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const RANGE = { min: 360, max: 1280 };

const SITE: SiteTokenSet = {
  tokens: [
    { name: "space.gap", kind: "dimension", values: { light: "1rem" } },
    {
      name: "space.hero",
      kind: "dimension",
      values: { light: "clamp(1rem, 0.875rem + 0.5vw, 1.25rem)" },
    },
    { name: "font-size.lead", kind: "dimension", values: { light: "18px" } },
    { name: "line-height.lead", kind: "number", values: { light: "1.4" } },
  ],
};

async function fluidFor(row: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: row }));
  const editor = await screen.findByRole("dialog");
  fireEvent.click(within(editor).getByRole("button", { name: "Fluid…" }));
  return screen.findByRole("group", { name: "Fluid size" });
}

describe("Fluid… on a size", () => {
  it("asks for two sizes, says what they make, and stores the size with them", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const fluid = await fluidFor(/^Gap,/);
    const small = within(fluid).getByLabelText("On small screens");
    const large = within(fluid).getByLabelText("On large screens");
    fireEvent.change(small, { target: { value: "16" } });
    fireEvent.change(large, { target: { value: "24" } });
    expect(fluid.textContent).toContain(
      "16px at 360px, growing to 24px at 1280px"
    );
    fireEvent.click(within(fluid).getByRole("button", { name: "Make fluid" }));
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[0]?.values.light).toBe(
      fluidValue({ small: 16, large: 24 }, RANGE)
    );
    expect(saved.tokens[0]?.fluid).toEqual({ small: 16, large: 24 });
  });

  it("opens a value written by hand on its nearest two sizes", async () => {
    render(<Hosted tokens={SITE} />);
    const fluid = await fluidFor(/^Hero,/);
    expect(
      (within(fluid).getByLabelText("On small screens") as HTMLInputElement)
        .value
    ).toBe("16");
    expect(
      (within(fluid).getByLabelText("On large screens") as HTMLInputElement)
        .value
    ).toBe("20");
  });

  it("is offered on a type size, for its size", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const fluid = await fluidFor(/^Lead,/);
    fireEvent.change(within(fluid).getByLabelText("On small screens"), {
      target: { value: "18" },
    });
    fireEvent.change(within(fluid).getByLabelText("On large screens"), {
      target: { value: "22" },
    });
    fireEvent.click(within(fluid).getByRole("button", { name: "Make fluid" }));
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    const lead = saved.tokens.find(token => token.name === "font-size.lead");
    expect(lead?.fluid).toEqual({ small: 18, large: 22 });
  });

  it("is not offered where the variables are read-only", async () => {
    render(<Hosted tokens={SITE} readOnly />);
    fireEvent.click(screen.getByRole("button", { name: /^Gap,/ }));
    const editor = await screen.findByRole("dialog");
    expect(within(editor).queryByRole("button", { name: "Fluid…" })).toBeNull();
  });
});

describe("the site's fluid range", () => {
  const made: SiteTokenSet = {
    tokens: [
      {
        name: "font-size.lead",
        kind: "dimension",
        values: { light: fluidValue({ small: 16, large: 20 }, RANGE) },
        fluid: { small: 16, large: 20 },
      },
      { name: "line-height.lead", kind: "number", values: { light: "1.4" } },
    ],
  };

  /** Types a width into a field and leaves it. */
  function enter(field: HTMLElement, value: string): void {
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  }

  it("is set in the Type tab, and remakes the sizes made with Fluid…", () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={made} groups={["type", "fonts"]} onChange={onChange} />
    );
    const range = screen.getByRole("group", { name: "Fluid range" });
    expect(
      (within(range).getByLabelText("Smallest screen") as HTMLInputElement)
        .value
    ).toBe("360");
    enter(within(range).getByLabelText("Largest screen"), "1440");
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.fluidRange).toEqual({ min: 360, max: 1440 });
    expect(saved.tokens[0]?.values.light).toBe(
      fluidValue({ small: 16, large: 20 }, { min: 360, max: 1440 })
    );
  });

  it("is reached from Fluid… as Change range", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={made} onChange={onChange} />);
    const fluid = await fluidFor(/^Lead,/);
    fireEvent.click(
      within(fluid).getByRole("button", { name: "Change range" })
    );
    const range = within(fluid).getByRole("group", { name: "Fluid range" });
    enter(within(range).getByLabelText("Smallest screen"), "320");
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.fluidRange).toEqual({ min: 320, max: 1280 });
  });

  it("refuses a range whose smallest screen is not the smaller, saying why", () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={made} groups={["type", "fonts"]} onChange={onChange} />
    );
    const range = screen.getByRole("group", { name: "Fluid range" });
    const smallest = within(range).getByLabelText("Smallest screen");
    enter(smallest, "1600");
    expect(onChange).not.toHaveBeenCalled();
    expect(smallest.getAttribute("aria-invalid")).toBe("true");
  });
});
