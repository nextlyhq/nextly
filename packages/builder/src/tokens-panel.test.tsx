// @vitest-environment jsdom

/**
 * The tokens studio, driven as an author drives it.
 *
 * `tokens-studio.test.ts` asserts the rules against the engine's compilers and
 * establishes that a rename freezes the identity. What is only true HERE is the
 * wiring: that editing a name in the table calls the rule rather than spreading
 * a new name over the token, that a refused name is reported and NOT committed,
 * that removal asks first, and that the mode switch decides which value an edit
 * writes rather than only which one is shown.
 *
 * @module tokens-panel.test
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TokensPanel } from "./tokens-panel";

afterEach(cleanup);

beforeAll(() => {
  // Radix's tabs measure and scroll; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

/** A site whose second token is RENAMED, so identity and name differ. */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#3b82f6", dark: "#93c5fd" },
    },
  ],
};

/**
 * Mount over a token set.
 *
 * No default parameter, deliberately: a default cannot tell an omitted
 * argument from an explicit `undefined`, and `undefined` is the state under
 * test for the not-yet-read case. Measured on the sibling colour panel — a
 * default silently swallowed the sentinel and the test asserted against the
 * full fixture while claiming to assert against no table at all.
 */
function mount(tokens: SiteTokenSet | undefined) {
  const onChange = vi.fn();
  render(<TokensPanel tokens={tokens} onChange={onChange} />);
  return onChange;
}

const nameField = (label: string): HTMLElement =>
  screen.getByLabelText(`Name of ${label}`);
const valueField = (label: string): HTMLElement =>
  screen.getByLabelText(new RegExp(`^(Dark value|Value) of ${label}$`));

describe("what the studio draws", () => {
  it("lists the site's colour tokens under the colour tab", () => {
    mount(TOKENS);
    expect(nameField("color.ink")).toHaveProperty("value", "color.ink");
    expect(nameField("brand.main")).toHaveProperty("value", "brand.main");
  });

  it("shows the token's CURRENT name while the document keeps its identity", () => {
    mount(TOKENS);
    // The renamed token reads as its label. Showing `color.primary` here would
    // be showing the author a string they never typed.
    expect(nameField("brand.main")).toHaveProperty("value", "brand.main");
    expect(valueField("brand.main")).toHaveProperty("value", "#3b82f6");
  });

  it("says so rather than drawing an empty table while the read is out", () => {
    // A site with no tokens and a site whose tokens have not arrived are
    // different states, and adding a token into the second one would edit a
    // set about to be replaced.
    mount(undefined);
    expect(screen.getByText(/Reading this site/)).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("paints a swatch for a colour it can resolve, and nothing for one it cannot", () => {
    const unresolvable: SiteTokenSet = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#112233" } },
        { name: "color.ref", kind: "color", values: { light: "var(--x)" } },
      ],
    };
    const { container } = render(
      <TokensPanel tokens={unresolvable} onChange={vi.fn()} />
    );
    const swatches = Array.from(
      container.querySelectorAll(".nx-tokens__swatch")
    );
    expect(swatches[0]?.getAttribute("style")).toContain("#112233");
    // A `var()` resolves against the PANEL rather than the canvas, so painting
    // it would show a colour the page does not have.
    expect(swatches[1]?.getAttribute("data-empty")).toBe("");
  });
});

