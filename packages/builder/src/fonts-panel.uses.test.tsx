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
    uses: async () => ({ items: [], page: 1, hasNextPage: false }),
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
    expect(within(open).queryByRole("list", { name: "Where it’s used" })).toBeNull();
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
  }: {
    onWrite: (tokens: SiteTokenSet) => void;
  }): React.JSX.Element {
    const [tokens, setTokens] = React.useState(TOKENS);
    return (
      <FontsPanel
        faces={[INTER, LORA]}
        tokens={tokens}
        onAddFace={async () => undefined}
        onTokensChange={next => {
          onWrite(next);
          setTokens(next);
        }}
      />
    );
  }

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
