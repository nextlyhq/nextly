// @vitest-environment jsdom

/**
 * The Fonts screen's words about where a font is used, and what follows from
 * them: each family's details name the Body and Headings fonts it is and how
 * many places use it through the site's font variables, each a link; Remove
 * refuses the Body or Headings font and names the fallback of every variable
 * that loses it; and a font that finishes adding asks how to use it, with a
 * toast that can take the answer back.
 *
 * @module fonts-panel.uses.test
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
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
import { afterEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

import { FontsPanel, type FontsPanelProps } from "./fonts-panel";
import { fontRoleSetting, withFontRole } from "./site-font-roles-model";
import type { VariableReach, VariablesAccess } from "./variable-usage";

afterEach(() => {
  cleanup();
  toasts.success.mockReset();
});

const file = (id: string) => [{ url: `/api/media/${id}/raw`, format: "woff2" }];
const INTER: FontFaceDef = {
  family: "Inter",
  src: file("a"),
  weight: "400",
  source: { kind: "upload" },
};
const LORA: FontFaceDef = {
  family: "Lora",
  src: file("b"),
  weight: "400",
  source: { kind: "upload" },
};

/** Two font variables naming Lora first, one naming nothing on the site. */
const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "font.display",
      label: "Display",
      kind: "fontFamily",
      values: { light: '"Lora", Georgia, serif' },
    },
    {
      name: "font.quote",
      label: "Quote",
      kind: "fontFamily",
      values: { light: '"Lora", serif' },
    },
    {
      name: "font.code",
      label: "Code",
      kind: "fontFamily",
      values: { light: "monospace" },
    },
  ],
};

/** A count as the usage index answers one, every page counted. */
function reach(documents: number, sharedStyles: string[] = []): VariableReach {
  return {
    documents,
    byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
    sharedStyles,
    blockDefaults: [],
    complete: true,
  };
}

/** The host's usage reads, answering from `counts` by identity. */
function access(counts: Record<string, VariableReach>): VariablesAccess {
  return {
    usage: async identities => ({
      whole: true,
      variables: new Map(
        identities.flatMap(identity => {
          const found = counts[identity];
          return found === undefined ? [] : [[identity, found] as const];
        })
      ),
    }),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  };
}

function panel(props: Partial<FontsPanelProps> = {}): void {
  render(
    <FontsPanel
      faces={[INTER, LORA]}
      tokens={TOKENS}
      onAddFace={async () => undefined}
      onRemoveFamily={async () => undefined}
      {...props}
    />
  );
}

