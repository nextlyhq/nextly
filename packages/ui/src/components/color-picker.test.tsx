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
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./color-picker";

afterEach(cleanup);

/**
 * The picker as a host actually wires it: `color` is owned outside and moves
 * when the picker reports a change.
 *
 * Necessary for any test spanning two interactions. Left uncontrolled, the
 * prop-sync effect restores the original colour after each one, so a second
 * step starts from the first colour rather than the one just chosen — and an
 * assertion about carried-over state then measures the snap-back instead.
 */
function Controlled({
  initial,
  onColorChange,
  recentColors,
}: {
  initial: string;
  onColorChange: (color: string) => void;
  recentColors?: string[];
}) {
  const [color, setColor] = React.useState(initial);
  return (
    <ColorPicker
      color={color}
      recentColors={recentColors}
      onColorChange={next => {
        setColor(next);
        onColorChange(next);
      }}
    />
  );
}

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
  it("publishes a colour once it is one AND finished", () => {
    /*
     * The finish is the addition, and the reason is in the case below it: a
     * prefix of a valid colour is itself a valid colour, so publishing per
     * keystroke let an intermediate stand as the stored value whenever the
     * author stopped early.
     */
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    const field = screen.getByLabelText("Hex colour");
    fireEvent.change(field, { target: { value: "#3b82f6" } });
    fireEvent.blur(field);

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

  it("is absent from the server's markup even where it is supported", () => {
    // The hydration property, and it needs a real server render to state: the
    // browser's capability is unknowable while rendering on the server, so a
    // support check read during render makes the server omit the button and the
    // first client render add it. React 19 answers that mismatch by discarding
    // and rebuilding the picker subtree. Support is resolved after mount
    // instead, which makes both first renders identical.
    const w = window as unknown as Record<string, unknown>;
    w.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#123456" });
      }
    };
    try {
      const markup = renderToString(
        <ColorPicker color="#000000" onColorChange={vi.fn()} />
      );
      expect(markup).not.toContain("Pick a colour from the screen");
      // The control: this render really did produce a picker, so the assertion
      // above is not passing on empty output.
      expect(markup).toContain("Saturation and brightness");
    } finally {
      delete w.EyeDropper;
    }
  });

  it("does not disguise a failing host callback as a dismissal", async () => {
    // The dismissal catch used to wrap the commit as well, so a host whose
    // `onColorChange` throws — a rejected save, a failed validation — was
    // swallowed as "the user closed the picker" while the picker had already
    // moved. The failure has to reach the host, as it does on every other path.
    const w = window as unknown as Record<string, unknown>;
    w.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#123456" });
      }
    };
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(
        <ColorPicker
          color="#000000"
          onColorChange={() => {
            throw new Error("host rejected the colour");
          }}
        />
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Pick a colour from the screen" })
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", capture);
      delete w.EyeDropper;
    }

    expect(escaped.map(String)).toEqual(["Error: host rejected the colour"]);
  });

  it("stays quiet when the user dismisses it", async () => {
    // The other half, and the reason the catch exists at all: a dismissal is
    // an ordinary outcome, so `open()` rejecting must report nothing. Without
    // this, narrowing the catch to nothing at all would satisfy the test above.
    const w = window as unknown as Record<string, unknown>;
    w.EyeDropper = class {
      open() {
        return Promise.reject(new Error("AbortError"));
      }
    };
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    const onColorChange = vi.fn();
    try {
      render(<ColorPicker color="#000000" onColorChange={onColorChange} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Pick a colour from the screen" })
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", capture);
      delete w.EyeDropper;
    }

    expect(escaped).toEqual([]);
    expect(onColorChange).not.toHaveBeenCalled();
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

describe("the saturation surface", () => {
  const surface = () =>
    screen.getByRole("application", { name: /Saturation and brightness/ });

  it("is reachable and adjustable from the keyboard", () => {
    // Without this the two-dimensional half of the control is available only to
    // a pointer, and the hex field is the sole way in for anyone else.
    const onColorChange = vi.fn();
    render(<Controlled initial="#ff0000" onColorChange={onColorChange} />);

    expect(surface().getAttribute("tabindex")).toBe("0");

    // Horizontal moves saturation, vertical moves brightness, and the second
    // press builds on the first rather than restarting from the prop.
    fireEvent.keyDown(surface(), { key: "ArrowLeft" });
    expect(onColorChange).toHaveBeenLastCalledWith("#ff0303");

    fireEvent.keyDown(surface(), { key: "ArrowDown" });
    expect(onColorChange).toHaveBeenLastCalledWith("#fc0303");
  });

  it("names the values it currently holds", () => {
    // `role="application"` exposes no value of its own, so a surface that can be
    // driven but never says where it is leaves a screen-reader user adjusting
    // blind.
    render(<ColorPicker color="#ff0000" onColorChange={vi.fn()} />);

    expect(surface().getAttribute("aria-label")).toContain("100% saturation");
    expect(surface().getAttribute("aria-label")).toContain("100% brightness");
  });
});

describe("hue survives a colour that has none", () => {
  // Grey and black carry no hue, so the conversion reports 0. Storing it turns
  // a blue into a red the moment saturation comes back up. Each entry point is
  // asserted separately: this was fixed once per path, and a fix wired into
  // some of them leaves the rest silently broken.
  const raiseSaturation = () =>
    fireEvent.keyDown(
      screen.getByRole("application", { name: /Saturation and brightness/ }),
      { key: "ArrowRight" }
    );

  it("through the hex field", () => {
    const onColorChange = vi.fn();
    render(<Controlled initial="#0000ff" onColorChange={onColorChange} />);

    const field = screen.getByLabelText("Hex colour");
    fireEvent.change(field, { target: { value: "#000000" } });
    // FINISHED, because a typed colour is reported when the author finishes it
    // and this case needs the surface actually moved to black before it arrows.
    fireEvent.blur(field);
    // Black is unlit AS WELL as colourless, so brightness and saturation both
    // have to come back up before any hue is observable at all. A single step
    // on one axis lands on `#030303`, which is grey whichever hue is stored —
    // an assertion there would pass with the fix reverted.
    const surface = screen.getByRole("application", {
      name: /Saturation and brightness/,
    });
    fireEvent.keyDown(surface, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });

    // Blue. Red — `#191717` — is what dropping the hue produces.
    expect(onColorChange).toHaveBeenLastCalledWith("#171719");
  });

  it("through a recent colour", () => {
    const onColorChange = vi.fn();
    render(
      <Controlled
        initial="#0000ff"
        onColorChange={onColorChange}
        recentColors={["#808080"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "#808080" }));
    raiseSaturation();

    expect(onColorChange).toHaveBeenLastCalledWith("#7f7f80");
  });

  it("through a colour the host pushes in", () => {
    const onColorChange = vi.fn();
    const { rerender } = render(
      <ColorPicker color="#0000ff" onColorChange={onColorChange} />
    );

    rerender(<ColorPicker color="#808080" onColorChange={onColorChange} />);
    raiseSaturation();

    expect(onColorChange).toHaveBeenLastCalledWith("#7f7f80");
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

describe("a colour typed one character at a time", () => {
  const hexField = () => screen.getByLabelText("Hex colour");

  it("reports NOTHING until the author finishes it", () => {
    /*
     * The defect this closes, in the sequence it was measured in. `parseHex`
     * accepts 3, 4, 6 and 8 digits, so a PREFIX of a valid colour is itself a
     * valid colour: `#123456` passes through `#123` and `#1234` on the way.
     * Publishing each of those made the last one stick whenever the author
     * paused — `#12345` left the host holding `#11223344`, a colour nobody
     * typed, silently replacing the stored one.
     *
     * Asserted on the CALL COUNT as well as the value, because a version that
     * published the right final colour after publishing two wrong ones would
     * satisfy a value-only assertion while the defect was still live: the harm
     * is what a host commits when the author stops early.
     */
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    for (const text of ["#1", "#12", "#123", "#1234", "#12345"]) {
      fireEvent.change(hexField(), { target: { value: text } });
    }

    expect(onColorChange).not.toHaveBeenCalled();
  });

  it("reports the colour once ENTER finishes it", () => {
    // The control. Without it the case above passes on a picker that never
    // reports anything at all.
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    fireEvent.change(hexField(), { target: { value: "#123456" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });

    expect(onColorChange).toHaveBeenCalledTimes(1);
    expect(onColorChange.mock.calls[0]?.[0]?.toLowerCase()).toBe("#123456");
  });

  it("reports it on leaving the field", () => {
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    fireEvent.change(hexField(), { target: { value: "#123456" } });
    fireEvent.blur(hexField());

    expect(onColorChange).toHaveBeenCalledTimes(1);
    expect(onColorChange.mock.calls[0]?.[0]?.toLowerCase()).toBe("#123456");
  });

  it("reports NOTHING when focus merely passes through the field", () => {
    /*
     * Tabbing into the hex field and out again is not an edit. Reading the
     * field's VALUE on blur rather than the draft would report the colour
     * already on screen every time, so an untouched control looks edited and a
     * host that persists each callback writes for nothing.
     */
    const onColorChange = vi.fn();
    render(<ColorPicker color="#3b82f6" onColorChange={onColorChange} />);

    fireEvent.focus(hexField());
    fireEvent.blur(hexField());

    expect(onColorChange).not.toHaveBeenCalled();
  });

  it("reports a finished colour ONCE, not again on the way out", () => {
    // Enter finishes it; the blur that follows has no draft left to report, so
    // a host persisting each callback does not see the same edit twice.
    const onColorChange = vi.fn();
    render(<ColorPicker color="#000000" onColorChange={onColorChange} />);

    fireEvent.change(hexField(), { target: { value: "#123456" } });
    fireEvent.keyDown(hexField(), { key: "Enter" });
    fireEvent.blur(hexField());

    expect(onColorChange).toHaveBeenCalledTimes(1);
  });

  it("reports NOTHING when the picker GOES AWAY mid-draft", () => {
    /*
     * Dismissal is not a finish. Escape means cancel, so a draft dying with the
     * surface is the conventional answer; and clicking away moves focus out of
     * the field first, so that path commits through the blur instead.
     *
     * Reporting from an unmount was tried and removed: a host that coalesces a
     * picker gesture on close has already decided what to write by then, so the
     * value is published into nothing — `style-colour-panel` writes once on
     * close and saw zero.
     *
     * A COMPLETE colour is used deliberately. The unfinished case below would
     * pass on a picker that simply never reported, so this one carries the
     * discrimination: the value was reportable and was still not reported.
     */
    const onColorChange = vi.fn();
    const view = render(
      <ColorPicker color="#000000" onColorChange={onColorChange} />
    );

    fireEvent.change(hexField(), { target: { value: "#123456" } });
    view.unmount();

    expect(onColorChange).not.toHaveBeenCalled();
  });

  it("reports NOTHING when an unfinished colour goes away", () => {
    // The measured case end to end: stop at five digits, dismiss, and the host
    // must still hold what it held.
    const onColorChange = vi.fn();
    const view = render(
      <ColorPicker color="#000000" onColorChange={onColorChange} />
    );

    fireEvent.change(hexField(), { target: { value: "#12345" } });
    view.unmount();

    expect(onColorChange).not.toHaveBeenCalled();
  });

  it("shows the STORED colour again after an unfinished draft is dropped", () => {
    // What is shown and what is saved have to agree once the draft is gone.
    // They did not before: the field kept the text while the host held a stale
    // intermediate.
    render(<ColorPicker color="#000000" onColorChange={vi.fn()} />);

    fireEvent.change(hexField(), { target: { value: "#12345" } });
    fireEvent.blur(hexField());

    expect((hexField() as HTMLInputElement).value.toLowerCase()).toBe(
      "#000000"
    );
  });
});
