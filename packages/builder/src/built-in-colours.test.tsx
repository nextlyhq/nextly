// @vitest-environment jsdom

/**
 * "Show built-in colours": a checkbox at the end of the Colours tab, on by
 * default, a site setting saved at once. Off, the built-in colours the site
 * does not use are left out of the Colours list and every colour picker,
 * while one it uses stays listed, marked "Built-in"; one that becomes used
 * is listed again.
 */
import {
  clearBlocks,
  registerBlocks,
  resolveSiteTokens,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { HiddenColours, useHiddenColoursRead } from "./built-in-colours";
import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./inspector/style-inspector/style-inspector-panel";
import { TokensPanel } from "./tokens-panel";
import type { VariableReach, VariablesAccess } from "./variable-usage";

/**
 * An element's accessible name, as a screen reader hears it: from its content
 * where it has no label of its own. Read through the role query, which
 * computes the name the same way for every button it finds.
 */
function nameOf(element: Element | null | undefined): string | undefined {
  let heard: string | undefined;
  screen.queryAllByRole("button", {
    name: (name, each) => {
      if (each === element) heard = name;
      return false;
    },
  });
  return heard;
}

afterEach(() => {
  cleanup();
  clearBlocks();
});

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

/** The engine's built-in colours, which the site's code adds none to. */
const SUPPLIED = resolveSiteTokens();

/** The site's own colour, beside the built-in ones. */
const OWN = {
  id: "c-own",
  name: "color.own",
  label: "Own",
  group: "Mine",
  kind: "color" as const,
  values: { light: "#7a3b10" },
};

const site = (shown?: boolean): SiteTokenSet =>
  resolveSiteTokens({
    tokens: [OWN],
    ...(shown === undefined ? {} : { builtInColoursShown: shown }),
  });

/** The site as it starts: the built-in colours shown. */
const SHOWN = site();

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

const reach = (documents: number): VariableReach => ({
  documents,
  byKind: { ...NONE, pages: documents },
  sharedStyles: [],
  // A core block's own look naming a built-in colour is not a use.
  blockDefaults: documents === 0 ? ["core/card"] : [],
  variables: [],
  siteText: [],
  complete: true,
});

/** Counts where only Primary, and whatever `used` names, is used. */
function access(used: string[] = []): VariablesAccess & {
  readonly asked: string[][];
} {
  const asked: string[][] = [];
  return {
    asked,
    usage: async ids => {
      asked.push([...ids]);
      return {
        whole: true,
        counting: false,
        mayCount: false,
        variables: new Map(
          ids.map(id => [
            id,
            reach(id === "color.primary" || used.includes(id) ? 1 : 0),
          ])
        ),
      };
    },
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  };
}

function Panel({
  usage,
  start = SHOWN,
  usedOnPage,
  readOnly = false,
  groups = ["colours"],
  onChange,
  onSettle,
}: {
  usage: VariablesAccess;
  start?: SiteTokenSet;
  usedOnPage?: ReadonlySet<string>;
  readOnly?: boolean;
  groups?: React.ComponentProps<typeof TokensPanel>["groups"];
  onChange?: (tokens: SiteTokenSet) => void;
  onSettle?: () => void;
}): React.JSX.Element {
  const [tokens, setTokens] = React.useState(start);
  React.useEffect(() => setTokens(start), [start]);
  return (
    <TokensPanel
      tokens={tokens}
      currentTokens={() => tokens}
      onChange={next => {
        onChange?.(next);
        setTokens(next);
      }}
      {...(onSettle === undefined ? {} : { onSettle })}
      supplied={SUPPLIED}
      groups={groups}
      usage={usage}
      readOnly={readOnly}
      {...(usedOnPage === undefined ? {} : { usedOnPage })}
    />
  );
}

/** The colour rows listed, by the name shown. */
function listed(): string[] {
  return [
    ...document.querySelectorAll(
      '[data-group="colours"] .nx-vars__row .nx-vars__name'
    ),
  ].map(name => name.textContent ?? "");
}

const setting = (): HTMLElement =>
  screen.getByRole("checkbox", { name: "Show built-in colours" });

const BUILT_INS = [
  "Primary",
  "Text",
  "Background",
  "Surface",
  "Border",
  "Strong border",
  "Muted text",
];

describe('the "Show built-in colours" checkbox', () => {
  it("ends the Colours tab, on by default, with its hint", () => {
    render(<Panel usage={access()} />);
    expect(setting().getAttribute("aria-checked")).toBe("true");
    const hint = document.getElementById(
      setting().getAttribute("aria-describedby") ?? ""
    );
    expect(hint?.textContent).toBe(
      "Hidden colours still work where core blocks use them"
    );
    // After every row and the add row: the last thing in the tab.
    const add = screen.getByRole("button", { name: "Add colour" });
    expect(
      add.compareDocumentPosition(setting()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(listed()).toEqual([...BUILT_INS, "Own"]);
  });

  it("is a site setting saved at once: off writes it to the site's variables", () => {
    const onChange = vi.fn();
    const onSettle = vi.fn();
    render(<Panel usage={access()} onChange={onChange} onSettle={onSettle} />);
    fireEvent.click(setting());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ builtInColoursShown: false })
    );
    expect(onSettle).toHaveBeenCalled();
    expect(setting().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(setting());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ builtInColoursShown: true })
    );
  });

  it("reads as stored, and can't be changed by an author who may not change Design", () => {
    render(<Panel usage={access()} start={site(false)} readOnly />);
    expect(setting().getAttribute("aria-checked")).toBe("false");
    expect(setting().hasAttribute("disabled")).toBe(true);
  });

  it("is only on the Colours tab", () => {
    render(<Panel usage={access()} groups={["spacing"]} />);
    expect(
      screen.queryByRole("checkbox", { name: "Show built-in colours" })
    ).toBeNull();
  });
});

