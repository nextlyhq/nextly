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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TokensPanel, type TokensPanelProps } from "./tokens-panel";

/**
 * The panel with a host that answers `currentTokens` from what it last passed.
 *
 * That is what a host WITHOUT a synchronous authority can manage, and it is
 * enough for every test that does not put an edit and a file read in flight at
 * the same moment. The ones that do supply their own, because the difference
 * between the two is the whole point of the prop.
 */
type HostedPanelProps = Omit<TokensPanelProps, "currentTokens"> &
  Partial<Pick<TokensPanelProps, "currentTokens">>;

function Panel({
  currentTokens,
  ...props
}: HostedPanelProps): React.JSX.Element {
  return (
    <TokensPanel
      {...props}
      currentTokens={currentTokens ?? (() => props.tokens)}
    />
  );
}

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
  render(<Panel tokens={tokens} onChange={onChange} />);
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
      <Panel tokens={unresolvable} onChange={vi.fn()} />
    );
    /*
     * Both rows own the same slot; only one of them has a swatch inside it.
     * Asserting on the SLOT count as well as the swatch count is what keeps
     * this about painting rather than about the column silently losing a cell.
     */
    const slots = Array.from(container.querySelectorAll(".nx-tokens__preview"));
    expect(slots.length).toBe(2);
    const swatches = Array.from(
      container.querySelectorAll(".nx-tokens__swatch")
    );
    expect(swatches.length).toBe(1);
    expect(swatches[0]?.getAttribute("style")).toContain("#112233");
    // A `var()` resolves against the PANEL rather than the canvas, so painting
    // it would show a colour the page does not have — the slot stays, empty.
    expect(slots[1]?.querySelector(".nx-tokens__swatch")).toBeNull();
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
    render(<Panel tokens={wrong} onChange={vi.fn()} />);
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

  it("shows the TEACHING empty state for a search that is only whitespace", () => {
    /*
     * `needle` is `query.trim().toLowerCase()`, so a query of spaces narrows
     * nothing. Reading the raw query to decide the message made the two
     * disagree: the list was unfiltered while the copy blamed a search, which
     * suppressed the teaching state on an empty library.
     */
    render(<Panel tokens={{ tokens: [] }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search tokens/i), {
      target: { value: "   " },
    });
    expect(screen.getByText("No tokens yet.")).toBeTruthy();
    expect(screen.queryByText(/No tokens match this search/i)).toBeNull();

    // Must-differ: a query that really does narrow still blames the search.
    fireEvent.change(screen.getByPlaceholderText(/Search tokens/i), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText(/No tokens match this search/i)).toBeTruthy();
    expect(screen.queryByText("No tokens yet.")).toBeNull();
  });

  it("clears a search that would HIDE the token just created", () => {
    /*
     * A new token is named after its kind, so any search not matching that
     * name hides the row the moment it is written. The control then looks
     * inert and a second press writes `shadow.2`, also hidden. The tabs could
     * not produce this — they had nothing to narrow with.
     */
    /*
     * HELD IN STATE, so the created token actually renders. With a mock
     * `onChange` this asserted that the PRE-EXISTING row came back — true, and
     * not the claim. The point is that the row just written is reachable, and
     * only a host that stores what it is given can show it.
     */
    function Host(): React.JSX.Element {
      const [tokens, setTokens] = React.useState<SiteTokenSet>({
        tokens: [
          { name: "color.ink", kind: "color", values: { light: "#111111" } },
        ],
      });
      return <Panel tokens={tokens} onChange={setTokens} />;
    }
    render(<Host />);
    const search = screen.getByPlaceholderText(/Search tokens/i);
    fireEvent.change(search, { target: { value: "brand" } });
    expect(screen.queryByDisplayValue("color.ink")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));
    expect((search as HTMLInputElement).value).toBe("");
    // The pre-existing row is back...
    expect(screen.getByDisplayValue("color.ink")).toBeTruthy();
    // ...and so is the one just created, which is the actual claim.
    const names = Array.from(
      document.querySelectorAll<HTMLInputElement>(".nx-tokens__name"),
      node => node.value
    );
    expect(names).toContain("color.ink");
    expect(names.length).toBe(2);
    expect(names.some(value => value !== "color.ink")).toBe(true);
  });

  it("adds into a site that has no table at all", () => {
    const onChange = vi.fn();
    render(<Panel tokens={{ tokens: [] }} onChange={onChange} />);
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
    render(<Panel tokens={tokens} supplied={supplied} onChange={onChange} />);
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
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
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
      <Panel
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
    const { rerender } = render(<Panel tokens={THREE} onChange={vi.fn()} />);
    const after: SiteTokenSet = { tokens: THREE.tokens.slice(1) };
    rerender(<Panel tokens={after} onChange={vi.fn()} />);

    expect(valueField("color.b")).toHaveProperty("value", "#222222");
    expect(valueField("color.c")).toHaveProperty("value", "#333333");
    expect(screen.queryByLabelText("Name of color.a")).toBeNull();
  });

  it("does not leave a successor in removal confirmation", () => {
    // The sharper half: the confirm state belongs to the row component, so a
    // reused component hands the next token a live "Remove" button it never
    // asked for — one click from removing the wrong token.
    const { rerender } = render(<Panel tokens={THREE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove color.a" }));
    expect(screen.getByText(/loses that style/)).toBeDefined();

    const after: SiteTokenSet = { tokens: THREE.tokens.slice(1) };
    rerender(<Panel tokens={after} onChange={vi.fn()} />);
    expect(screen.queryByText(/loses that style/)).toBeNull();
  });
});

