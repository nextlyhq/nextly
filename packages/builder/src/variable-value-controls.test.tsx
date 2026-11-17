// @vitest-environment jsdom

/**
 * Each kind of Design value edited with a control made for it: a size with
 * a number and a unit menu, the one the block panel draws, and a line height
 * as a multiple of the text size, with a hint when a number reads as pixels.
 *
 * Driven through the Variables view, as an author meets them.
 *
 * @module variable-value-controls.test
 */
import { type SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TokensPanel, type TokensPanelProps } from "./tokens-panel";

type HostedProps = Omit<TokensPanelProps, "currentTokens" | "onChange"> &
  Partial<Pick<TokensPanelProps, "currentTokens" | "onChange">>;

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted(props: HostedProps): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      {...props}
      tokens={tokens}
      currentTokens={props.currentTokens ?? (() => latest.current)}
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

const SITE: SiteTokenSet = {
  tokens: [
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "number", values: { light: "1.5" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

async function openEditor(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

/** Type into a field and press Enter, which commits it. */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
}

/** The value a write left on a variable, by its name. */
function savedValue(
  onChange: ReturnType<typeof vi.fn>,
  name: string
): string | undefined {
  const set = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet | undefined;
  return set?.tokens.find(token => token.name === name)?.values.light;
}

describe("a size", () => {
  it("is a number with a unit menu of px, rem, em, %, vw and vh", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Space 4/);
    // The number alone in the field; its unit in the menu beside it.
    expect(within(editor).getByLabelText("Light")).toHaveProperty("value", "1");
    fireEvent.click(within(editor).getByLabelText("Unit for Light"));
    const units = screen
      .getAllByRole("option", { hidden: true })
      .map(option => option.textContent);
    expect(units).toEqual(
      expect.arrayContaining(["px", "rem", "em", "%", "vw", "vh"])
    );
  });

  it("saves a bare number as pixels", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    // Over a field showing rem, a bare number takes the unit on screen;
    // with px chosen first, it is pixels.
    fireEvent.click(within(editor).getByLabelText("Unit for Light"));
    fireEvent.click(screen.getByRole("option", { name: "px", hidden: true }));
    enter(within(editor).getByLabelText("Light"), "16");
    expect(savedValue(onChange, "space.4")).toBe("16px");
  });

  it.each([
    "calc(1rem + 2px)",
    "clamp(1rem, 2vw, 2rem)",
    "min(1rem, 4vw)",
    "max(1rem, 4vw)",
  ])("takes a typed %s as it is", async typed => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    enter(within(editor).getByLabelText("Light"), typed);
    expect(savedValue(onChange, "space.4")).toBe(typed);
  });

  it("is the control the block panel draws for a length", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Space 4/);
    const field = within(editor).getByLabelText("Light");
    // The block panel's numeric field: its number, then its unit menu, in
    // one row.
    expect(field.closest(".nx-style-inspector__numeric")).not.toBeNull();
    expect(
      field
        .closest(".nx-style-inspector__numeric")
        ?.querySelector(".nx-style-inspector__unit")
    ).not.toBeNull();
  });
});

describe("a size, answering a refusal and holding a negative", () => {
  it.each([
    ["a value the field shows whole", "clamp(1rem, 2vw, 2rem)", "clamp(1rem, 2vw, 2rem)"],
    ["a number beside its unit", "1rem", "1"],
  ])("clears a refusal when %s is typed back", async (_, stored, typed) => {
    const held: SiteTokenSet = {
      tokens: [
        { name: "space.4", kind: "dimension", values: { light: stored } },
      ],
    };
    render(<Hosted tokens={held} />);
    const editor = await openEditor(/^Space 4/);
    const light = within(editor).getByLabelText("Light");
    enter(light, "red");
    expect(light.getAttribute("aria-invalid")).toBe("true");
    enter(light, typed);
    expect(light.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps the unit on screen for a negative number", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    enter(within(editor).getByLabelText("Light"), "-2");
    expect(savedValue(onChange, "space.4")).toBe("-2rem");
  });

  it("changes the unit of a negative size", async () => {
    const onChange = vi.fn();
    const negative: SiteTokenSet = {
      tokens: [
        { name: "space.4", kind: "dimension", values: { light: "-1rem" } },
      ],
    };
    render(<Hosted tokens={negative} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    fireEvent.click(within(editor).getByLabelText("Unit for Light"));
    fireEvent.click(screen.getByRole("option", { name: "px", hidden: true }));
    expect(savedValue(onChange, "space.4")).toBe("-1px");
  });
});

describe("the CSS a size writes", () => {
  it("shows on hover over the number and its unit menu", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Space 4/);
    const size = within(editor)
      .getByLabelText("Unit for Light")
      .closest("[title]");
    expect(size?.getAttribute("title")).toBe("--site-space-4: 1rem");
  });

  it("names the custom property under the site's own prefix", async () => {
    render(<Hosted tokens={{ ...SITE, prefix: "--brand-" }} />);
    const editor = await openEditor(/^Space 4/);
    const size = within(editor)
      .getByLabelText("Unit for Light")
      .closest("[title]");
    expect(size?.getAttribute("title")).toBe("--brand-space-4: 1rem");
  });
});

describe("a line height", () => {
  it("is a plain number, labelled as times the text size", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Body/);
    const line = within(editor).getByLabelText("Line height, light");
    expect(line).toHaveProperty("value", "1.5");
    expect(line.parentElement?.textContent).toContain("×");
    expect(within(editor).queryByText(/Did you mean/)).toBeNull();
  });

  it("offers pixels for a number that reads as them, and uses them when asked", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    enter(within(editor).getByLabelText("Line height, light"), "20");
    expect(
      within(editor).getByText("20× the text size. Did you mean 20px?")
    ).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Use 20px" }));
    expect(savedValue(onChange, "line-height.body")).toBe("20px");
  });

  it("edits a line height with no type size of its own as a line height, never a size", async () => {
    const onChange = vi.fn();
    const alone: SiteTokenSet = {
      tokens: [
        { name: "line-height.hero", kind: "dimension", values: { light: "24px" } },
      ],
    };
    render(<Hosted tokens={alone} onChange={onChange} />);
    const editor = await openEditor(/^Hero/);
    const light = within(editor).getByLabelText("Light");
    // The whole value in one field, with no unit menu to add px to a number.
    expect(light).toHaveProperty("value", "24px");
    expect(within(editor).queryByLabelText("Unit for Light")).toBeNull();
    enter(light, "1.5");
    expect(savedValue(onChange, "line-height.hero")).toBe("1.5");
  });

  it("explains rather than offers pixels for a dark line height, which must be the same kind as its light", async () => {
    const paired: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px", dark: "16px" },
        },
        {
          name: "line-height.body",
          kind: "number",
          values: { light: "1.5", dark: "20" },
        },
      ],
    };
    render(<Hosted tokens={paired} />);
    const editor = await openEditor(/^Body/);
    expect(
      within(editor).getByText(
        "20× the text size. To use pixels, give the light line height pixels first."
      )
    ).toBeDefined();
    expect(
      within(editor).queryByRole("button", { name: "Use 20px" })
    ).toBeNull();
  });
});