describe("while the built-in colours are hidden", () => {
  it("lists only the built-in colours the site uses, marked Built-in, and the site's own", async () => {
    render(<Panel usage={access()} start={site(false)} />);
    await waitFor(() => expect(listed()).toEqual(["Primary", "Own"]));
    const primary = screen.getByRole("button", { name: /^Primary/ });
    expect(within(primary).getByText("Built-in")).toBeDefined();
    expect(nameOf(primary)).toMatch(/^Primary, built-in/);
    const own = screen.getByRole("button", { name: /^Own/ });
    expect(within(own).queryByText("Built-in")).toBeNull();
    // A group left with none of its colours listed is not drawn: Text and
    // surfaces holds only hidden built-in colours.
    expect(
      [...document.querySelectorAll("h3")].map(heading => heading.textContent)
    ).toEqual(["Brand", "Mine"]);
  });

  it("keeps listing every colour while their use is still being read", () => {
    render(<Panel usage={access()} start={site(false)} />);
    expect(listed()).toEqual([...BUILT_INS, "Own"]);
  });

  it("lists a hidden built-in colour again once the page uses it", async () => {
    const usage = access();
    const view = render(<Panel usage={usage} start={site(false)} />);
    await waitFor(() => expect(listed()).toEqual(["Primary", "Own"]));
    view.rerender(
      <Panel
        usage={usage}
        start={site(false)}
        usedOnPage={new Set(["color.surface"])}
      />
    );
    expect(listed()).toEqual(["Primary", "Surface", "Own"]);
    // The read of the site's count did not change: the page's use alone.
    expect(usage.asked.length).toBeGreaterThan(0);
  });

  it("lists a hidden built-in colour again once a variable names it", async () => {
    const used: string[] = [];
    const usage = access(used);
    const hidden = site(false);
    const view = render(<Panel usage={usage} start={hidden} />);
    await waitFor(() => expect(listed()).toEqual(["Primary", "Own"]));
    // A shadow made to name Muted: once saved, the count says Muted is used.
    used.push("color.muted");
    const named: SiteTokenSet = {
      ...hidden,
      tokens: [
        ...hidden.tokens,
        {
          name: "shadow.lift",
          kind: "shadow",
          values: { light: "0 1px 2px var(--site-color-muted)" },
        },
      ],
    };
    view.rerender(<Panel usage={usage} start={named} />);
    await waitFor(
      () => expect(listed()).toEqual(["Primary", "Muted text", "Own"]),
      { timeout: 3000 }
    );
  });

  it("shows them all again once the checkbox is ticked", async () => {
    render(<Panel usage={access()} start={site(false)} />);
    await waitFor(() => expect(listed()).toEqual(["Primary", "Own"]));
    fireEvent.click(setting());
    expect(listed()).toEqual([...BUILT_INS, "Own"]);
    expect(screen.queryByText("Built-in")).toBeNull();
  });
});