async function details(family: string): Promise<HTMLElement> {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${family},`) })
  );
  return screen.findByRole("dialog", { name: family });
}

describe("where a font is used", () => {
  it("says it is the Body and the Headings font, each a link to its picker", async () => {
    const onOpenRole = vi.fn();
    const body = withFontRole(TOKENS, "body", '"Inter", sans-serif');
    panel({
      tokens: withFontRole(body, "heading", '"Inter", sans-serif'),
      onOpenRole,
    });
    const open = await details("Inter");
    const used = within(open).getByRole("list", { name: "Where it’s used" });
    fireEvent.click(within(used).getByRole("button", { name: "Body font" }));
    expect(onOpenRole).toHaveBeenLastCalledWith("body");
    fireEvent.click(
      within(used).getByRole("button", { name: "Headings font" })
    );
    expect(onOpenRole).toHaveBeenLastCalledWith("heading");
  });

  it("names a role without a link where nothing opens it", async () => {
    panel({ tokens: withFontRole(TOKENS, "body", '"Inter", sans-serif') });
    const open = await details("Inter");
    const used = within(open).getByRole("list", { name: "Where it’s used" });
    expect(used.textContent).toBe("Body font");
    expect(within(used).queryByRole("button")).toBeNull();
  });

  it("says how many places use it through its variables, as the Colours rows do, linking to them", async () => {
    const onOpenTokens = vi.fn();
    panel({
      usage: access({
        "font.display": reach(9, ["card"]),
        "font.quote": reach(2),
      }),
      onOpenTokens,
    });
    const open = await details("Lora");
    const count = await within(open).findByRole("button", {
      name: "Used in 12 places",
    });
    fireEvent.click(count);
    expect(onOpenTokens).toHaveBeenCalledTimes(1);
  });

  it("says nothing of places for a font no variable names", async () => {
    panel({ usage: access({ "font.display": reach(9) }) });
    const open = await details("Inter");
    expect(
      within(open).queryByRole("list", { name: "Where it’s used" })
    ).toBeNull();
  });
});

describe("removing a font in use", () => {
  it("refuses the Body or Headings font, and says to choose another first", async () => {
    const onRemoveFamily = vi.fn(async () => undefined);
    const onOpenRole = vi.fn();
    panel({
      tokens: withFontRole(TOKENS, "heading", '"Inter", sans-serif'),
      onRemoveFamily,
      onOpenRole,
    });
    const open = await details("Inter");
    fireEvent.click(within(open).getByRole("button", { name: "Remove" }));
    const refused = within(open).getByRole("group", {
      name: "Inter can’t be removed",
    });
    expect(refused.textContent).toContain(
      "Inter is your headings font. Choose another headings font first."
    );
    expect(
      within(open).queryByRole("button", { name: "Remove Inter" })
    ).toBeNull();
    fireEvent.click(
      within(refused).getByRole("button", { name: "Choose another font" })
    );
    expect(onOpenRole).toHaveBeenCalledWith("heading");
    expect(onRemoveFamily).not.toHaveBeenCalled();
  });

  it("lists the variables using it and what their text falls back to, then removes it once confirmed", async () => {
    const onRemoveFamily = vi.fn(async () => undefined);
    panel({
      usage: access({ "font.display": reach(3), "font.quote": reach(1) }),
      onRemoveFamily,
    });
    const open = await details("Lora");
    fireEvent.click(within(open).getByRole("button", { name: "Remove" }));
    const confirm = within(open).getByRole("group", { name: "Remove Lora" });
    expect(confirm.textContent).toContain(
      "Remove Lora? It’s used in 4 places. These variables will fall back:"
    );
    const fallbacks = within(confirm).getByRole("list");
    expect(
      within(fallbacks)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual([
      "Display falls back to “Georgia, serif”",
      "Quote falls back to “serif”",
    ]);
    await act(async () => {
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Remove Lora" })
      );
    });
    expect(onRemoveFamily).toHaveBeenCalledTimes(1);
  });
});

describe("using a font once it is added", () => {
  const woff2 = (name: string): File =>
    new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], name, {
      type: "font/woff2",
    });

  /** Upload a file named for `family`, as the upload editor takes one. */
  async function upload(family: string): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Add a font" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Add a font" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Upload a font file" })
    );
    const input = (await screen.findByLabelText(
      "Font file"
    )) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [woff2(`${family}.woff2`)],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(input);
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I have the right to use this font on the web",
      })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
  }

  /** The panel with a writer for the site's variables, re-drawn on each write. */
  function Writable({
    onWrite,
    initial = TOKENS,
    edits,
  }: {
    onWrite: (tokens: SiteTokenSet) => void;
    initial?: SiteTokenSet;
    /** Handed the way to write the variables, as another edit would. */
    edits?: (
      write: (next: (tokens: SiteTokenSet) => SiteTokenSet) => void
    ) => void;
  }): React.JSX.Element {
    const [tokens, setTokens] = React.useState(initial);
    // The site's faces as the host reads them back: an upload adds one, a
    // removal takes the family away.
    const [faces, setFaces] = React.useState<FontFaceDef[]>([INTER, LORA]);
    edits?.(next => setTokens(next));
    return (
      <FontsPanel
        faces={faces}
        tokens={tokens}
        onAddFace={async request => {
          setFaces(current => [
            ...current,
            { family: request.family, src: file("up"), weight: "400" },
          ]);
          return undefined;
        }}
        onRemoveFamily={async family => {
          setFaces(current =>
            current.filter(face => face.family.toLowerCase() !== family.key)
          );
          return undefined;
        }}
        onTokensChange={next => {
          onWrite(next);
          setTokens(next);
        }}
      />
    );
  }

  /** The last toast's Undo. */
  function undoLast(): void {
    const [, options] = toasts.success.mock.lastCall as [
      string,
      { action: { onClick: () => void } },
    ];
    act(() => options.action.onClick());
  }

  it("takes back only the role it set, leaving a later change to the other role", async () => {
    // Headings drawn in two fonts, so it is set back row by row.
    const mixed = withFontRole(TOKENS, "heading", '"Lora", serif');
    const initial: SiteTokenSet = {
      ...mixed,
      siteText: { ...mixed.siteText, h2: { fontFamily: "monospace" } },
    };
    const onWrite = vi.fn();
    let write:
      | ((next: (tokens: SiteTokenSet) => SiteTokenSet) => void)
      | undefined;
    render(
      <Writable
        onWrite={onWrite}
        initial={initial}
        edits={each => {
          write = each;
        }}
      />
    );
    expect(fontRoleSetting(initial, "heading")).toEqual({ kind: "mixed" });
    await upload("Brand");
    fireEvent.click(screen.getByRole("button", { name: "Headings" }));
    // Then Body is changed elsewhere, as the Type tab's picker would.
    act(() =>
      write?.(tokens => withFontRole(tokens, "body", '"Inter", sans-serif'))
    );
    undoLast();
    const undone = onWrite.mock.lastCall?.[0] as SiteTokenSet;
    expect(fontRoleSetting(undone, "body")).toEqual({
      kind: "set",
      stack: '"Inter", sans-serif',
    });
    expect(undone.siteText?.h2).toEqual({ fontFamily: "monospace" });
    expect(fontRoleSetting(undone, "heading")).toEqual({ kind: "mixed" });
  });

  it("puts a role's variable back whole on Undo, its dark value included", async () => {
    const initial: SiteTokenSet = {
      tokens: [
        ...TOKENS.tokens,
        {
          name: "font.body",
          kind: "fontFamily",
          values: { light: '"Inter", sans-serif', dark: '"Lora", serif' },
        },
      ],
      siteText: { body: { fontFamily: { $token: "font.body" } } },
    };
    const onWrite = vi.fn();
    render(<Writable onWrite={onWrite} initial={initial} />);
    await upload("Brand");
    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    undoLast();
    const undone = onWrite.mock.lastCall?.[0] as SiteTokenSet;
    expect(undone.tokens.find(token => token.name === "font.body")).toEqual({
      name: "font.body",
      kind: "fontFamily",
      values: { light: '"Inter", sans-serif', dark: '"Lora", serif' },
    });
    expect(undone.siteText).toEqual(initial.siteText);
  });

  it("closes the upload editor once a role is chosen, so the toast and the canvas are in reach", async () => {
    // The editor holds the rest of the screen, and the toast, inert while open.
    render(<Writable onWrite={vi.fn()} />);
    await upload("Brand");
    expect(
      screen.getByRole("dialog", { name: "Upload a font file" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Headings" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload a font file" })
      ).toBeNull()
    );
  });

  it("keeps the upload editor open for the next file on Not now", async () => {
    render(<Writable onWrite={vi.fn()} />);
    await upload("Brand");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Use Brand for:" })).toBeNull()
    );
    expect(
      screen.getByRole("dialog", { name: "Upload a font file" })
    ).toBeTruthy();
  });

  it("stops asking about a font once it is removed", async () => {
    const onWrite = vi.fn();
    render(<Writable onWrite={onWrite} />);
    await upload("Brand");
    // The upload editor closed with the question unanswered.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Use Brand for:" })).toBeTruthy()
    );
    const open = await details("Brand");
    fireEvent.click(within(open).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(
        within(open).getByRole("button", { name: "Remove Brand" })
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Use Brand for:" })).toBeNull()
    );
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("asks in place how to use it: Body, Headings, Both or Not now", async () => {
    render(<Writable onWrite={vi.fn()} />);
    await upload("Brand");
    const asked = screen.getByRole("group", { name: "Use Brand for:" });
    expect(
      within(asked)
        .getAllByRole("button")
        .map(button => button.textContent)
    ).toEqual(["Body", "Headings", "Both", "Not now"]);
  });

  it("sets the font it is used for at once, says so, and takes it back on Undo", async () => {
    const onWrite = vi.fn();
    render(<Writable onWrite={onWrite} />);
    await upload("Brand");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Use Brand for:" })).getByRole(
        "button",
        { name: "Headings" }
      )
    );
    const set = onWrite.mock.lastCall?.[0] as SiteTokenSet;
    expect(fontRoleSetting(set, "heading")).toEqual({
      kind: "set",
      stack: '"Brand", sans-serif',
    });
    expect(fontRoleSetting(set, "body")).toEqual({ kind: "unset" });
    expect(screen.queryByRole("group", { name: "Use Brand for:" })).toBeNull();
    const [words, options] = toasts.success.mock.lastCall as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(words).toBe("Brand is now your headings font");
    expect(options.action.label).toBe("Undo");
    act(() => options.action.onClick());
    const undone = onWrite.mock.lastCall?.[0] as SiteTokenSet;
    expect(fontRoleSetting(undone, "heading")).toEqual({ kind: "unset" });
  });

  it("sets both for Both", async () => {
    const onWrite = vi.fn();
    render(<Writable onWrite={onWrite} />);
    await upload("Brand");
    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    const set = onWrite.mock.lastCall?.[0] as SiteTokenSet;
    expect(fontRoleSetting(set, "body")).toMatchObject({ kind: "set" });
    expect(fontRoleSetting(set, "heading")).toMatchObject({ kind: "set" });
    expect(toasts.success.mock.lastCall?.[0]).toBe(
      "Brand is now your body and headings font"
    );
  });

  it("changes nothing for Not now", async () => {
    const onWrite = vi.fn();
    render(<Writable onWrite={onWrite} />);
    await upload("Brand");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Use Brand for:" })).toBeNull()
    );
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("asks nothing where the host cannot write the site's fonts", async () => {
    panel();
    await upload("Brand");
    expect(screen.queryByRole("group", { name: "Use Brand for:" })).toBeNull();
  });
});