describe("renaming from the table", () => {
  it("commits on blur, through the rule that freezes the identity", () => {
    const onChange = mount(TOKENS);
    const field = nameField("color.ink");
    fireEvent.change(field, { target: { value: "text.body" } });
    // Not yet: an edit per keystroke would recompile the canvas for every
    // letter and validate a half-typed name.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    const token = next.tokens.find(t => t.name === "text.body");
    // The whole point: the label moved and the identity did not.
    expect(token?.id).toBe("color.ink");
  });

  it("REFUSES a name no reference could spell, and commits nothing", () => {
    const onChange = mount(TOKENS);
    const field = nameField("color.ink");
    fireEvent.change(field, { target: { value: "has spaces" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/dot-separated words/)).toBeDefined();
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a name another token already reads under", () => {
    const onChange = mount(TOKENS);
    const field = nameField("color.ink");
    fireEvent.change(field, { target: { value: "brand.main" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/already called/)).toBeDefined();
  });

  it("says nothing when a field is left exactly as it was", () => {
    const onChange = mount(TOKENS);
    fireEvent.blur(nameField("color.ink"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/dot-separated/)).toBeNull();
  });
});

describe("editing a value", () => {
  it("commits on blur", () => {
    const onChange = mount(TOKENS);
    const field = valueField("color.ink");
    fireEvent.change(field, { target: { value: "#ff0000" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    expect(next.tokens[0]?.values.light).toBe("#ff0000");
  });

  it("reports what the engine says about a value that contradicts its kind", () => {
    const wrong: SiteTokenSet = {
      tokens: [{ name: "color.bad", kind: "color", values: { light: "16px" } }],
    };
    render(<TokensPanel tokens={wrong} onChange={vi.fn()} />);
    expect(screen.getByText(/not a colour/)).toBeDefined();
  });
});

describe("the mode switch decides what an edit WRITES", () => {
  it("shows the dark value and writes into dark", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(valueField("brand.main")).toHaveProperty("value", "#93c5fd");

    const field = valueField("brand.main");
    fireEvent.change(field, { target: { value: "#1e3a8a" } });
    fireEvent.blur(field);
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBe("#1e3a8a");
    // Light is what a reader with no mode set resolves.
    expect(token?.values.light).toBe("#3b82f6");
  });

  it("drops a dark value back to following light", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Match light" }));
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBeUndefined();
  });

  it("offers no match-light for a token that already follows light", () => {
    // `color.ink` defines only light, so there is nothing to drop.
    mount({ tokens: [TOKENS.tokens[0] as never] });
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.queryByRole("button", { name: "Match light" })).toBeNull();
  });
});

describe("removing a token asks first", () => {
  it("warns what removal means before doing it", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Remove color.ink" }));
    expect(onChange).not.toHaveBeenCalled();
    // Says what it MEANS rather than counting pages, which needs a search
    // inside a JSON column that no dialect here can do portably.
    expect(screen.getByText(/loses that style/)).toBeDefined();
  });

  it("removes by IDENTITY once confirmed", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Remove brand.main" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    // Removing by the label would have missed it: it is `color.primary`.
    expect(next.tokens.map(t => t.name)).toEqual(["color.ink"]);
  });

  it("lets the author back out", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Remove color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove color.ink" })
    ).toBeDefined();
  });
});

describe("adding a token", () => {
  it("appends one the engine will write", () => {
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    expect(next.tokens.length).toBe(TOKENS.tokens.length + 1);
    expect(next.tokens.at(-1)?.kind).toBe("color");
  });

  it("adds into a site that has no table at all", () => {
    const onChange = vi.fn();
    render(<TokensPanel tokens={{ tokens: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));
    expect((onChange.mock.calls[0]?.[0] as SiteTokenSet).tokens.length).toBe(1);
  });
});

describe("a token the site's own code supplies", () => {
  const SUPPLIED: SiteTokenSet = {
    tokens: [
      { name: "color.ink", kind: "color", values: { light: "#111111" } },
    ],
  };

  function mountWith(tokens: SiteTokenSet, supplied: SiteTokenSet) {
    const onChange = vi.fn();
    render(
      <TokensPanel tokens={tokens} supplied={supplied} onChange={onChange} />
    );
    return onChange;
  }

  it("does NOT offer to remove it", () => {
    // The stored tier expresses overrides, and absence from it means "no
    // override" — so a removal would merge straight back on the next read. An
    // action that quietly undoes itself is worse than no action.
    mountWith(TOKENS, SUPPLIED);
    expect(
      screen.queryByRole("button", { name: "Remove color.ink" })
    ).toBeNull();
    expect(screen.getAllByText("From site config").length).toBeGreaterThan(0);
  });

  it("still offers to remove a token the config never supplied", () => {
    // The control. Without it, a panel that removed every Remove button would
    // pass the assertion above.
    mountWith(TOKENS, SUPPLIED);
    expect(
      screen.queryByRole("button", { name: "Remove brand.main" })
    ).not.toBeNull();
  });

  it("offers RESET once the author has changed it, and not before", () => {
    mountWith(TOKENS, SUPPLIED);
    expect(
      screen.queryByRole("button", { name: "Reset color.ink" })
    ).toBeNull();

    cleanup();
    const overridden: SiteTokenSet = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };
    mountWith(overridden, SUPPLIED);
    expect(
      screen.queryByRole("button", { name: "Reset color.ink" })
    ).not.toBeNull();
  });

  it("reset puts the site's own value back", () => {
    const overridden: SiteTokenSet = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };
    const onChange = mountWith(overridden, SUPPLIED);
    fireEvent.click(screen.getByRole("button", { name: "Reset color.ink" }));
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    expect(next.tokens[0]?.values.light).toBe("#111111");
  });
});

