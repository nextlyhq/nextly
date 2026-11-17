// @vitest-environment jsdom

/**
 * A background's position: the nine points, read from CSS's own default for
 * a background (its top left, not the middle an image's object position
 * starts at), and Custom for any other value. Its size: Cover, Fit and Tile,
 * each writing the size and the repeat in one edit.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackgroundPositionField,
  BackgroundSizeField,
} from "./background-fields";
import { FieldPathWrites } from "./field-path-writes";
import { FocalFrame } from "./focal-frame";
import { InheritedValue } from "./inherited-value";
import type { CommitOutcome } from "./style-field-surroundings";
import type { PathWrite } from "./style-field-target";

afterEach(cleanup);

function renderPosition(stored?: string) {
  render(
    <>
      <span id="label">Position</span>
      <BackgroundPositionField
        id="bg-position"
        labelledBy="label"
        stored={stored}
        actionName="Position"
        describedBy={undefined}
        onCommit={() => "applied"}
      />
    </>
  );
}

describe("a background's position", () => {
  it("reads the top left, where CSS places a background, when nothing is set", () => {
    renderPosition();
    expect(
      screen.getByText("Top left by default", { selector: "b" })
    ).toBeDefined();
    // The one tab stop is that point.
    expect(screen.getByRole("radio", { name: "Top left" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Center" }).tabIndex).toBe(-1);
  });

  it("reads a value the nine points can't make as Custom", () => {
    renderPosition("30% 70%");
    expect(
      screen.getByText("Custom: 30% 70%", { selector: "b" })
    ).toBeDefined();
  });

  it("previews no picture, whatever image frame surrounds it", () => {
    // An Image block's own picture is no background's.
    render(
      <FocalFrame.Provider value={{ picture: "/photo.jpg", fit: "cover" }}>
        <span id="label">Position</span>
        <BackgroundPositionField
          id="bg-position"
          labelledBy="label"
          stored={undefined}
          actionName="Position"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </FocalFrame.Provider>
    );
    expect(document.querySelector("img")).toBeNull();
  });
});

function renderSize(
  options: {
    stored?: string;
    inherited?: string;
    paths?: ((writes: readonly PathWrite[]) => CommitOutcome) | null;
  } = {}
) {
  const commitPaths =
    options.paths === null
      ? undefined
      : (options.paths ?? vi.fn((): CommitOutcome => "applied"));
  const onCommit = vi.fn((): CommitOutcome => "applied");
  render(
    <FieldPathWrites.Provider value={commitPaths}>
      <InheritedValue.Provider value={options.inherited}>
        <span id="size-label">Size</span>
        <BackgroundSizeField
          id="bg-size"
          labelledBy="size-label"
          control={{ path: ["size"] }}
          stored={options.stored}
          actionName="Background size"
          describedBy={undefined}
          onCommit={onCommit}
        />
      </InheritedValue.Provider>
    </FieldPathWrites.Provider>
  );
  return { commitPaths, onCommit };
}

describe("a background's size", () => {
  it("writes contain AND no-repeat for Fit, in one edit", () => {
    // Without the repeat, `contain` tiles the image: CSS repeats a
    // background by default. One call is one entry in the history.
    const { commitPaths, onCommit } = renderSize();
    fireEvent.click(screen.getByRole("radio", { name: "Fit" }));
    expect(commitPaths).toHaveBeenCalledTimes(1);
    expect(commitPaths).toHaveBeenCalledWith([
      { path: ["size"], value: "contain" },
      { path: ["repeat"], value: "no-repeat" },
    ]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("writes the repeat beside the size, wherever the size sits", () => {
    const commitPaths = vi.fn((): CommitOutcome => "applied");
    render(
      <FieldPathWrites.Provider value={commitPaths}>
        <span id="size-label">Size</span>
        <BackgroundSizeField
          id="bg-size"
          labelledBy="size-label"
          control={{ path: ["layer", "size"] }}
          stored={undefined}
          actionName="Background size"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </FieldPathWrites.Provider>
    );
    fireEvent.click(screen.getByRole("radio", { name: "Tile" }));
    expect(commitPaths).toHaveBeenCalledWith([
      { path: ["layer", "size"], value: "auto" },
      { path: ["layer", "repeat"], value: "repeat" },
    ]);
  });

  it("shows the stored choice pressed, and pressing it again writes nothing", () => {
    const { commitPaths, onCommit } = renderSize({ stored: "cover" });
    const cover = screen.getByRole("radio", { name: "Cover" });
    expect(cover.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Fit" }).getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.getByText("Cover", { selector: "b" })).toBeDefined();
    fireEvent.click(cover);
    expect(commitPaths).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reads any other size as Custom, with no choice pressed", () => {
    renderSize({ stored: "50% auto" });
    expect(
      screen.getByText("Custom: 50% auto", { selector: "b" })
    ).toBeDefined();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("marks an inherited choice without pressing it", () => {
    renderSize({ inherited: "contain" });
    const fit = screen.getByRole("radio", { name: "Fit, inherited" });
    expect(fit.getAttribute("aria-checked")).toBe("false");
    expect(fit.tabIndex).toBe(0);
    expect(screen.getByText("Fit, inherited", { selector: "b" })).toBeDefined();
  });

  it("chooses as the arrows move, as a radio group does", () => {
    const { commitPaths } = renderSize({ stored: "cover" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Cover" }), {
      key: "ArrowRight",
    });
    expect(commitPaths).toHaveBeenCalledWith([
      { path: ["size"], value: "contain" },
      { path: ["repeat"], value: "no-repeat" },
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Fit" })
    );
  });

  it("writes the size alone where no field gives it a path write", () => {
    const { onCommit } = renderSize({ paths: null });
    fireEvent.click(screen.getByRole("radio", { name: "Cover" }));
    expect(onCommit).toHaveBeenCalledWith("cover");
  });

  it("writes any other size as CSS from its ... field", () => {
    const { onCommit } = renderSize();
    fireEvent.click(
      screen.getByRole("button", { name: "Background size as CSS" })
    );
    const input = screen.getByRole("textbox", {
      name: "Background size as CSS",
    });
    fireEvent.change(input, { target: { value: "50% auto" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("50% auto");
  });
});
