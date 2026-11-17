// @vitest-environment jsdom

/**
 * The shadow control: a layer's fields each write the stored CSS, layers are
 * added, moved and removed, a preview shows the result in light and dark,
 * and "Edit as CSS" reads typed CSS back into the fields, or keeps it as CSS
 * where it cannot.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { CssNamesContext } from "./css-names-context";
import { ShadowControl } from "./shadow-control";

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111111", dark: "#eeeeee" },
    },
    {
      name: "color.background",
      kind: "color",
      values: { light: "#ffffff", dark: "#000000" },
    },
  ],
};

const ONE = "0 4px 12px rgba(0, 0, 0, 0.2)";

/** The control over a value it keeps, as a host does, with every write seen. */
function Host({
  initial,
  onWrite = () => {},
  readOnly = false,
}: {
  initial: string;
  onWrite?: (css: string) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  return (
    <ShadowControl
      label="Shadow"
      value={value}
      tokens={TOKENS}
      readOnly={readOnly}
      writesOf={css => `--site-shadow-card: ${css}`}
      names={["--site-shadow-card"]}
      onCommit={css => {
        onWrite(css);
        setValue(css);
      }}
    />
  );
}

/** Types into a field and leaves it. */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

function layer(n: number): HTMLElement {
  return screen.getByRole("group", { name: `Layer ${n}` });
}

describe("a layer's fields", () => {
  it.each([
    ["X offset", "2", "2px 4px 12px rgba(0, 0, 0, 0.2)"],
    ["Y offset", "-3", "0 -3px 12px rgba(0, 0, 0, 0.2)"],
    ["Blur", "20", "0 4px 20px rgba(0, 0, 0, 0.2)"],
    ["Spread", "1", "0 4px 12px 1px rgba(0, 0, 0, 0.2)"],
  ])("%s writes the stored shadow", (label, typed, written) => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    enter(within(layer(1)).getByLabelText(label), typed);
    expect(onWrite).toHaveBeenLastCalledWith(written);
  });

  it("Colour writes the colour typed", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    const colour = within(layer(1)).getByLabelText("Colour");
    fireEvent.change(colour, { target: { value: "#ff0000" } });
    fireEvent.keyDown(colour, { key: "Enter" });
    expect(onWrite).toHaveBeenLastCalledWith("0 4px 12px #ff0000");
  });

  it("Inside draws the layer inside the box", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(within(layer(1)).getByRole("switch", { name: "Inside" }));
    expect(onWrite).toHaveBeenLastCalledWith(`inset ${ONE}`);
  });

  it("shows an unset blur and spread as 0, which is what CSS draws", () => {
    render(<Host initial="2px 2px" />);
    for (const label of ["Blur", "Spread"]) {
      expect(
        (within(layer(1)).getByLabelText(label) as HTMLInputElement).placeholder
      ).toBe("0");
    }
  });

  it("refuses a negative blur where it is typed, saying why", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    enter(within(layer(1)).getByLabelText("Blur"), "-4");
    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("negative blur");
  });
});

describe("layers", () => {
  it("adds a layer, moves it and removes one", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(onWrite).toHaveBeenLastCalledWith(
      `${ONE}, 0 4px 12px rgba(0, 0, 0, 0.12)`
    );
    fireEvent.click(screen.getByRole("button", { name: "Move layer 2 up" }));
    expect(onWrite).toHaveBeenLastCalledWith(
      `0 4px 12px rgba(0, 0, 0, 0.12), ${ONE}`
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove layer 1" }));
    expect(onWrite).toHaveBeenLastCalledWith(ONE);
  });

  it("writes no shadow once the last layer is removed", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove layer 1" }));
    expect(onWrite).toHaveBeenLastCalledWith("none");
  });

  it("offers no change where the shadow is read-only", () => {
    render(<Host initial={ONE} readOnly />);
    expect(screen.queryByRole("button", { name: "+ Add layer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit as CSS" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove layer/ })).toBeNull();
  });
});

describe("the preview", () => {
  function cards(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".nx-shadow__card")];
  }

  it("shows the shadow in light alone where nothing in it changes for dark", () => {
    render(<Host initial={ONE} />);
    expect(cards().map(card => card.dataset.mode)).toEqual(["light"]);
    expect(cards()[0]?.style.boxShadow).toContain("12px");
  });

  it("shows it in dark too, in the dark value of a colour variable it uses", () => {
    render(<Host initial="0 2px 4px var(--site-color-text)" />);
    expect(cards().map(card => card.dataset.mode)).toEqual(["light", "dark"]);
    expect(cards()[0]?.style.boxShadow).toBe("0 2px 4px #111111");
    expect(cards()[1]?.style.boxShadow).toBe("0 2px 4px #eeeeee");
  });
});

describe("Edit as CSS", () => {
  it("reads typed CSS back into the fields", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit as CSS" }));
    const typed = "inset 0 1px 0 rgba(255,255,255,.2), 0 2px 4px #0003";
    enter(screen.getByRole("textbox", { name: "Shadow as CSS" }), typed);
    expect(onWrite).toHaveBeenLastCalledWith(typed);
    expect(
      within(layer(1))
        .getByRole("switch", { name: "Inside" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(layer(2)).toBeDefined();
  });

  it("keeps CSS it can't show as fields as typed, and says so", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit as CSS" }));
    const typed = "calc(1px + 1px) 2px 4px #000";
    enter(screen.getByRole("textbox", { name: "Shadow as CSS" }), typed);
    expect(onWrite).toHaveBeenLastCalledWith(typed);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Shadow as CSS",
        }) as HTMLTextAreaElement
      ).value
    ).toBe(typed);
    expect(
      screen.getByText("Shown as CSS because it can't be shown as fields")
    ).toBeDefined();
    expect(screen.queryByRole("group", { name: "Layer 1" })).toBeNull();
  });

  it("opens a stored shadow it can't show as fields as CSS", () => {
    render(<Host initial="var(--elsewhere)" />);
    expect(
      screen.getByText("Shown as CSS because it can't be shown as fields")
    ).toBeDefined();
  });

  it("still checks CSS it keeps, and writes nothing it refuses", () => {
    const onWrite = vi.fn();
    render(<Host initial={ONE} onWrite={onWrite} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit as CSS" }));
    const field = screen.getByRole("textbox", { name: "Shadow as CSS" });
    enter(field, "0 4px 12pxred");
    expect(onWrite).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      '"12pxred", which is not a size or a colour'
    );
  });
});

describe("what it writes", () => {
  it("shows the CSS a field writes on hover", async () => {
    render(<Host initial={ONE} />);
    fireEvent.pointerMove(within(layer(1)).getByLabelText("Blur"));
    const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
    expect(tip.textContent).toContain(`--site-shadow-card: ${ONE}`);
  });

  it("prints the CSS name inline while Show CSS names is on", () => {
    render(
      <CssNamesContext.Provider value={{ shown: true, set: () => {} }}>
        <Host initial={ONE} />
      </CssNamesContext.Provider>
    );
    expect(document.querySelector(".nx-css-names")?.textContent).toBe(
      "--site-shadow-card"
    );
  });
});