describe("a save that did not happen", () => {
  it("says so, out loud", () => {
    // Without this the panel goes on showing what the author typed while the
    // site holds the old value, so a validation failure, a missing permission
    // and a dropped network all look exactly like success.
    render(
      <TokensPanel
        tokens={TOKENS}
        onChange={vi.fn()}
        issue="You do not have permission to change site styles."
      />
    );
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("permission");
  });

  it("says nothing while saves are succeeding", () => {
    mount(TOKENS);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("removing a row does not carry state onto its successor", () => {
  const THREE: SiteTokenSet = {
    tokens: [
      { name: "color.a", kind: "color", values: { light: "#111111" } },
      { name: "color.b", kind: "color", values: { light: "#222222" } },
      { name: "color.c", kind: "color", values: { light: "#333333" } },
    ],
  };

  it("shows each survivor its OWN value after an earlier row goes", () => {
    // Keyed by position, deleting `color.a` shifts every following row and
    // React reuses the deleted row's component for `color.b` — so the
    // uncontrolled inputs keep the removed token's text.
    const { rerender } = render(
      <TokensPanel tokens={THREE} onChange={vi.fn()} />
    );
    const after: SiteTokenSet = { tokens: THREE.tokens.slice(1) };
    rerender(<TokensPanel tokens={after} onChange={vi.fn()} />);

    expect(valueField("color.b")).toHaveProperty("value", "#222222");
    expect(valueField("color.c")).toHaveProperty("value", "#333333");
    expect(screen.queryByLabelText("Name of color.a")).toBeNull();
  });

  it("does not leave a successor in removal confirmation", () => {
    // The sharper half: the confirm state belongs to the row component, so a
    // reused component hands the next token a live "Remove" button it never
    // asked for — one click from removing the wrong token.
    const { rerender } = render(
      <TokensPanel tokens={THREE} onChange={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove color.a" }));
    expect(screen.getByText(/loses that style/)).toBeDefined();

    const after: SiteTokenSet = { tokens: THREE.tokens.slice(1) };
    rerender(<TokensPanel tokens={after} onChange={vi.fn()} />);
    expect(screen.queryByText(/loses that style/)).toBeNull();
  });
});

describe("a reverted value reaches the field", () => {
  it("shows the restored value after a refused save puts it back", () => {
    // The inputs are uncontrolled, so a prop change alone does not move them:
    // the panel would go on showing an override that storage and the canvas no
    // longer hold, with the author believing it was saved.
    const { rerender } = render(
      <TokensPanel tokens={TOKENS} onChange={vi.fn()} />
    );
    const typed: SiteTokenSet = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };
    rerender(<TokensPanel tokens={typed} onChange={vi.fn()} />);
    expect(valueField("color.ink")).toHaveProperty("value", "#ff0000");

    // Refused: the host puts the persisted set back.
    rerender(<TokensPanel tokens={TOKENS} onChange={vi.fn()} />);
    expect(valueField("color.ink")).toHaveProperty("value", "#111111");
  });

  it("shows the restored NAME too", () => {
    const renamed: SiteTokenSet = {
      tokens: [
        {
          id: "color.ink",
          name: "text.body",
          kind: "color",
          values: { light: "#111111" },
        },
        ...TOKENS.tokens.slice(1),
      ],
    };
    const { rerender } = render(
      <TokensPanel tokens={renamed} onChange={vi.fn()} />
    );
    expect(nameField("text.body")).toHaveProperty("value", "text.body");
    rerender(<TokensPanel tokens={TOKENS} onChange={vi.fn()} />);
    expect(nameField("color.ink")).toHaveProperty("value", "color.ink");
  });
});

describe("no tokens to show, and why", () => {
  it("says a read is in flight while it is", () => {
    render(
      <TokensPanel tokens={undefined} onChange={vi.fn()} absence="pending" />
    );
    expect(screen.getByText(/Reading this site/)).toBeDefined();
  });

  it("says a FAILED read failed, rather than describing it as still coming", () => {
    // A 403 or an exhausted retry leaves the same `undefined`, and a panel
    // that reports it as loading describes a state the site is not in and
    // gives the author nothing to act on.
    render(
      <TokensPanel tokens={undefined} onChange={vi.fn()} absence="failed" />
    );
    expect(screen.queryByText(/Reading this site/)).toBeNull();
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("could not be read");
  });
});

describe("pinning a dark value to what light already gives", () => {
  it("commits it, rather than discarding it as unchanged", () => {
    // `color.ink` has no dark value, so dark DISPLAYS the light one. Typing
    // that same value is a real edit — it fixes dark in place before light is
    // changed later — and comparing against the display discards exactly it.
    const onChange = mount(TOKENS);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    const field = valueField("color.ink");
    expect(field).toHaveProperty("value", "#111111");

    fireEvent.change(field, { target: { value: "#111111" } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    expect(next.tokens[0]?.values.dark).toBe("#111111");
    expect(next.tokens[0]?.values.light).toBe("#111111");
  });

  it("still says nothing when a mode's OWN value is retyped unchanged", () => {
    // The control. Without it, a panel that committed on every blur would pass
    // the assertion above.
    const onChange = mount(TOKENS);
    const field = valueField("color.ink");
    fireEvent.change(field, { target: { value: "#111111" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });
});
