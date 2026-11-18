// @vitest-environment jsdom

/**
 * A variable's value is drawn on the canvas as it is typed or picked, and
 * handed to the host to store only once, when the edit ends. The panel says
 * what to draw through `onPreview`, the last valid value while the typing is
 * not one yet, and `null` once the edit is over, before the edit's one write.
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FontChoicesContext } from "./font-family-field";
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
    { name: "space.gutter", kind: "dimension", values: { light: "16px" } },
    {
      name: "shadow.raised",
      kind: "shadow",
      values: { light: "0px 2px 4px 0px #000000" },
    },
    {
      name: "font.heading",
      kind: "fontFamily",
      values: { light: '"Inter", sans-serif' },
    },
    { name: "weight.strong", kind: "fontWeight", values: { light: "700" } },
    { name: "duration.quick", kind: "duration", values: { light: "200ms" } },
  ],
};

/** Inter at Regular 400 and Bold 700, the site's own font. */
const INTER: readonly FontFaceDef[] = [
  {
    family: "Inter",
    src: [{ url: "/fonts/inter-400.woff2", format: "woff2" }],
    weight: "400",
  },
  {
    family: "Inter",
    src: [{ url: "/fonts/inter-700.woff2", format: "woff2" }],
    weight: "700",
  },
];

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
    <FontChoicesContext.Provider value={{ faces: INTER, fromCode: [] }}>
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
    </FontChoicesContext.Provider>
  );
}

const brandOf = (tokens: SiteTokenSet): string | undefined =>
  tokens.tokens.find(token => token.name === "color.brand")?.values.light;
const ratioOf = (tokens: SiteTokenSet): string | undefined =>
  tokens.tokens.find(token => token.name === "custom.ratio")?.values.light;
/** A variable's light value, by its name. */
const lightOf =
  (name: string) =>
  (tokens: SiteTokenSet): string | undefined =>
    tokens.tokens.find(token => token.name === name)?.values.light;

/** What was heard, only the writes. */
const writes = (heard: readonly Heard[]): Heard[] =>
  heard.filter(said => said.startsWith("write"));

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

  it("draws a size as it is typed, keeps the last valid one while a unit is typed, and writes once on leaving", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("space.gutter")} />);
    const editor = await open(/^Section padding \(sides\),/);
    const field = within(editor).getByLabelText("Light");

    fireEvent.change(field, { target: { value: "2" } });
    // A bare number is drawn in the unit the field shows.
    expect(heard).toEqual(["draw 2px"]);
    fireEvent.change(field, { target: { value: "2r" } });
    fireEvent.change(field, { target: { value: "2re" } });
    expect(heard).toEqual(["draw 2px"]);
    fireEvent.change(field, { target: { value: "2rem" } });
    expect(heard).toEqual(["draw 2px", "draw 2rem"]);

    fireEvent.blur(field);
    expect(heard).toEqual(["draw 2px", "draw 2rem", "end", "write 2rem"]);
  });

  it("ends a size's preview and writes nothing when the editor closes mid-edit", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("space.gutter")} />);
    const editor = await open(/^Section padding \(sides\),/);
    const field = within(editor).getByLabelText("Light");

    fireEvent.change(field, { target: { value: "24" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(heard).toEqual(["draw 24px", "end"]);
  });

  it("draws a whole shadow as a layer's size is typed, never one it would refuse, and writes once", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("shadow.raised")} />);
    const editor = await open(/^Raised/);
    const blur = within(editor).getByLabelText("Blur");

    fireEvent.change(blur, { target: { value: "8" } });
    expect(heard).toEqual(["draw 0px 2px 8px 0px #000000"]);
    // A negative blur draws nothing: the canvas keeps the last valid shadow.
    fireEvent.change(blur, { target: { value: "-8" } });
    expect(heard).toEqual(["draw 0px 2px 8px 0px #000000"]);
    fireEvent.change(blur, { target: { value: "12" } });
    expect(writes(heard)).toEqual([]);

    fireEvent.keyDown(blur, { key: "Enter" });
    expect(heard).toEqual([
      "draw 0px 2px 8px 0px #000000",
      "draw 0px 2px 12px 0px #000000",
      "end",
      "write 0px 2px 12px 0px #000000",
    ]);
  });

  it("draws a shadow as its colour is typed, and writes once on leaving", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("shadow.raised")} />);
    const editor = await open(/^Raised/);
    const colour = within(editor).getByRole("textbox", { name: "Colour" });

    fireEvent.change(colour, { target: { value: "#ff" } });
    fireEvent.change(colour, { target: { value: "#ff0000" } });
    expect(heard).toEqual(["draw 0px 2px 4px 0px #ff0000"]);
    fireEvent.blur(colour);
    expect(heard).toEqual([
      "draw 0px 2px 4px 0px #ff0000",
      "end",
      "write 0px 2px 4px 0px #ff0000",
    ]);
  });

  it("draws the font the keyboard is on in the list, and writes once when one is picked", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("font.heading")} />);
    const editor = await open(/^Heading/);
    fireEvent.click(within(editor).getByRole("button", { name: /^Font, / }));
    const list = screen.getByRole("listbox", { name: "Fonts", hidden: true });
    const keys = (screen.queryByRole("combobox", {
      name: "Search fonts",
      hidden: true,
    }) ?? list) as HTMLElement;

    fireEvent.keyDown(keys, { key: "ArrowDown" });
    fireEvent.keyDown(keys, { key: "ArrowDown" });
    const draws = heard.filter(said => said.startsWith("draw"));
    expect(draws).toHaveLength(2);
    expect(draws[0]).not.toBe(draws[1]);
    expect(writes(heard)).toEqual([]);

    fireEvent.keyDown(keys, { key: "Enter" });
    const last = (draws[1] ?? "").replace("draw ", "");
    expect(heard.slice(2)).toEqual(["end", `write ${last}`]);
  });

  it("puts the stored font back when the list closes without a pick", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("font.heading")} />);
    const editor = await open(/^Heading/);
    const trigger = within(editor).getByRole("button", { name: /^Font, / });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Fonts", hidden: true });
    const option = within(list).getAllByRole("option", { hidden: true })[2];
    if (option === undefined) throw new Error("no third font");
    fireEvent.mouseMove(option);
    expect(heard).toHaveLength(1);

    // The trigger again closes the list.
    fireEvent.click(trigger);
    expect(heard).toEqual([heard[0], "end"]);
  });

  it("draws the weight the list is on, and writes once when one is chosen", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("weight.strong")} />);
    const editor = await open(/^Strong/);
    fireEvent.click(within(editor).getByLabelText("Light"));
    const regular = screen.getByRole("option", {
      name: /^Regular 400/,
      hidden: true,
    });
    fireEvent.focus(regular);
    expect(heard).toEqual(["draw 400"]);

    fireEvent.click(regular);
    expect(heard).toEqual(["draw 400", "end", "write 400"]);
  });

  it("draws a duration as it is typed, in the unit shown, and writes once on Enter", async () => {
    const heard: Heard[] = [];
    render(<Hosted heard={heard} valueOf={lightOf("duration.quick")} />);
    const editor = await open(/^Quick,/);
    const field = within(editor).getByLabelText("Light");

    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.change(field, { target: { value: "350" } });
    expect(heard).toEqual(["draw 3ms", "draw 350ms"]);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(heard).toEqual(["draw 3ms", "draw 350ms", "end", "write 350ms"]);
  });
});
