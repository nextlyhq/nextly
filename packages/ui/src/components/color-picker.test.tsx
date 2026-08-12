// @vitest-environment jsdom
/**
 * The contract worth guarding is that a swatch's `value` comes back UNTOUCHED.
 *
 * A host stores design tokens by attaching its own reference to a swatch. If
 * this component resolved that swatch to the colour it currently happens to be
 * — the obvious implementation, and the one a `value: string` API would force —
 * the stored value would be a literal, re-theming would stop moving it, and
 * nothing would report the loss. The colour and the meaning are different
 * things, and only the host knows the second.
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./color-picker";

afterEach(cleanup);

describe("choosing a preset", () => {
  it("hands back the swatch's own value, not a colour", () => {
    const onSwatchSelect = vi.fn();
    const token = { $token: "color.primary" };

    render(
      <ColorPicker
        color="#000000"
        onColorChange={vi.fn()}
        swatches={[
          { id: "primary", label: "Primary", color: "#3b82f6", value: token },
        ]}
        onSwatchSelect={onSwatchSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));

    expect(onSwatchSelect).toHaveBeenCalledTimes(1);
    const received = onSwatchSelect.mock.calls[0]?.[0] as { value: unknown };
    // Identity, not equality: a component that reconstructed the value would
    // pass a deep comparison while having replaced the host's object.
    expect(received.value).toBe(token);
  });

  it("does not report a preset as an ordinary colour edit", () => {
    // The separating case. Collapsing the two events is exactly how a token
    // becomes a literal — the host would store whatever hex the swatch painted.
    const onColorChange = vi.fn();

    render(
      <ColorPicker
        color="#000000"
        onColorChange={onColorChange}
        swatches={[{ id: "p", label: "Primary", color: "#3b82f6" }]}
        onSwatchSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));

    expect(onColorChange).not.toHaveBeenCalled();
  });
});

describe("the hex field", () => {
  it("publishes a colour once it is one", () => {
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    fireEvent.change(screen.getByLabelText("Hex colour"), {
      target: { value: "#3b82f6" },
    });

    expect(onColorChange).toHaveBeenCalledWith("#3b82f6");
  });

  it("stays quiet while a value is still being typed", () => {
    // `#ab` is the ordinary state of a field someone is typing into. Reporting
    // it as a colour repaints the surface under them.
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    fireEvent.change(screen.getByLabelText("Hex colour"), {
      target: { value: "#ab" },
    });

    expect(onColorChange).not.toHaveBeenCalled();
    // And the half-typed text survives, rather than being reformatted away.
    expect(
      (screen.getByLabelText("Hex colour") as HTMLInputElement).value
    ).toBe("#ab");
  });
});

describe("the eyedropper", () => {
  it("is absent where the browser cannot sample the screen", () => {
    // Chromium-only. Constructing it elsewhere throws, so a button that is
    // always rendered is a button that fails for Firefox and Safari users.
    expect("EyeDropper" in window).toBe(false);
    render(<ColorPicker color="#000000" onColorChange={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Pick a colour from the screen" })
    ).toBeNull();
  });

  it("appears where it is supported", () => {
    // The positive control: without it, a picker that never renders the button
    // satisfies the assertion above.
    const w = window as unknown as Record<string, unknown>;
    w.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#123456" });
      }
    };
    try {
      render(<ColorPicker color="#000000" onColorChange={vi.fn()} />);
      expect(
        screen.getByRole("button", { name: "Pick a colour from the screen" })
      ).toBeTruthy();
    } finally {
      delete w.EyeDropper;
    }
  });
});

describe("recent colours", () => {
  it("renders what the host supplies and owns none itself", () => {
    const onColorChange = vi.fn();
    render(
      <ColorPicker
        color="#000000"
        onColorChange={onColorChange}
        recentColors={["#ff0000"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "#ff0000" }));
    expect(onColorChange).toHaveBeenCalledWith("#ff0000");
  });
});
