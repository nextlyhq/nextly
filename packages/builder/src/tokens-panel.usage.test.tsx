// @vitest-environment jsdom

/**
 * The Variables view with the host's usage reads: the count at the end of
 * each row, the status beside Remove, and Remove refusing in place while a
 * variable is used or not counted yet, with the places using it and Count
 * now.
 *
 * `variable-usage.test` asserts the words; this drives them as an author
 * meets them.
 *
 * @module tokens-panel.usage.test
 */
import {
  BASE_BREAKPOINT,
  type NamedClass,
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

import type { SharedStylesCount } from "./shared-style-library";
import { TokensPanel, type TokensPanelProps } from "./tokens-panel";
import type {
  VariableReach,
  VariablesAccess,
  VariableUse,
  VariableUsesPage,
} from "./variable-usage";

afterEach(cleanup);

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

const SITE: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    { name: "color.text", kind: "color", values: { light: "#3b3f46" } },
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "dimension", values: { light: "26px" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

const CARD: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } } },
};

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

function reach(
  documents: number,
  sharedStyles: readonly string[] = [],
  complete = true,
  blockDefaults: readonly string[] = []
): VariableReach {
  return {
    documents,
    byKind: { ...NONE, pages: documents },
    sharedStyles,
    blockDefaults,
    complete,
  };
}

/** A host's reads, recording what they were asked. */
interface Host extends VariablesAccess {
  readonly asked: string[][];
  readonly counted: { count: number };
}

function host({
  reaches,
  uses = [],
  hidden = 0,
  mayCount = false,
  count,
  openSharedStyle,
}: {
  reaches: () => Record<string, VariableReach>;
  uses?: readonly VariableUse[];
  hidden?: number;
  mayCount?: boolean;
  count?: () => Promise<SharedStylesCount>;
  openSharedStyle?: (classId: string) => void;
}): Host {
  const asked: string[][] = [];
  const counted = { count: 0 };
  const now = reaches;
  return {
    asked,
    counted,
    usage: async ids => {
      asked.push([...ids]);
      const all = now();
      const variables = new Map(
        ids.flatMap(id => {
          const found = all[id];
          return found === undefined ? [] : [[id, found] as const];
        })
      );
      const whole = [...variables.values()].every(entry => entry.complete);
      return { whole, counting: !whole, mayCount, variables };
    },
    uses: async (): Promise<VariableUsesPage> => ({
      items: uses.slice(0, 20),
      total: uses.length,
      hidden,
      hasNext: uses.length > 20,
      complete: true,
    }),
    ...(count === undefined
      ? {}
      : {
          count: async () => {
            counted.count += 1;
            return count();
          },
        }),
    ...(openSharedStyle === undefined ? {} : { openSharedStyle }),
  };
}

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted(
  props: Omit<TokensPanelProps, "tokens" | "currentTokens" | "onChange"> & {
    onChange?: (tokens: SiteTokenSet) => void;
  }
): React.JSX.Element {
  const [tokens, setTokens] = React.useState(SITE);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      {...props}
      tokens={tokens}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setTokens(next);
        props.onChange?.(next);
      }}
    />
  );
}

const row = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

async function openEditor(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog");
}

const USES: readonly VariableUse[] = [
  {
    id: "c-card",
    title: "Card",
    collection: "site-style",
    kind: "shared-style",
  },
  {
    id: "p1",
    title: "Homepage",
    collection: "pages",
    kind: "pages",
    href: "/admin/collections/pages/p1/builder",
  },
  {
    id: "h1",
    title: "Site header",
    collection: "components",
    kind: "components",
    href: "/admin/collections/components/h1/builder",
  },
];