/** What the hook says is hidden, drawn for the test to read. */
function HiddenProbe(
  props: Parameters<typeof useHiddenColoursRead>[0]
): React.JSX.Element {
  const hidden = useHiddenColoursRead(props);
  return <output data-testid="hidden">{[...hidden].join(" ")}</output>;
}

describe("the hidden colours a host reads for its pickers", () => {
  it("reads the built-in colours' use, and hides each one nothing uses", async () => {
    const usage = access();
    render(
      <HiddenProbe
        tokens={site(false)}
        supplied={SUPPLIED}
        access={usage}
        usedOnPage={new Set(["color.border"])}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("hidden").textContent).toBe(
        "color.text color.background color.surface color.border-strong color.muted"
      )
    );
    // Only the built-in colours are asked about; the site's own never are.
    expect(usage.asked.flat()).not.toContain("c-own");
  });

  it("reads nothing and hides nothing while the built-in colours are shown", async () => {
    const usage = access();
    render(<HiddenProbe tokens={site()} supplied={SUPPLIED} access={usage} />);
    await Promise.resolve();
    expect(screen.getByTestId("hidden").textContent).toBe("");
    expect(usage.asked).toEqual([]);
  });
});

describe("a block's colour picker while built-in colours are hidden", () => {
  function mount(hidden: ReadonlySet<string>, stored?: unknown): void {
    registerBlocks(
      [
        {
          name: "acme/box",
          version: 1,
          description: "A box.",
          example: { props: {} },
          editor: { label: "Box" },
          props: { text: { type: "text" } },
          supports: { color: { text: true } },
          render: () => null,
        },
      ] as never,
      { source: "built-in-colours-test" }
    );
    const styles = {
      base: { base: stored === undefined ? {} : { color: stored } },
    } as unknown as NodeStyles;
    const document_ = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/box", version: 1, props: {}, styles },
      ] as BlockNode[],
    } as BlockDocument;
    const editor = {
      document: document_,
      selectedId: "a",
      selection: { ids: ["a"], primary: "a" },
      applyAll: vi.fn(() => document_),
      select: vi.fn(),
      apply: vi.fn(() => document_),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      lockRefusalFor: () => undefined,
      composed: () => undefined,
    } as unknown as EditorState;
    render(
      <HiddenColours.Provider value={hidden}>
        <StyleInspectorPanel editor={editor} tokens={site(false)} />
      </HiddenColours.Provider>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Colour for Colour/ }));
  }

  const offered = (): string[] =>
    within(screen.getByRole("listbox", { name: "Colour variables" }))
      .getAllByRole("option")
      .map(option => option.textContent ?? "");

  it("leaves out the hidden colours", () => {
    mount(new Set(["color.surface", "color.muted"]));
    expect(offered().join(" ")).not.toMatch(/Surface|Muted/);
    expect(offered().join(" ")).toMatch(/Primary/);
    expect(offered().join(" ")).toMatch(/Own/);
  });

  it("still lists the hidden colour the block holds", () => {
    mount(new Set(["color.surface", "color.muted"]), {
      $token: "color.surface",
    });
    expect(offered().join(" ")).toMatch(/Surface/);
    expect(offered().join(" ")).not.toMatch(/Muted/);
  });
});
