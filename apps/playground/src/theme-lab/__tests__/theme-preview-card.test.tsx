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
import { SAND } from "../themes/sand";

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

  it("scopes its own chrome so the ui primitives in it are styled", () => {
    // The ui package's component rules are scoped beneath `.nextly-admin`, and
    // the card renders wherever the switcher floats -- outside the admin
    // subtree. Without the scope on the card itself, the header's Apply button
    // is a bare <button>: the one control in the panel that does something.
    // Marked as a preview at the same time, or the lab attributes the card as
    // a real admin root and stamps it with the selected theme.
    const { container } = render(
      <ThemePreviewCard
        theme={mono}
        size="panel"
        mode="light"
        onApply={() => {}}
        applied={false}
      />
    );
    const card = container.querySelector("section");
    expect(card?.classList.contains("nextly-admin")).toBe(true);
    expect(card?.hasAttribute("data-theme-preview")).toBe(true);
  });

  it("previews each theme at the density applying it would produce", () => {
    // A preview that shows the right colours at the wrong metrics is still
    // wrong: Sand and Calm recommend `comfortable`, so a panel without its own
    // `data-density` renders them at the base control height while Apply moves
    // the admin to a taller one. The panel is excluded from the lab's
    // attribution so it never inherits the SELECTED density -- which is what
    // leaves it with none unless it sets its own.
    for (const theme of [mono, SAND]) {
      cleanup();
      render(
        <ThemePreviewCard
          theme={theme}
          size="gallery"
          onApply={() => {}}
          applied={false}
        />
      );
      for (const panel of screen.getAllByTestId("mode-panel")) {
        expect(panel.getAttribute("data-density")).toBe(
          theme.recommendedDensity
        );
      }
    }

    // The two themes have to DIFFER here, or the assertion passes for any
    // theme that happens to share the default.
    expect(SAND.recommendedDensity).not.toBe(mono.recommendedDensity);
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

  it("shows a passing theme's score as AA and a failing one's count", () => {
    // The number is the whole point of showing it: a theme that misses AA
    // looks fine, so a badge reading only "AA" or nothing would let a preset
    // be chosen without its cost ever appearing.
    const { unmount } = render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        contrastFailures={0}
        onApply={() => {}}
        applied={false}
      />
    );
    expect(screen.getByTestId("contrast-score").textContent).toBe("AA");
    unmount();

    render(
      <ThemePreviewCard
        theme={mono}
        size="gallery"
        contrastFailures={14}
        onApply={() => {}}
        applied={false}
      />
    );
    expect(screen.getByTestId("contrast-score").textContent).toBe(
      "14 AA misses"
    );
  });

  it("omits the score badge when no measurement is supplied", () => {
    render(
      <ThemePreviewCard
        theme={mono}
        size="panel"
        onApply={() => {}}
        applied={false}
      />
    );
    expect(screen.queryByTestId("contrast-score")).toBeNull();
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
