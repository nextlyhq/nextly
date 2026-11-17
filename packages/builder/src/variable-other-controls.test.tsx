// @vitest-environment jsdom

/**
 * The "Other values" kinds, each with a control made for it: a number as the
 * block panel's numeric field, a duration as a number with an ms or s menu,
 * and a custom value as text, refused where it is typed when it would load a
 * file, as the site's save refuses it.
 *
 * Driven through the Variables view, as an author meets them.
 *
 * @module variable-other-controls.test
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
    { name: "number.ratio", kind: "number", values: { light: "1.5" } },
    { name: "duration.fast", kind: "duration", values: { light: "200ms" } },
    { name: "duration.flow", kind: "duration", values: { light: "var(--x)" } },
    { name: "custom.grid", kind: "custom", values: { light: "repeat(3, 1fr)" } },
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

describe("a number", () => {
  it("is the block panel's numeric field, with no unit to choose", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Number ratio/);
    const light = within(editor).getByLabelText("Light");
    expect(light.closest(".nx-style-inspector__numeric")).not.toBeNull();
    expect(within(editor).queryByLabelText("Unit for Light")).toBeNull();
    enter(light, "2");
    expect(savedValue(onChange, "number.ratio")).toBe("2");
  });

  it("refuses text that opens like a number and is not one, where it is typed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Number ratio/);
    const light = within(editor).getByLabelText("Light");
    enter(light, "1..2");
    expect(light.getAttribute("aria-invalid")).toBe("true");
    expect(savedValue(onChange, "number.ratio")).toBeUndefined();
  });
});

describe("a duration", () => {
  it("is a number with a menu of ms and s, keeping the number when the unit changes", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Fast/);
    expect(within(editor).getByLabelText("Light")).toHaveProperty(
      "value",
      "200"
    );
    fireEvent.click(within(editor).getByLabelText("Unit for Light"));
    const units = screen
      .getAllByRole("option", { hidden: true })
      .map(option => option.textContent);
    expect(units).toEqual(["ms", "s"]);
    fireEvent.click(screen.getByRole("option", { name: "s", hidden: true }));
    expect(savedValue(onChange, "duration.fast")).toBe("200s");
  });

  it("takes a typed number in the unit on screen", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Fast/);
    enter(within(editor).getByLabelText("Light"), "350");
    expect(savedValue(onChange, "duration.fast")).toBe("350ms");
  });

  it("shows a duration it cannot split into a number and a unit whole", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Flow/);
    expect(within(editor).getByLabelText("Light")).toHaveProperty(
      "value",
      "var(--x)"
    );
    expect(within(editor).queryByLabelText("Unit for Light")).toBeNull();
  });
});

describe("a custom value", () => {
  it("is a text field holding the value whole", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Custom grid/);
    const light = within(editor).getByLabelText("Light");
    expect(light).toHaveProperty("value", "repeat(3, 1fr)");
    enter(light, "repeat(4, 1fr)");
    expect(savedValue(onChange, "custom.grid")).toBe("repeat(4, 1fr)");
  });

  it("refuses a value that would load a file, where it is typed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Custom grid/);
    const light = within(editor).getByLabelText("Light");
    enter(light, "url(https://elsewhere.example/a.png)");
    expect(light.getAttribute("aria-invalid")).toBe("true");
    expect(within(editor).getByText(/would load a file/)).toBeDefined();
    expect(savedValue(onChange, "custom.grid")).toBeUndefined();
  });
});
