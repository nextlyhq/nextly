// @vitest-environment jsdom
/**
 * The picker reads a colour typed or pasted in any of the three notations,
 * shows it in whichever the author picks without moving it, offers the
 * screen's eyedropper only where the browser has one, and lists the host's
 * recent colours under their own heading.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./color-picker";

afterEach(cleanup);

/** The picker as a host wires it: the colour is held outside it. */
function Held({
  initial,
  onColorChange,
}: {
  initial: string;
  onColorChange: (color: string) => void;
}) {
  const [color, setColor] = React.useState(initial);
  return (
    <>
      <ColorPicker
        color={color}
        showAlpha
        onColorChange={next => {
          setColor(next);
          onColorChange(next);
        }}
      />
      <output data-testid="stored">{color}</output>
    </>
  );
}

const field = (name: string): HTMLInputElement =>
  screen.getByLabelText(`${name} colour`) as HTMLInputElement;

const format = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("a colour typed or pasted in any notation", () => {
  it.each([
    ["rgb(255, 0, 0)", "#ff0000"],
    ["hsl(120 100% 25%)", "#008000"],
    ["#0af", "#00aaff"],
    ["rgba(255 0 0 / 50%)", "#ff000080"],
    ["hsla(120, 100%, 25%, 0.5)", "#00800080"],
  ])("accepts %s", (typed, stored) => {
    const onColorChange = vi.fn();
    render(<Held initial="#000000" onColorChange={onColorChange} />);

    fireEvent.change(field("Hex"), { target: { value: typed } });
    fireEvent.keyDown(field("Hex"), { key: "Enter" });

    expect(onColorChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("stored").textContent).toBe(stored);
  });

  it("reads every notation whichever one the field is showing", () => {
    const onColorChange = vi.fn();
    render(<Held initial="#000000" onColorChange={onColorChange} />);

    fireEvent.click(format("HSL"));
    fireEvent.change(field("HSL"), { target: { value: "#ff0000" } });
    fireEvent.blur(field("HSL"));

    expect(screen.getByTestId("stored").textContent).toBe("#ff0000");
    expect(field("HSL").value).toBe("hsl(0 100% 50%)");
  });
});

describe("switching the field between Hex, RGB and HSL", () => {
  it("shows the same colour in each and never changes what is stored", () => {
    const onColorChange = vi.fn();
    render(<Held initial="#3b82f680" onColorChange={onColorChange} />);
    expect(field("Hex").value).toBe("#3b82f680");
    expect(format("Hex").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(format("RGB"));
    expect(field("RGB").value).toBe("rgb(59 130 246 / 0.5)");
    expect(format("RGB").getAttribute("aria-pressed")).toBe("true");
    expect(format("Hex").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(format("HSL"));
    expect(field("HSL").value).toBe("hsl(217 91% 60% / 0.5)");

    fireEvent.click(format("Hex"));
    expect(field("Hex").value).toBe("#3b82f680");

    expect(onColorChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("stored").textContent).toBe("#3b82f680");
  });

  it("finishes a colour still being typed before showing the new notation", () => {
    const onColorChange = vi.fn();
    render(<Held initial="#000000" onColorChange={onColorChange} />);

    fireEvent.change(field("Hex"), { target: { value: "rgb(0 0 255)" } });
    fireEvent.click(format("RGB"));

    expect(onColorChange).toHaveBeenCalledWith("#0000ff");
    expect(field("RGB").value).toBe("rgb(0 0 255)");
  });

  it("reports nothing when the text shown is finished again unchanged", () => {
    // HSL shows whole numbers, so reading its own text back would move the
    // colour by a rounding: an edit nobody made.
    const onColorChange = vi.fn();
    render(<Held initial="#3b82f6" onColorChange={onColorChange} />);
    fireEvent.click(format("HSL"));
    const shown = field("HSL").value;

    fireEvent.change(field("HSL"), { target: { value: `${shown} ` } });
    fireEvent.keyDown(field("HSL"), { key: "Enter" });

    expect(onColorChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("stored").textContent).toBe("#3b82f6");
  });

  it("drops an unfinished colour rather than reporting it", () => {
    const onColorChange = vi.fn();
    render(<Held initial="#112233" onColorChange={onColorChange} />);

    fireEvent.change(field("Hex"), { target: { value: "rgb(0 0" } });
    fireEvent.click(format("HSL"));

    expect(onColorChange).not.toHaveBeenCalled();
    expect(field("HSL").value).toBe("hsl(210 50% 13%)");
  });
});

describe("Pick from screen", () => {
  it("shows where the browser has an eyedropper", async () => {
    const w = window as unknown as Record<string, unknown>;
    w.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#123456" });
      }
    };
    try {
      const onColorChange = vi.fn();
      render(<ColorPicker color="#000000" onColorChange={onColorChange} />);
      const button = screen.getByRole("button", { name: "Pick from screen" });
      expect(button.getAttribute("title")).toBe("Pick from screen");

      fireEvent.click(button);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(onColorChange).toHaveBeenCalledWith("#123456");
    } finally {
      delete w.EyeDropper;
    }
  });

  it("shows no button and no hint about one where it has none", () => {
    expect("EyeDropper" in window).toBe(false);
    const { container } = render(
      <ColorPicker color="#000000" onColorChange={vi.fn()} />
    );

    expect(screen.queryByRole("button", { name: /screen/i })).toBeNull();
    expect(container.innerHTML).not.toMatch(/screen|eyedropper/i);
  });
});

describe("Recent colours", () => {
  it("shows the row while the host's list is empty, saying what will appear", () => {
    render(
      <ColorPicker color="#000000" onColorChange={vi.fn()} recentColors={[]} />
    );
    const row = screen.getByRole("group", { name: "Recent colours" });
    expect(row.textContent).toContain("Colours you type or pick show here.");
  });

  it("shows no row where the host keeps no recent colours", () => {
    render(<ColorPicker color="#000000" onColorChange={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Recent colours" })).toBeNull();
  });

  it("lists the host's colours under their own heading", () => {
    render(
      <ColorPicker
        color="#000000"
        onColorChange={vi.fn()}
        recentColors={["#ff0000", "hsl(120 100% 25%)"]}
      />
    );

    const row = screen.getByRole("group", { name: "Recent colours" });
    expect(within(row).getByRole("button", { name: "#ff0000" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "hsl(120 100% 25%)" })
    ).toBeTruthy();
  });

  it("reads a recent colour in any notation when the host leaves it to the picker", () => {
    const onColorChange = vi.fn();
    render(
      <ColorPicker
        color="#000000"
        onColorChange={onColorChange}
        recentColors={["hsl(120 100% 25%)"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "hsl(120 100% 25%)" }));
    expect(onColorChange).toHaveBeenCalledWith("#008000");
  });

  it("hands a recent colour back as listed to a host that stores it", () => {
    const onColorChange = vi.fn();
    const onRecentSelect = vi.fn();
    render(
      <ColorPicker
        color="#000000"
        onColorChange={onColorChange}
        recentColors={["hsl(120 100% 25%)"]}
        onRecentSelect={onRecentSelect}
      />
    );

    fireEvent.change(field("Hex"), { target: { value: "#abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "hsl(120 100% 25%)" }));
    fireEvent.blur(field("Hex"));

    expect(onRecentSelect).toHaveBeenCalledWith("hsl(120 100% 25%)");
    // The typed colour it replaced is not reported after it.
    expect(onColorChange).not.toHaveBeenCalled();
  });
});