describe("the count at the end of each row", () => {
  it("is the places, said in words to a screen reader and on hover", async () => {
    const usage = host({
      reaches: () => ({
        "color.brand": reach(12, ["c-card", "c-hero"]),
        "color.text": reach(0),
        "font-size.body": reach(1),
        "space.4": reach(2, [], false),
      }),
    });
    render(<Hosted usage={usage} />);
    const brand = await screen.findByRole("button", {
      name: /^Brand.*\. Used in 14 places$/,
    });
    const count = brand.querySelector(".nx-vars__count");
    expect(count?.textContent).toBe("14");
    expect(count?.getAttribute("title")).toBe("Used in 14 places");
    expect(count?.hasAttribute("data-zero")).toBe(false);

    const text = row(/^Text.*\. Not used anywhere$/);
    const zero = text.querySelector(".nx-vars__count");
    expect(zero?.textContent).toBe("0");
    expect(zero?.hasAttribute("data-zero")).toBe(true);

    expect(row(/^Body.*\. Used in 1 place$/)).toBeDefined();

    const space = row(/Some pages aren't counted yet\.$/);
    const floor = space.querySelector(".nx-vars__count");
    expect(floor?.textContent).toBe("2+");
    expect(floor?.hasAttribute("data-floor")).toBe(true);
  });

  it("asks for each row's own variable, a type size's size and not its line height", async () => {
    const usage = host({ reaches: () => ({ "color.brand": reach(1) }) });
    render(<Hosted usage={usage} />);
    await screen.findByRole("button", { name: /^Brand.*Used in 1 place$/ });
    expect(usage.asked.flat().sort()).toEqual([
      "color.brand",
      "color.text",
      "font-size.body",
      "space.4",
    ]);
  });

  it("shows nothing for a row not read yet, and no counts without the host's reads", async () => {
    const usage = host({ reaches: () => ({ "color.brand": reach(3) }) });
    const { unmount } = render(<Hosted usage={usage} />);
    await screen.findByRole("button", { name: /^Brand.*Used in 3 places$/ });
    expect(row(/^Text/).querySelector(".nx-vars__count")).toBeNull();
    unmount();
    render(<Hosted />);
    expect(document.querySelector(".nx-vars__count")).toBeNull();
    expect(row(/^Brand/).hasAttribute("data-counted")).toBe(false);
  });
});

describe("removing a variable nothing uses", () => {
  it("says so beside Remove, and Remove confirms as it always has", async () => {
    const onChange = vi.fn();
    const usage = host({ reaches: () => ({ "color.text": reach(0) }) });
    render(<Hosted usage={usage} onChange={onChange} />);
    const editor = await openEditor(/^Text.*Not used anywhere$/);
    expect(within(editor).getByText("Not used anywhere")).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      within(editor).getByText(/Any block using it loses that style/)
    ).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove Text" })
    );
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens.map(token => token.name)).not.toContain("color.text");
  });
});

