// @vitest-environment jsdom

/**
 * A variable's value is drawn on the canvas as it is typed or picked, and
 * handed to the host to store only once, when the edit ends. The panel says
 * what to draw through `onPreview`, the last valid value while the typing is
 * not one yet, and `null` once the edit is over, before the edit's one write.
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
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TokensPanel } from "./tokens-panel";

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
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
    { name: "custom.ratio", kind: "custom", values: { light: "4 / 3" } },
  ],
};

/** What the host was told, in order: a preview's Brand, its end, a write. */
type Heard = string;

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted({
  heard,
  valueOf,
}: {
  heard: Heard[];
  valueOf: (tokens: SiteTokenSet) => string | undefined;
}): React.JSX.Element {
  const [tokens, setTokens] = React.useState(SITE);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      tokens={tokens}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setTokens(next);
        heard.push(`write ${valueOf(next) ?? "?"}`);
      }}
      onPreview={next => {
        heard.push(next === null ? "end" : `draw ${valueOf(next) ?? "?"}`);
      }}
    />
  );
}

const brandOf = (tokens: SiteTokenSet): string | undefined =>
  tokens.tokens.find(token => token.name === "color.brand")?.values.light;
const ratioOf = (tokens: SiteTokenSet): string | undefined =>
  tokens.tokens.find(token => token.name === "custom.ratio")?.values.light;

async function open(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("a variable's value previews as it is edited", () => {
  it("draws each valid colour typed, keeps the last while one is half typed, and writes once on leaving", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={brandOf} />);
    const editor = await open(/^Brand/);
    const field = within(editor).getByRole("textbox", { name: "Light" });

    fireEvent.change(field, { target: { value: "#ff" } });
    expect(heard).toEqual([]);
    fireEvent.change(field, { target: { value: "#ff0000" } });
    expect(heard).toEqual(["draw #ff0000"]);
    // Half a colour again: the canvas keeps the last valid one.
    fireEvent.change(field, { target: { value: "#00f" } });
    fireEvent.change(field, { target: { value: "#00ff0" } });
    fireEvent.change(field, { target: { value: "#00ff00" } });
    expect(heard).toEqual(["draw #ff0000", "draw #00f", "draw #00ff00"]);

    // Leaving the field ends the preview, then writes the edit once.
    fireEvent.blur(field);
    expect(heard).toEqual([
      "draw #ff0000",
      "draw #00f",
      "draw #00ff00",
      "end",
      "write #00ff00",
    ]);
  });

  it("ends the preview and writes nothing when the field is left as it was", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={brandOf} />);
    const editor = await open(/^Brand/);
    const field = within(editor).getByRole("textbox", { name: "Light" });

    fireEvent.change(field, { target: { value: "#ff0000" } });
    fireEvent.change(field, { target: { value: "#1d2b6b" } });
    fireEvent.blur(field);
    expect(heard).toEqual(["draw #ff0000", "draw #1d2b6b", "end"]);
  });

  it("ends the preview when the editor closes mid-edit", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={brandOf} />);
    const editor = await open(/^Brand/);
    const field = within(editor).getByRole("textbox", { name: "Light" });

    fireEvent.change(field, { target: { value: "#ff0000" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(heard[0]).toBe("draw #ff0000");
    expect(heard).toContain("end");
    expect(heard.filter(said => said.startsWith("draw"))).toHaveLength(1);
  });

  it("draws the picker's colour as it moves, and writes once when it closes", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={brandOf} />);
    const editor = await open(/^Brand/);
    const swatch = within(editor).getByRole("button", {
      name: "Pick the light colour",
    });
    fireEvent.click(swatch);
    // The surface's arrow keys move it as a drag does, one report a move.
    const surface = within(editor).getByRole("application", {
      name: /Saturation and brightness/,
    });
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    const draws = heard.filter(said => said.startsWith("draw"));
    expect(draws).toHaveLength(2);
    expect(draws[0]).not.toBe("draw #1d2b6b");
    expect(draws[1]).not.toBe(draws[0]);
    expect(heard.some(said => said.startsWith("write"))).toBe(false);

    fireEvent.click(swatch);
    const last = (draws[1] ?? "").replace("draw ", "");
    expect(heard.slice(2)).toEqual(["end", `write ${last}`]);
  });

  it("draws a text value as it is typed, and writes once on Enter", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={ratioOf} />);
    const editor = await open(/^Custom ratio/);
    const field = within(editor).getByRole("textbox", { name: "Light" });

    fireEvent.change(field, { target: { value: "16 / 9" } });
    expect(heard).toEqual(["draw 16 / 9"]);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(heard).toEqual(["draw 16 / 9", "end", "write 16 / 9"]);
  });
});
