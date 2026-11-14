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
  act,
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
  /** Each where-used read, by variable and page. */
  readonly pages: { identity: string; page: number }[];
}

/** Twenty places to a where-used page, as the route lists them. */
const PAGE = 20;

function host({
  reaches,
  uses = [],
  hidden = 0,
  mayCount = false,
  count,
  openSharedStyle,
  openLook,
  hold,
}: {
  reaches: () => Record<string, VariableReach>;
  /** The places using every variable, or each variable's by identity. */
  uses?: readonly VariableUse[] | Record<string, readonly VariableUse[]>;
  hidden?: number;
  mayCount?: boolean;
  count?: () => Promise<SharedStylesCount>;
  openSharedStyle?: (classId: string) => void;
  openLook?: VariablesAccess["openLook"];
  /** A page answered only once this settles, so a read in flight is seen. */
  hold?: { page: number; until: Promise<void> };
}): Host {
  const asked: string[][] = [];
  const counted = { count: 0 };
  const pages: { identity: string; page: number }[] = [];
  const now = reaches;
  const usesOf = (identity: string): readonly VariableUse[] =>
    Array.isArray(uses)
      ? uses
      : ((uses as Record<string, readonly VariableUse[]>)[identity] ?? []);
  return {
    asked,
    counted,
    pages,
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
    uses: async (identity, page): Promise<VariableUsesPage> => {
      pages.push({ identity, page });
      if (hold !== undefined && hold.page === page) await hold.until;
      const listed = usesOf(identity);
      return {
        items: listed.slice((page - 1) * PAGE, page * PAGE),
        total: listed.length,
        hidden,
        hasNext: listed.length > page * PAGE,
        complete: true,
      };
    },
    ...(count === undefined
      ? {}
      : {
          count: async () => {
            counted.count += 1;
            return count();
          },
        }),
    ...(openSharedStyle === undefined ? {} : { openSharedStyle }),
    ...(openLook === undefined ? {} : { openLook }),
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
  it("is the places, said in words to a screen reader and in the row's tooltip", async () => {
    const usage = host({
      reaches: () => ({
        "color.brand": reach(12, ["c-card", "c-hero"]),
        "color.text": reach(0),
        "font-size.body": reach(1),
        // A host answers for every variable asked, and a type size's row
        // waits for both of its halves before it is counted.
        "line-height.body": reach(0),
        "space.4": reach(2, [], false),
      }),
    });
    render(<Hosted usage={usage} />);
    const brand = await screen.findByRole("button", {
      name: /^Brand.*\. Used in 14 places$/,
    });
    const count = brand.querySelector(".nx-vars__count");
    expect(count?.textContent).toBe("14");
    expect(count?.hasAttribute("data-zero")).toBe(false);
    // Said by the row's tooltip, where keyboard users meet it too, not by a
    // title on the hidden count.
    expect(count?.hasAttribute("title")).toBe(false);
    await act(async () => {
      brand.focus();
    });
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Used in 14 places"
    );

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

  it("asks for each row's variable, and for a type size its line height too", async () => {
    const usage = host({ reaches: () => ({ "color.brand": reach(1) }) });
    render(<Hosted usage={usage} />);
    await screen.findByRole("button", { name: /^Brand.*Used in 1 place$/ });
    // The line height has no row of its own, and Remove takes it away with
    // its type size, so its usage is read beside the size's.
    expect(usage.asked.flat().sort()).toEqual([
      "color.brand",
      "color.text",
      "font-size.body",
      "line-height.body",
      "space.4",
    ]);
  });

  it("counts a type size's row by its size and its line height together", async () => {
    const usage = host({
      reaches: () => ({
        "font-size.body": reach(1),
        "line-height.body": reach(2, ["c-card"]),
      }),
    });
    render(<Hosted usage={usage} />);
    // 1 for the size, 3 for the line height: neither alone.
    const body = await screen.findByRole("button", {
      name: /^Body.*\. Used in 4 places$/,
    });
    expect(body.querySelector(".nx-vars__count")?.textContent).toBe("4");
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

describe("a row's count arriving", () => {
  it("keeps the row, and the keyboard's focus on it, as the count arrives", async () => {
    // The usage read answers only once released, so the row is focused while
    // it has no count yet. Wrapping the row in its count's tooltip only once
    // the count arrived replaced the row's button, and focus fell to the page:
    // an author who had tabbed to a row pressed Enter on nothing.
    let release: () => void = () => undefined;
    const answered = new Promise<void>(resolve => {
      release = resolve;
    });
    const inner = host({ reaches: () => ({ "color.brand": reach(3) }) });
    const usage: Host = {
      ...inner,
      usage: async (...asked) => {
        await answered;
        return inner.usage(...asked);
      },
    };
    render(<Hosted usage={usage} />);
    const before = row(/^Brand/);
    act(() => before.focus());
    expect(document.activeElement).toBe(before);

    await act(async () => {
      release();
      await answered;
    });
    const after = await screen.findByRole("button", {
      name: /^Brand.*Used in 3 places$/,
    });
    expect(after).toBe(before);
    expect(document.activeElement).toBe(before);
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
    // The row stays drawn as chosen while its editor is open, though its
    // tooltip marks `data-state` as well.
    expect(
      document
        .querySelector(".nx-vars__row[data-open]")
        ?.getAttribute("aria-label")
    ).toMatch(/^Brand/);
    const remove = within(editor).getByRole("button", { name: "Remove" });
    // Not disabled: pressing it is how the author learns why.
    expect(remove.hasAttribute("disabled")).toBe(false);
    fireEvent.click(remove);

    const heading = await within(editor).findByRole("heading", {
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
      await within(editor).findByRole("heading", {
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
    // Answered once Remove has read the counts again.
    expect(
      await within(editor).findByText(
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
    const heading = await within(editor).findByRole("heading", {
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
    // Answered once Remove has read the counts again.
    expect(
      await within(editor).findByText(
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

describe("removing a type size", () => {
  const sizeUse: VariableUse = {
    id: "p1",
    title: "Homepage",
    collection: "pages",
    kind: "pages",
  };
  const lineUse: VariableUse = {
    id: "p2",
    title: "Pricing",
    collection: "pages",
    kind: "pages",
  };

  it("refuses while only its line height is used, and lists the line height's places", async () => {
    const onChange = vi.fn();
    const usage = host({
      reaches: () => ({
        "font-size.body": reach(0),
        "line-height.body": reach(1),
      }),
      uses: { "line-height.body": [lineUse] },
    });
    render(<Hosted usage={usage} onChange={onChange} />);
    const editor = await openEditor(/^Body.*Used in 1 place$/);
    // Remove takes both away, so the line height's use is what it says.
    expect(within(editor).getByText("Used in 1 place")).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      await within(editor).findByRole("heading", {
        name: "Body can't be removed while it's in use.",
      })
    ).toBeDefined();
    expect(within(editor).queryByText(/Any block using it/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    const pricing = await within(editor).findByText("Pricing");
    expect(pricing.closest("li")?.textContent).toBe("Pricing · page");
    // Only the part in use is listed, and alone it needs no name. Asked of
    // the refusal: the editor's own field above it is labelled Line height.
    expect(usage.pages.map(read => read.identity)).toEqual([
      "line-height.body",
    ]);
    const refusal = within(editor).getByRole("region", {
      name: "Body can't be removed while it's in use.",
    });
    expect(within(refusal).queryByText("Line height")).toBeNull();
  });

  it("lists each part's places under its name when both are used", async () => {
    const usage = host({
      reaches: () => ({
        "font-size.body": reach(1),
        "line-height.body": reach(1),
      }),
      uses: { "font-size.body": [sizeUse], "line-height.body": [lineUse] },
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Body.*Used in 2 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(await within(editor).findByText("Homepage")).toBeDefined();
    expect(await within(editor).findByText("Pricing")).toBeDefined();
    // Asked of the refusal: the editor's own fields above it share the names.
    const refusal = within(editor).getByRole("region", {
      name: "Body can't be removed while it's in use.",
    });
    expect(within(refusal).getByText("Size")).toBeDefined();
    expect(within(refusal).getByText("Line height")).toBeDefined();
  });

  it("confirms as before once neither part is used", async () => {
    const usage = host({
      reaches: () => ({
        "font-size.body": reach(0),
        "line-height.body": reach(0),
      }),
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Body.*Not used anywhere$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      within(editor).getByText(/Any block using it loses that style/)
    ).toBeDefined();
  });
});

describe("a block look using a variable", () => {
  const PRIMARY: NamedClass = {
    id: "look-primary",
    slug: "primary",
    label: "Primary",
    orderIndex: 1,
    blockType: "core/button",
    styles: {
      base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } },
    },
  };
  const look: VariableUse = {
    id: "look-primary",
    title: "Primary",
    collection: "site-style",
    kind: "shared-style",
    blockType: "core/button",
  };

  it("names its block type and opens in the look editor, not Shared styles", async () => {
    const openLook = vi.fn();
    const openSharedStyle = vi.fn();
    const usage = host({
      reaches: () => ({ "color.brand": reach(0, ["look-primary"]) }),
      uses: [look],
      openLook,
      openSharedStyle,
    });
    render(<Hosted usage={usage} classes={[PRIMARY]} />);
    const editor = await openEditor(/^Brand.*Used in 1 place$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    const primary = await within(editor).findByRole("button", {
      name: "Primary",
    });
    const line = primary.closest("li")?.textContent ?? "";
    expect(line).toMatch(/^Primary · .+ look · sets text colour$/);
    expect(line).toContain("Button look");
    fireEvent.click(primary);
    expect(openLook).toHaveBeenCalledWith({
      id: "look-primary",
      blockType: "core/button",
    });
    // Shared styles lists no looks, so it is never sent there.
    expect(openSharedStyle).not.toHaveBeenCalled();
  });

  it("opens the look the route names by id and block type, when two types' own looks share an id", async () => {
    const own = (blockType: string): NamedClass => ({
      id: "look-default",
      slug: "default",
      label: "Default",
      orderIndex: 0,
      blockType,
      styles: {
        base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } },
      },
    });
    const place = (blockType: string): VariableUse => ({
      id: "look-default",
      title: "Default",
      collection: "site-style",
      kind: "shared-style",
      blockType,
    });
    const openLook = vi.fn();
    const usage = host({
      reaches: () => ({
        "color.brand": reach(0, ["look-default", "look-default"]),
      }),
      uses: [place("core/heading"), place("core/button")],
      openLook,
    });
    render(
      <Hosted
        usage={usage}
        classes={[own("core/heading"), own("core/button")]}
      />
    );
    const editor = await openEditor(/^Brand.*Used in/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    await within(editor).findByRole("heading", { name: /in use/ });
    const looks = await within(editor).findAllByRole("button", {
      name: "Default",
    });
    expect(looks).toHaveLength(2);
    const second = looks[1];
    expect(second?.closest("li")?.textContent).toContain("Button look");
    if (second !== undefined) fireEvent.click(second);
    // The second one, not the first of that id the library holds.
    expect(openLook).toHaveBeenCalledWith({
      id: "look-default",
      blockType: "core/button",
    });
  });

  it("is plain text where the host cannot edit a look", async () => {
    const usage = host({
      reaches: () => ({ "color.brand": reach(0, ["look-primary"]) }),
      uses: [look],
      openSharedStyle: vi.fn(),
    });
    render(<Hosted usage={usage} classes={[PRIMARY]} />);
    const editor = await openEditor(/^Brand.*Used in 1 place$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    const name = await within(editor).findByText("Primary");
    expect(name.tagName).toBe("SPAN");
    expect(
      within(editor).queryByRole("button", { name: "Primary" })
    ).toBeNull();
  });
});

describe("Show all", () => {
  const many = (count: number): VariableUse[] =>
    Array.from({ length: count }, (_, at) => ({
      id: `p${String(at)}`,
      title: `Page ${String(at)}`,
      collection: "pages",
      kind: "pages",
    }));

  it("reads every page that follows, saying how far it has got, until all are shown", async () => {
    let release = (): void => {};
    const until = new Promise<void>(resolve => {
      release = resolve;
    });
    const usage = host({
      reaches: () => ({ "color.brand": reach(45) }),
      uses: many(45),
      hold: { page: 2, until },
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Brand.*Used in 45 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    await within(editor).findByText("Page 0");
    const places = () =>
      editor.querySelectorAll(".nx-vars-refusal__uses li").length;
    expect(places()).toBe(5);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Show all 45" })
    );
    // The first page at once, and the second on its way, said as it reads.
    expect(places()).toBe(20);
    expect(await within(editor).findByText("Reading 20 of 45…")).toBeDefined();
    release();
    await waitFor(() => expect(places()).toBe(45));
    expect(usage.pages.map(read => read.page)).toEqual([1, 2, 3]);
    expect(within(editor).queryByText(/^Reading/)).toBeNull();
    // No more to ask for: every place is listed.
    expect(within(editor).queryByRole("button", { name: /more/ })).toBeNull();
  });
});

describe("a removal the save refuses", () => {
  /**
   * The panel with a host that refuses a save dropping Text, as the server
   * does for a variable in use: it puts the set back and says why. Text is
   * counted unused until the refusal, when the count catches up.
   */
  function Refusing({ usage }: { usage: VariablesAccess }): React.JSX.Element {
    const [tokens, setTokens] = React.useState(SITE);
    const [issue, setIssue] = React.useState<string | undefined>(undefined);
    const latest = React.useRef(tokens);
    return (
      <TokensPanel
        tokens={tokens}
        usage={usage}
        {...(issue === undefined ? {} : { issue })}
        currentTokens={() => latest.current}
        onChange={next => {
          setIssue(undefined);
          const drops = !next.tokens.some(token => token.name === "color.text");
          if (drops) {
            used.text = true;
            latest.current = SITE;
            setTokens(SITE);
            setIssue("Text is used on 1 page, so it can't be removed.");
            return;
          }
          latest.current = next;
          setTokens(next);
        }}
      />
    );
  }
  const used = { text: false };

  it("reads the usage again, so the next Remove says why it waits", async () => {
    used.text = false;
    const usage = host({
      reaches: () => ({ "color.text": used.text ? reach(1) : reach(0) }),
      uses: [
        { id: "p1", title: "Homepage", collection: "pages", kind: "pages" },
      ],
    });
    render(<Refusing usage={usage} />);
    let editor = await openEditor(/^Text.*Not used anywhere$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    // Taken before the press: the refused save reads again within it.
    const readsBefore = usage.asked.length;
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove Text" })
    );

    // The save refused: Text is read again, and its row catches up.
    await screen.findByRole("button", { name: /^Text.*Used in 1 place$/ });
    const again = usage.asked.slice(readsBefore).flat();
    expect(again).toContain("color.text");

    editor = await openEditor(/^Text.*Used in 1 place$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      await within(editor).findByRole("heading", {
        name: "Text can't be removed while it's in use.",
      })
    ).toBeDefined();
    expect(within(editor).queryByText(/Any block using it/)).toBeNull();
  });
});

describe("Remove on counts read earlier", () => {
  it("reads the variable again before refusing, and confirms when it is now unused", async () => {
    let fresh = false;
    const usage = host({
      // In use when first read; unused by the time Remove is pressed.
      reaches: () => ({ "color.text": fresh ? reach(0) : reach(2) }),
    });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Text.*Used in 2 places$/);
    fresh = true;
    const readsBefore = usage.asked.length;
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    // Reading again, said; no refusal from the counts read earlier.
    expect(within(editor).getByText("Checking where it's used…")).toBeDefined();
    expect(
      within(editor).queryByRole("heading", { name: /can't be removed/ })
    ).toBeNull();
    expect(
      await within(editor).findByText(/Any block using it loses that style/)
    ).toBeDefined();
    expect(usage.asked.slice(readsBefore).flat()).toEqual(["color.text"]);
    expect(
      within(editor).queryByRole("heading", { name: /can't be removed/ })
    ).toBeNull();
  });

  it("refuses on the fresh answer when it is still used", async () => {
    const usage = host({ reaches: () => ({ "color.text": reach(2) }) });
    render(<Hosted usage={usage} />);
    const editor = await openEditor(/^Text.*Used in 2 places$/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      await within(editor).findByRole("heading", {
        name: "Text can't be removed while it's in use.",
      })
    ).toBeDefined();
    expect(within(editor).queryByText(/Any block using it/)).toBeNull();
  });
});

describe("removing one half of a type size", () => {
  it("names the half that goes and what the places would lose with it", async () => {
    // The site's code supplies the size, unchanged; the line height is the
    // site's own, so Remove takes that half alone.
    const supplied: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px" },
        },
      ],
    };
    const usage = host({
      reaches: () => ({
        "font-size.body": reach(0),
        "line-height.body": reach(1),
      }),
    });
    render(<Hosted usage={usage} supplied={supplied} />);
    const editor = await openEditor(/^Body.*Used in 1 place$/);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove line height" })
    );
    expect(
      await within(editor).findByRole("heading", {
        name: "Body's line height can't be removed while it's in use.",
      })
    ).toBeDefined();
    expect(
      within(editor).getByText(
        "It's used in 1 place, and they would lose this line height:"
      )
    ).toBeDefined();
  });
});