describe("a reverted value reaches the field", () => {
  it("shows the restored value after a refused save puts it back", () => {
    // The inputs are uncontrolled, so a prop change alone does not move them:
    // the panel would go on showing an override that storage and the canvas no
    // longer hold, with the author believing it was saved.
    const { rerender } = render(<Panel tokens={TOKENS} onChange={vi.fn()} />);
    const typed: SiteTokenSet = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };
    rerender(<Panel tokens={typed} onChange={vi.fn()} />);
    expect(valueField("color.ink")).toHaveProperty("value", "#ff0000");

    // Refused: the host puts the persisted set back.
    rerender(<Panel tokens={TOKENS} onChange={vi.fn()} />);
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
    const { rerender } = render(<Panel tokens={renamed} onChange={vi.fn()} />);
    expect(nameField("text.body")).toHaveProperty("value", "text.body");
    rerender(<Panel tokens={TOKENS} onChange={vi.fn()} />);
    expect(nameField("color.ink")).toHaveProperty("value", "color.ink");
  });
});

describe("no tokens to show, and why", () => {
  it("says a read is in flight while it is", () => {
    render(<Panel tokens={undefined} onChange={vi.fn()} absence="pending" />);
    expect(screen.getByText(/Reading this site/)).toBeDefined();
  });

  it("says a FAILED read failed, rather than describing it as still coming", () => {
    // A 403 or an exhausted retry leaves the same `undefined`, and a panel
    // that reports it as loading describes a state the site is not in and
    // gives the author nothing to act on.
    render(<Panel tokens={undefined} onChange={vi.fn()} absence="failed" />);
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

describe("bringing a token file in", () => {
  /** A DTCG document holding one colour this site does not have. */
  const FILE = JSON.stringify({
    color: {
      brand: {
        $type: "color",
        $value: "#f59e0b",
        $extensions: {
          "com.nextlyhq.nextly": {
            css: { light: "#f59e0b" },
            kind: "color",
          },
        },
      },
    },
  });

  /** A `File` whose `text()` resolves, which jsdom does not provide. */
  function fileOf(contents: string): File {
    const file = new File([contents], "tokens.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(contents),
    });
    return file;
  }

  /**
   * Choose a file and wait for the panel to have ANSWERED.
   *
   * Waits for the observable condition rather than for one turn of the event
   * loop. A single tick is enough only when nothing else is competing for it:
   * under a full suite or a loaded machine the read can settle after that tick
   * and the assertion looks at a panel that has not reported yet. That is a
   * test which passes on a fast machine and fails in CI, which is worse than
   * one that fails everywhere.
   */
  const chooseFile = async (contents: string): Promise<void> => {
    const input = screen.getByLabelText("Import");
    fireEvent.change(input, { target: { files: [fileOf(contents)] } });
    await waitFor(() => {
      expect(
        screen.queryByRole("status") ?? screen.queryByRole("alert")
      ).not.toBeNull();
    });
  };

  it("MERGES the file into what the site already has", async () => {
    const onChange = mount(TOKENS);
    await chooseFile(FILE);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    // Everything that was there is still there, and the file was added.
    expect(next.tokens.map(t => t.name)).toEqual([
      "color.ink",
      "brand.main",
      "color.brand",
    ]);
  });

  it("says how many arrived", async () => {
    mount(TOKENS);
    await chooseFile(FILE);
    expect(screen.getByRole("status").textContent).toContain(
      "Imported 1 token"
    );
  });

  it("NAMES what it could not carry, rather than reporting success alone", async () => {
    // The report is the feature: a designer handed a file with tokens missing
    // has no other way to know, and the missing ones are the interesting ones.
    const withUnusable = JSON.parse(FILE) as Record<string, unknown>;
    withUnusable["motion"] = {
      ease: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
    };
    mount(TOKENS);
    await chooseFile(JSON.stringify(withUnusable));
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toContain("Imported 1 token");
    expect(said).toContain("cubicBezier");
  });

  it("refuses a file that is not JSON, and changes nothing", async () => {
    const onChange = mount(TOKENS);
    await chooseFile("{ not json");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("not valid JSON");
  });

  /*
   * NOT TESTED HERE, deliberately: that clearing the input lets the same file
   * be chosen twice. jsdom reports `value` as "" for a file input whether or
   * not a file was chosen — measured — so an assertion on it passes with the
   * clearing removed and proves nothing. The behaviour is real in a browser,
   * where an unchanged value fires no change event and an author who fixed
   * their file and picked it back would see nothing happen. It is covered by
   * the comment at the call site rather than by a green test that cannot fail.
   */

  it("merges into what the HOST holds, before React has re-rendered it", async () => {
    /*
     * The window a re-render cannot model. An author's edit reaches the host
     * synchronously, but React commits the resulting render on its own
     * schedule — so between the edit and that commit there is no version of
     * "the latest props this panel saw" that has it. A file read resolving in
     * there merges into the set from before the edit and persists it.
     *
     * So the panel is never re-rendered here. The only thing that changes is
     * what the host ANSWERS, which is exactly what a host keeping its authority
     * in a ref can offer and a prop cannot.
     */
    const onChange = vi.fn();
    const held: { set: SiteTokenSet } = { set: TOKENS };
    let resolveRead: ((text: string) => void) | undefined;
    const slow = new File([FILE], "tokens.json", { type: "application/json" });
    Object.defineProperty(slow, "text", {
      value: () =>
        new Promise<string>(resolve => {
          resolveRead = resolve;
        }),
    });

    render(
      <Panel
        tokens={TOKENS}
        onChange={onChange}
        currentTokens={() => held.set}
      />
    );
    fireEvent.change(screen.getByLabelText("Import"), {
      target: { files: [slow] },
    });

    held.set = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };

    resolveRead?.(FILE);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const merged = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(merged.tokens.find(t => t.name === "color.ink")?.values.light).toBe(
      "#ff0000"
    );
    // The control: the file still arrived, so this is a merge rather than the
    // edit simply being handed back.
    expect(merged.tokens.map(t => t.name)).toContain("color.brand");
  });

  it("merges into the set as it is NOW, not as it was when the read began", async () => {
    // Reading a file is asynchronous and an author can edit while it is in
    // flight. Merging into the set this render closed over discards that edit
    // and persists the stale result — an edit made, seen, and silently undone
    // by an import that was already running.
    const onChange = vi.fn();
    let resolveRead: ((text: string) => void) | undefined;
    const slow = new File([FILE], "tokens.json", { type: "application/json" });
    Object.defineProperty(slow, "text", {
      value: () =>
        new Promise<string>(resolve => {
          resolveRead = resolve;
        }),
    });

    const { rerender } = render(<Panel tokens={TOKENS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Import"), {
      target: { files: [slow] },
    });

    // The author edits while the read is still out, and the host re-renders
    // the panel with the newer set.
    const edited: SiteTokenSet = {
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#ff0000" } },
        ...TOKENS.tokens.slice(1),
      ],
    };
    rerender(<Panel tokens={edited} onChange={onChange} />);

    resolveRead?.(FILE);
    // The observable condition, not a turn of the loop: the import has
    // reported back.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const merged = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    // The edit survived the import.
    expect(merged.tokens.find(t => t.name === "color.ink")?.values.light).toBe(
      "#ff0000"
    );
    // And the file still arrived.
    expect(merged.tokens.map(t => t.name)).toContain("color.brand");
  });

  it("reports a file it could not READ, rather than doing nothing quietly", async () => {
    // Removed between choosing and opening, a permission refusal, a failing
    // disk. Without a guard the rejection escapes into the `void` at the call
    // site and the import does nothing while saying nothing.
    const onChange = mount(TOKENS);
    const broken = new File(["x"], "tokens.json", { type: "application/json" });
    Object.defineProperty(broken, "text", {
      value: () => Promise.reject(new Error("EACCES")),
    });
    fireEvent.change(screen.getByLabelText("Import"), {
      target: { files: [broken] },
    });
    const said = await screen.findByRole("alert");
    expect(said.textContent).toContain("could not be read");
    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * NOT SEPARATED HERE, and said rather than left as a silent gap: whether the
   * latest-set ref is assigned during RENDER or from an effect. The window is
   * real — an effect runs after commit, so a read resolving between the commit
   * of an edit and the effect that records it reads the previous set — but this
   * harness cannot open it: `rerender` runs inside `act`, which flushes effects
   * before returning, so both forms pass. Measured: moving the assignment back
   * into an effect fails nothing.
   *
   * The assignment is therefore in render on reasoning rather than on a failing
   * test, and the reasoning is that an effect cannot close a window that opens
   * before effects run.
   */

  it("an OLDER read does not overwrite a newer one's report", async () => {
    // Two files in flight, answering out of order. Without a sequence guard a
    // slow rejection lands after a fast success and reports failure for an
    // import that was applied and persisted.
    const onChange = vi.fn();
    let rejectFirst: ((reason: Error) => void) | undefined;
    const slow = new File(["x"], "a.json", { type: "application/json" });
    Object.defineProperty(slow, "text", {
      value: () =>
        new Promise<string>((_, reject) => {
          rejectFirst = reject;
        }),
    });

    render(<Panel tokens={TOKENS} onChange={onChange} />);
    const input = screen.getByLabelText("Import");

    fireEvent.change(input, { target: { files: [slow] } });
    // The author picks a second, good file before the first answers.
    fireEvent.change(input, { target: { files: [fileOf(FILE)] } });
    const first = await screen.findByRole("status");
    expect(first.textContent).toContain("Imported 1 token");

    // Now the FIRST read fails, late.
    rejectFirst?.(new Error("EACCES"));
    // An ABSENCE is asserted below, so this has to give the late rejection
    // every chance to speak rather than race it. `waitFor` retries until its
    // body stops throwing, which is the wrong shape for a condition that must
    // hold rather than arrive.
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });

    // The success still stands: the older answer said nothing.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Imported 1 token"
    );
  });

  it("a clean export does not wipe an import's report", async () => {
    // Exporting is the common next step after an import, and the import's
    // report is the only list naming what the source file could not carry.
    // Clearing it because a later action had no news of its own destroys the
    // one thing the author still needed — without them dismissing anything.
    const withUnusable = JSON.parse(FILE) as Record<string, unknown>;
    withUnusable["motion"] = {
      ease: { $type: "cubicBezier", $value: [0.4, 0, 0.2, 1] },
    };
    mount(TOKENS);
    await chooseFile(JSON.stringify(withUnusable));
    expect(screen.getByRole("status").textContent).toContain("cubicBezier");

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    // The list the author still needs is still there.
    expect(screen.getByRole("status").textContent).toContain("cubicBezier");
  });

  /*
   * NOT SEPARATED HERE either, and for the same reason as the render-versus-
   * effect note above: whether the unmount invalidation is layout-timed or
   * passive. `unmount` runs inside `act`, which flushes passive effects, so the
   * commit-to-passive-cleanup window never opens and both forms pass —
   * measured. It is layout-timed on the reasoning that a passive cleanup runs
   * after the unmount commit, which is precisely the gap it exists to close.
   */

  it("a read that lands after the panel is GONE changes nothing", async () => {
    // The shell renders one left panel at a time and keys them, so switching
    // to Layers while a large file is being read unmounts this — and the
    // continuation would still call `onChange`, changing the site after the
    // author left the tool, with its report discarded.
    const onChange = vi.fn();
    let resolveRead: ((text: string) => void) | undefined;
    const slow = new File([FILE], "tokens.json", { type: "application/json" });
    Object.defineProperty(slow, "text", {
      value: () =>
        new Promise<string>(resolve => {
          resolveRead = resolve;
        }),
    });

    const { unmount } = render(<Panel tokens={TOKENS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Import"), {
      target: { files: [slow] },
    });

    unmount();
    resolveRead?.(FILE);
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });

    // The site was not changed by a panel the author had already left.
    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * NOT TESTED, and the reason is that I could not reach it. The report keys
   * carry their position as well as their text, because a list keyed on text
   * alone hands React two identical keys the moment a message repeats — but no
   * fixture produced a repeat. The engine names the TOKEN in each of its
   * messages, and this boundary's own refusals name a token or a path too. The
   * one message that could repeat — two tokens refused for one taken name —
   * cannot arrive from a file, because a design-token document derives a
   * token's name from its path and so cannot hold two tokens under one.
   *
   * The keying stands as a cheap guard over a case nothing here can currently
   * produce, rather than as a fix for an observed defect.
   */

  it("keeps the report until it is dismissed", async () => {
    mount(TOKENS);
    await chooseFile(FILE);
    expect(screen.queryByRole("status")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

/** A token whose vendor data JSON has no form for. */
const UNWRITABLE: SiteTokenSet = (() => {
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  return {
    tokens: [
      {
        name: "color.ink",
        kind: "color",
        values: { light: "#111111" },
        extensions: { vendor: cyclic },
      },
    ],
  };
})();

describe("an export that could not be written", () => {
  it("says it could not be written, and says it as a refusal", () => {
    // The tone decides how the report is announced, so calling this "done"
    // would headline "Saved ..." directly above a line saying nothing was, and
    // announce a failure as a passive status update.
    render(<Panel tokens={UNWRITABLE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("could not be written");
    expect(said.textContent).not.toContain("Saved");
  });

  it("still reports a successful export as a STATUS, not merely as not-an-alert", () => {
    // The control, and it has to REQUIRE the status rather than assert the
    // absence of an alert: no report at all satisfies "no alert", so the weaker
    // form passes for a panel that reports nothing and for one that calls every
    // export a refusal — the second only by accident.
    //
    // The fixture therefore has something to report: a token whose kind the
    // format cannot carry, so the export succeeds AND warns.
    const partly: SiteTokenSet = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#111111" } },
        { name: "odd.one", kind: "custom", values: { light: "0" } },
      ],
    };
    render(<Panel tokens={partly} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    const said = screen.getByRole("status");
    expect(said.textContent).toContain("Saved tokens.json");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("an export that produces no file", () => {
  it("says so when there is nothing to write", () => {
    /*
     * A site with no token values compiles to an empty stylesheet and warns
     * about nothing, so there is no file AND no list of reasons. The silence
     * that is right for a successful export — the file is the confirmation —
     * covered this too, and the button did nothing at all: no download, no
     * message, nothing to act on.
     */
    render(<Panel tokens={{ tokens: [] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Export CSS" }));
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("no token values to write");
    // And it is not worded as a failure, because nothing failed.
    expect(said.textContent).not.toContain("could not be written");
  });

  it("still says COULD NOT when something actually went wrong", () => {
    // The control: an artefact that is empty because the write was refused
    // keeps the fault wording and its list of reasons.
    render(<Panel tokens={UNWRITABLE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("could not be written");
    expect(said.textContent).not.toContain("no token values");
  });

  it("stays silent when a file DID arrive with nothing to report", () => {
    /*
     * The other control, and the reason the silence exists: exporting is the
     * common next step after an import, and a clean export must not wipe the
     * import's report of what the source file could not carry.
     *
     * The absence of a report is not enough on its own. An export that stopped
     * handing over a file while still taking the wrote branch would satisfy
     * both queries below and be exactly the silent no-op the sibling test
     * exists to catch — so the download boundary is asserted to have been
     * REACHED, with the bytes that were built.
     */
    const made = vi.spyOn(URL, "createObjectURL");
    try {
      render(<Panel tokens={TOKENS} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Export CSS" }));
      expect(made).toHaveBeenCalledTimes(1);
      expect(made.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      made.mockRestore();
    }
  });
});

describe("an import where nothing landed", () => {
  it("reports a refusal and does NOT save", async () => {
    /*
     * `importDtcg` succeeds when the file was readable, and every token in it
     * can still be refused afterwards — by a name the site holds, by a path, by
     * a custom property two tokens compose. Announcing "Imported 0 tokens." as
     * a status claims an arrival that did not happen, and handing the host a
     * table identical to the one it had spends a save on nothing.
     */
    const onChange = vi.fn();
    const held: SiteTokenSet = {
      tokens: [
        { id: "other", name: "thing", kind: "number", values: { light: "9" } },
      ],
    };
    render(
      <Panel tokens={held} onChange={onChange} currentTokens={() => held} />
    );
    /*
     * Names a token the site already holds under a DIFFERENT identity, so the
     * file reads fine and its one token is refused on the way in. A NUMBER,
     * because a bare string is not a readable DTCG colour value and the token
     * would then be unusable rather than refused — a different path, and one
     * that reports its own refusal.
     */
    const document = JSON.stringify({
      thing: { $type: "number", $value: 1 },
    });
    /*
     * `text` supplied explicitly, as every other import test here does: jsdom
     * File does not implement it, and without this the panel reports the file
     * as unreadable — a refusal that would satisfy the assertion below for
     * entirely the wrong reason.
     */
    const chosen = new File([document], "tokens.json", {
      type: "application/json",
    });
    Object.defineProperty(chosen, "text", {
      value: () => Promise.resolve(document),
    });
    fireEvent.change(screen.getByLabelText("Import"), {
      target: { files: [chosen] },
    });

    const said = await screen.findByRole("alert");
    expect(said.textContent).toContain("could be imported");
    // The half that matters beyond the wording: no no-op save.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the panel explains itself and shows the whole set", () => {
  /** Tokens across three kinds, so grouping and search have something to cross. */
  const MIXED: SiteTokenSet = {
    tokens: [
      { name: "color.ink", kind: "color", values: { light: "#111111" } },
      { name: "space.gutter", kind: "dimension", values: { light: "1.5rem" } },
      { name: "motion.settle", kind: "duration", values: { light: "240ms" } },
    ],
  };

  it("says what a token IS, in the words an author would use", () => {
    // The panel opened with a mode switch, a transfer control and eight tabs of
    // vocabulary, and never a sentence about what any of it does to the site.
    mount(MIXED);
    /*
     * Read off the LEDE itself rather than the document. "Light" is also the
     * mode switch's own button, so a document-wide match for it passes on a
     * panel whose lede says nothing about the mode at all.
     */
    const lede = document.querySelector(".nx-tokens__lede");
    expect(lede?.textContent).toMatch(/named values/i);
    expect(lede?.textContent).toMatch(/every block using one/i);
    /*
     * And it NAMES the mode, because an edit reaches only the values of the
     * mode on screen. "every block changes" described renderings a light edit
     * deliberately leaves alone.
     */
    expect(lede?.textContent).toMatch(/editing the light values/i);
    expect(lede?.textContent).not.toMatch(/changes with it, on every page/i);
  });

  it("BOUNDS how many rows of one kind it mounts", () => {
    /*
     * The grouped shape reads every kind at once where the tabs read only the
     * open one, and a DTCG import is not bounded to a size where mounting them
     * all stays invisible — each row carries two inputs and a preview. Same
     * cap and same control as `class-manager-panel`, for the same reason.
     */
    const many: SiteTokenSet = {
      tokens: Array.from({ length: 130 }, (_, at) => ({
        name: `color.c${at}`,
        kind: "color" as const,
        values: { light: "#111111" },
      })),
    };
    mount(many);
    // The heading still reports the WHOLE group, not the mounted slice —
    // otherwise the count would tell an author 50 tokens exist.
    expect(screen.getByText("130")).toBeTruthy();
    expect(screen.getAllByDisplayValue(/^color\.c/).length).toBe(50);

    const more = screen.getByRole("button", { name: /Show 50 more/i });
    fireEvent.click(more);
    expect(screen.getAllByDisplayValue(/^color\.c/).length).toBe(100);
  });

  it("reveals a token added PAST the page it would land behind", () => {
    /*
     * Clearing the search was only half of it. A new token is appended, so in a
     * kind that already fills its page it lands after the mounted slice and is
     * hidden by the CAP rather than by the query — the same invisible write,
     * one control further on, and pressing Add again would make a second one.
     */
    const full: SiteTokenSet = {
      tokens: Array.from({ length: 300 }, (_, at) => ({
        name: `color.c${at}`,
        kind: "color" as const,
        values: { light: "#111111" },
      })),
    };
    const onChange = vi.fn();
    const view = render(<Panel tokens={full} onChange={onChange} />);
    // The control: row 60 is genuinely behind the cap before the add.
    expect(screen.getAllByDisplayValue(/^color\.c/).length).toBe(50);

    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));
    const next = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    const made = next.tokens[next.tokens.length - 1];
    view.rerender(<Panel tokens={next} onChange={onChange} />);

    expect(made).toBeDefined();
    expect(screen.getByDisplayValue(made!.name)).toBeTruthy();
    /*
     * And it is revealed WITHOUT mounting everything before it. Raising the
     * limit to reach an appended row mounts every preceding one, which in a
     * DTCG-sized set is the exact freeze the cap exists to prevent — so the
     * mounted count must stay near the page, not near the total.
     */
    /*
     * And WITHOUT mounting everything before it: the head is still one page.
     * Raising the limit to reach an appended row mounts every preceding one,
     * which in a DTCG-sized set is the exact freeze the cap exists to prevent
     * — with 300 stored, that is 300 rows rather than 50 plus the new one.
     */
    expect(screen.getAllByDisplayValue(/^color\.c/).length).toBe(50);
  });

  it("REMOUNTS the revealed row when a second add replaces it", () => {
    /*
     * The revealed entry sits at a fixed position, so without a key React
     * reuses one `TokenEntry` across different tokens and carries its local
     * state along — dropping a newly added token straight into the previous
     * row's removal confirmation, an irreversible control armed against
     * something the author never selected.
     *
     * HELD IN STATE rather than rerendered by hand, because that difference
     * decides whether the bug is reachable at all. With a mock `onChange` the
     * panel re-renders once with the NEW `revealAt` and the OLD token list, so
     * the revealed row is momentarily absent, the block unmounts, and the leak
     * cannot happen. A host that stores what it is given updates both together
     * — which is what the product does, and the only composition that tests
     * this.
     */
    function Host(): React.JSX.Element {
      const [tokens, setTokens] = React.useState<SiteTokenSet>({
        tokens: Array.from({ length: 60 }, (_, at) => ({
          name: `color.c${at}`,
          kind: "color" as const,
          values: { light: "#111111" },
        })),
      });
      return <Panel tokens={tokens} onChange={setTokens} />;
    }
    render(<Host />);

    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));
    // Read the name off the revealed block itself rather than inferring it
    // from the generated pattern: the probe's subject must be resolved, not
    // assumed, or a miss reads as a passing test.
    const revealedName = (
      document
        .querySelector(".nx-tokens__revealed")
        ?.querySelector("input") as HTMLInputElement | null
    )?.value;
    expect(revealedName).toBeDefined();
    const first = revealedName;

    // Arm the revealed row's removal confirmation.
    fireEvent.click(screen.getByRole("button", { name: `Remove ${first!}` }));
    expect(screen.getByText(/loses that style/i)).toBeTruthy();

    // A second add replaces WHICH token is revealed, in one update.
    fireEvent.click(screen.getByRole("button", { name: /Add colour token/i }));

    // The new token must arrive UNARMED.
    expect(screen.queryByText(/loses that style/i)).toBeNull();
  });

  it("draws a preview for every kind that HAS a visual form", () => {
    /*
     * Only colour was previewed, so a shadow was an opaque CSS string and a
     * size was a number with nothing to compare it to. Each kind is now shown
     * as the thing it is, in the same slot so the column stays a column.
     */
    mount({
      tokens: [
        { name: "color.ink", kind: "color", values: { light: "#112233" } },
        { name: "size.gap", kind: "dimension", values: { light: "8px" } },
        {
          name: "shadow.card",
          kind: "shadow",
          values: { light: "0 1px 2px #000" },
        },
        { name: "weight.bold", kind: "fontWeight", values: { light: "700" } },
        { name: "font.body", kind: "fontFamily", values: { light: "serif" } },
        { name: "speed.fast", kind: "duration", values: { light: "150ms" } },
      ],
    });
    // Each preview drawn AS the value: the style attribute is what makes it a
    // preview rather than a label, so that is what is asserted.
    const shadow = document.querySelector<HTMLElement>(".nx-tokens__shadow");
    expect(shadow?.style.boxShadow).toBe("0 1px 2px #000");
    const bar = document.querySelector<HTMLElement>(".nx-tokens__bar");
    expect(bar?.style.width).toContain("8px");
    const tick = document.querySelector<HTMLElement>(".nx-tokens__tick");
    expect(tick?.style.animationDuration).toBe("150ms");
    const previews = Array.from(
      document.querySelectorAll<HTMLElement>(".nx-tokens__preview")
    );
    expect(previews.some(node => node.style.fontWeight === "700")).toBe(true);
    expect(previews.some(node => node.style.fontFamily === "serif")).toBe(true);
    // Colour keeps its own swatch, under the rule it already had.
    expect(document.querySelector(".nx-tokens__swatch")).not.toBeNull();
  });

  it("draws NOTHING for a value it cannot resolve on its own", () => {
    /*
     * The guard rail colour already had, applied to every kind: a `var()`
     * resolves against the PANEL's custom properties rather than the canvas's,
     * so drawing it would show something the page does not have. And `number`
     * and `custom` have no visual form to draw at all.
     */
    mount({
      tokens: [
        {
          name: "size.ref",
          kind: "dimension",
          values: { light: "var(--site-size-gap)" },
        },
        { name: "count.cols", kind: "number", values: { light: "3" } },
        { name: "custom.thing", kind: "custom", values: { light: "whatever" } },
      ],
    });
    expect(document.querySelector(".nx-tokens__bar")).toBeNull();
    expect(document.querySelector(".nx-tokens__shadow")).toBeNull();
    // Every row still carries its slot, EMPTY, so the column does not go ragged
    // — which is the failure that made colour share this element in the first
    // place.
    const slots = Array.from(document.querySelectorAll(".nx-tokens__preview"));
    expect(slots.length).toBe(3);
    expect(slots.every(slot => slot.childElementCount === 0)).toBe(true);
  });

  it("draws no preview for a token the ENGINE refuses to write", () => {
    /*
     * Preview eligibility is the engine's verdict, not a second rule here. A
     * value `checkCssValue` rejects is absent from the page stylesheet, and the
     * browser may still accept it on an inline `width` — so a panel judging for
     * itself would draw a preview of a token the page does not carry.
     */
    mount({
      tokens: [
        { name: "size.ok", kind: "dimension", values: { light: "8px" } },
        {
          name: "size.bad",
          kind: "dimension",
          values: { light: "8px; color: red" },
        },
      ],
    });
    // The control: the good one IS drawn, so this is about the refusal rather
    // than about previews being off altogether.
    const bars = document.querySelectorAll(".nx-tokens__bar");
    expect(bars.length).toBe(1);
    expect((bars[0] as HTMLElement).style.width).toContain("8px");
  });

  it("keeps a negative length's SIZE and its direction", () => {
    /*
     * A dimension token may validly be negative — a margin pulling something
     * back. CSS refuses a negative `width`, so the declaration was discarded
     * and `min-width` left the same sliver a zero shows: a working token drawn
     * as though it had neither size nor direction.
     */
    mount({
      tokens: [
        { name: "pull.back", kind: "dimension", values: { light: "-8px" } },
      ],
    });
    const bar = document.querySelector<HTMLElement>(".nx-tokens__bar");
    expect(bar?.style.width).toContain("8px");
    expect(
      document.querySelector(".nx-tokens__preview")?.getAttribute("data-sign")
    ).toBe("negative");
  });

  it("refuses a length whose SIGN it cannot read", () => {
    // A bar drawn on the wrong side of the line is worse than none, and a
    // `calc()` hides its sign behind arithmetic this panel does not do.
    mount({
      tokens: [
        {
          name: "odd.one",
          kind: "dimension",
          values: { light: "calc(4px - 8px)" },
        },
      ],
    });
    expect(document.querySelector(".nx-tokens__bar")).toBeNull();
    // The slot stays, so the column does not go ragged.
    expect(document.querySelector(".nx-tokens__preview")).not.toBeNull();
  });

  it("groups every kind that HAS tokens into one list", () => {
    // The must-be-found half. Three kinds are present, so three headings are.
    mount(MIXED);
    for (const heading of ["Colour", "Size", "Duration"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
  });

  it("does not draw a group for a kind with no tokens", () => {
    /*
     * The point of the shape. Eight tabs meant five clickable dead ends in a
     * 320px rail; a kind with nothing in it should not be a place you can go.
     *
     * The control is the test above: it proves the query CAN find a heading, so
     * this absence is about the kind being omitted rather than about the
     * selector matching nothing.
     */
    mount(MIXED);
    for (const heading of ["Font", "Weight", "Number", "Shadow", "Custom"]) {
      expect(screen.queryByRole("heading", { name: heading })).toBeNull();
    }
  });

  it("searches across every kind at once, which tabs could not", () => {
    /*
     * A tabbed panel can only search within a tab, or it crosses a boundary the
     * tabs assert. One list has no boundary to cross, so a query matching two
     * kinds returns both — and that is the capability the shape buys.
     */
    mount(MIXED);
    fireEvent.change(
      screen.getByRole("searchbox", { name: /search tokens/i }),
      {
        target: { value: "e" },
      }
    );
    // "color.ink" has no "e"; the other two do, and they are different kinds.
    expect(screen.getByRole("heading", { name: "Size" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Duration" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Colour" })).toBeNull();
  });

  it("teaches at the empty state instead of reporting absence and stopping", () => {
    // "No colour tokens yet." says what is missing and offers nothing. An empty
    // panel is the first thing a new site shows, so it is the one surface that
    // has to teach.
    mount({ tokens: [] });
    expect(screen.getByText(/no tokens yet/i)).toBeTruthy();
    expect(
      screen.getByText(/point at it instead of repeating it/i)
    ).toBeTruthy();
    // Not the absolute claim: an edit reaches one mode, so "the whole site
    // follows" promised more than a single edit does.
    expect(screen.queryByText(/the whole site follows/i)).toBeNull();
  });
});