describe("removing a variable in use", () => {
  it("keeps Remove pressable and opens why in place, with focus on the reason", async () => {
    const onChange = vi.fn();
    const usage = host({
      reaches: () => ({ "color.brand": reach(12, ["c-card", "c-hero"]) }),
      uses: USES,
    });
    render(<Hosted usage={usage} onChange={onChange} classes={[CARD]} />);
    const editor = await openEditor(/^Brand.*Used in 14 places$/);
    expect(within(editor).getByText("Used in 14 places")).toBeDefined();
    const remove = within(editor).getByRole("button", { name: "Remove" });
    // Not disabled: pressing it is how the author learns why.
    expect(remove.hasAttribute("disabled")).toBe(false);
    fireEvent.click(remove);

    const heading = within(editor).getByRole("heading", {
      name: "Brand can't be removed while it's in use.",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      within(editor).getByText(
        "It's used in 14 places, and they would lose this colour:"
      )
    ).toBeDefined();
    // No confirm, and nothing removed.
    expect(within(editor).queryByText(/Any block using it/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      within(editor).getByText(
        "Change those blocks and styles to another variable, or clear the value there, then remove Brand."
      )
    ).toBeDefined();
  });

  it("lists the places: pages and components as links, a shared style with what it sets", async () => {
    const openSharedStyle = vi.fn();
    const usage = host({
      reaches: () => ({ "color.brand": reach(2, ["c-card"]) }),
      uses: USES,
      hidden: 2,
      openSharedStyle,
    });
    render(<Hosted usage={usage} classes={[CARD]} />);
    const editor = await openEditor(/^Brand.*Used in 3 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));

    const home = await within(editor).findByRole("link", { name: "Homepage" });
    expect(home.getAttribute("href")).toBe(
      "/admin/collections/pages/p1/builder"
    );
    // A new tab, so the page open here keeps its undo history.
    expect(home.getAttribute("target")).toBe("_blank");
    expect(home.closest("li")?.textContent).toBe("Homepage · page");
    const header = within(editor).getByRole("link", { name: "Site header" });
    expect(header.closest("li")?.textContent).toBe("Site header · component");

    const card = within(editor).getByRole("button", { name: "Card" });
    expect(card.closest("li")?.textContent).toBe(
      "Card · shared style · sets text colour"
    );
    fireEvent.click(card);
    expect(openSharedStyle).toHaveBeenCalledWith("c-card");

    expect(within(editor).getByText("and 2 you can’t open")).toBeDefined();
  });

  it("names a block type's default style, with nowhere to open, and lists it in Show all", async () => {
    const button: VariableUse = {
      id: "core/button",
      title: "Button",
      collection: "",
      kind: "block-default",
    };
    const pages: VariableUse[] = Array.from({ length: 5 }, (_, at) => ({
      id: `p${String(at)}`,
      title: `Page ${String(at)}`,
      collection: "pages",
      kind: "pages",
    }));
    const usage = host({
      // Five pages and the Button's default style: six places.
      reaches: () => ({
        "color.brand": reach(5, [], true, ["core/button"]),
      }),
      // The block defaults come after the shared styles, before the pages,
      // so the Button is listed among the first five.
      uses: [button, ...pages],
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Brand.*Used in 6 places$/);
    expect(within(editor).getByText("Used in 6 places")).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      within(editor).getByRole("heading", {
        name: "Brand can't be removed while it's in use.",
      })
    ).toBeDefined();
    const item = await within(editor).findByText("Button");
    // Named, not a link or a button: there is no document to open.
    expect(item.tagName).toBe("SPAN");
    expect(within(editor).queryByRole("link", { name: "Button" })).toBeNull();
    expect(within(editor).queryByRole("button", { name: "Button" })).toBeNull();
    expect(item.closest("li")?.textContent).toBe(
      "Button · block default style"
    );
    const places = () =>
      editor.querySelectorAll(".nx-vars-refusal__uses li").length;
    expect(places()).toBe(5);
    fireEvent.click(within(editor).getByRole("button", { name: "Show all 6" }));
    expect(places()).toBe(6);
    expect(within(editor).getByText("Button").closest("li")?.textContent).toBe(
      "Button · block default style"
    );
  });

  it("names a shared style without a way to it when the host gives none", async () => {
    const usage = host({
      reaches: () => ({ "color.brand": reach(0, ["c-card"]) }),
      uses: USES.slice(0, 1),
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Brand.*Used in 1 place$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    const item = await within(editor).findByText("Card");
    expect(item.tagName).toBe("SPAN");
    // Without the site's styles, what it sets is not known.
    expect(item.closest("li")?.textContent).toBe(
      "Card · shared style · uses it"
    );
  });

  it("shows the first five places, then all of them", async () => {
    const many: VariableUse[] = Array.from({ length: 7 }, (_, at) => ({
      id: `p${String(at)}`,
      title: `Page ${String(at)}`,
      collection: "pages",
      kind: "pages",
    }));
    const usage = host({
      reaches: () => ({ "color.brand": reach(7) }),
      uses: many,
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Brand.*Used in 7 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    await within(editor).findByText("Page 0");
    const places = () =>
      editor.querySelectorAll(".nx-vars-refusal__uses li").length;
    expect(places()).toBe(5);
    fireEvent.click(within(editor).getByRole("button", { name: "Show all 7" }));
    expect(places()).toBe(7);
    expect(
      within(editor).queryByRole("button", { name: /Show all/ })
    ).toBeNull();
  });

  it("says what a size would lose, by the variable's kind", async () => {
    const usage = host({ reaches: () => ({ "space.4": reach(3) }) });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Space 4.*Used in 3 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      within(editor).getByText(
        "It's used in 3 places, and they would lose this size:"
      )
    ).toBeDefined();
  });
});

describe("removing a variable not counted yet", () => {
  it("says it may still be in use, and Count now counts, reads again, then confirms", async () => {
    let counted = false;
    const usage = host({
      reaches: () => ({ "color.text": reach(0, [], counted) }),
      mayCount: true,
      count: async () => {
        counted = true;
        return { kind: "counted", whole: true, counting: false };
      },
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Text.*No uses counted yet/);
    expect(within(editor).getByText("Counting where it's used…")).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    const heading = within(editor).getByRole("heading", {
      name: "Text can't be removed yet.",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      within(editor).getByText(
        "Some pages haven’t been counted, so it may still be in use."
      )
    ).toBeDefined();
    expect(within(editor).getByText(/usually a few seconds/)).toBeDefined();
    const readsBefore = usage.asked.length;

    fireEvent.click(within(editor).getByRole("button", { name: "Count now" }));
    // Counted, read again, and now unused: the confirm the author asked for.
    await within(editor).findByText(/Any block using it loses that style/);
    expect(usage.counted.count).toBe(1);
    expect(usage.asked.length).toBeGreaterThan(readsBefore);
    expect(
      within(editor).queryByRole("heading", { name: /can't be removed/ })
    ).toBeNull();
  });

  it("points at the site's background jobs where it cannot count now", async () => {
    const usage = host({
      reaches: () => ({ "color.text": reach(0, [], false) }),
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Text.*No uses counted yet/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      within(editor).getByText(
        /Pages are counted by the site's background jobs/
      )
    ).toBeDefined();
    expect(
      within(editor).getByRole("link", { name: "How background jobs run" })
    ).toBeDefined();
    expect(
      within(editor).queryByRole("button", { name: "Count now" })
    ).toBeNull();
  });
});

describe("a variable the site's code supplies", () => {
  it("keeps Reset alone, with no usage line", async () => {
    const supplied: SiteTokenSet = {
      tokens: [
        { name: "color.brand", kind: "color", values: { light: "#000000" } },
      ],
    };
    const usage = host({ reaches: () => ({ "color.brand": reach(4) }) });
    render(<Hosted usage={usage} supplied={supplied} />);
    const editor = await openEditor(/^Brand.*Used in 4 places$/);
    expect(within(editor).getByRole("button", { name: "Reset" })).toBeDefined();
    expect(within(editor).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(editor).queryByText("Used in 4 places")).toBeNull();
  });
});
