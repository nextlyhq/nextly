/**
 * The shared preview card: real admin primitives under a theme's inline
 * tokens. What matters is that each mode panel carries THAT mode's values --
 * a card that rendered light twice would look plausible and compare nothing.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemePreviewCard, themeVars } from "../ThemePreviewCard";
import { NEXTLY_THEMES } from "../themes";

const mono = NEXTLY_THEMES[0];

// Explicit, because the suite runs with `globals: false`: testing-library
// only registers its own afterEach cleanup when the globals are installed,
// so without this every render stacks into the same document and queries
// that should match once start matching several times.
afterEach(cleanup);

describe("themeVars", () => {
  it("prefixes every token and carries the shell knobs", () => {
    const vars = themeVars(mono, "light");
    expect(vars["--nx-background"]).toBe(mono.light.background);
    expect(vars["--radius"]).toBe(mono.radius);
    expect(vars["--font-sans"]).toBe(mono.fontSans);
  });

  it("reads the requested mode, not always light", () => {
    expect(themeVars(mono, "dark")["--nx-background"]).toBe(
      mono.dark.background
    );
  });
});

describe("ThemePreviewCard", () => {
  it("renders both mode panels with that mode's tokens inline", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={() => {}}
        applied={false}
      />
    );
    const panels = screen.getAllByTestId("mode-panel");
    expect(panels).toHaveLength(2);
    expect(panels[0].style.getPropertyValue("--nx-background")).toBe(
      mono.light.background
    );
    expect(panels[1].style.getPropertyValue("--nx-background")).toBe(
      mono.dark.background
    );
  });

  it("renders a single panel in the requested mode when one is pinned", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="panel"
        mode="dark"
        onApply={() => {}}
        applied={false}
      />
    );
    const panels = screen.getAllByTestId("mode-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0].style.getPropertyValue("--nx-background")).toBe(
      mono.dark.background
    );
  });

  it("applies on click with the theme id", () => {
    const onApply = vi.fn();
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={onApply}
        applied={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith("mono");
  });

  it("shows the applied state instead of an apply button", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        onApply={() => {}}
        applied
      />
    );
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    // Plain matcher rather than jest-dom's toBeInTheDocument: this suite has
    // no jest-dom setup, and getByText already throws when nothing matches.
    expect(screen.getByText(/active/i)).not.toBeNull();
  });
});
