// @vitest-environment jsdom

/**
 * The fonts panel, driven as an author meets it.
 *
 * `font-library.test` asserts the rules; what is only true HERE is the wiring:
 * that a read still in flight is not drawn as a site with no fonts, that the
 * specimen carries the family it names so the substitution is VISIBLE rather
 * than described, and that the jump to the tokens studio appears only when the
 * host offers one.
 *
 * @module fonts-panel.test
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FontsPanel } from "./fonts-panel";
import type { FontFaceUpload } from "./fonts-panel";

afterEach(cleanup);

const face = (family: string): FontFaceDef => ({
  family,
  src: [{ url: "/fonts/f.woff2", format: "woff2" }],
});

const tokens: SiteTokenSet = {
  tokens: [
    {
      name: "brand.body",
      kind: "fontFamily",
      values: { light: "Brand, serif" },
    },
    { name: "brand.ui", kind: "fontFamily", values: { light: "system-ui" } },
  ],
};

describe("a fonts read that has not come back", () => {
  it("is drawn as loading, NOT as a site with no fonts", () => {
    // The third state. A site that self-hosts nothing legitimately has no
    // faces, and an author must not read "no font files" for a pending read.
    render(<FontsPanel faces={undefined} tokens={tokens} />);
    expect(screen.getByText("Loading fonts…")).toBeTruthy();
    expect(screen.queryByText(/loads no font files/)).toBeNull();
  });

  it("says a FAILED read failed, which is a different sentence", () => {
    render(<FontsPanel faces={undefined} tokens={tokens} absence="failed" />);
    expect(
      screen.getByText("This site's fonts could not be read.")
    ).toBeTruthy();
  });
});

describe("the panel over a site that has been read", () => {
  it("draws each specimen in the family it names", () => {
    // The prior-art finding: a list of typeface names set in the interface's
    // own font asks an author to choose a typeface from its name. Asserted on
    // the rendered style rather than on a prop, because the style IS the
    // affordance.
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    const specimens = screen.getAllByText(
      "Almost before we knew it, we had left the ground"
    );
    const families = specimens.map(el => el.style.fontFamily);
    expect(families).toContain('"Brand"');
    // The TOKEN specimen carries the whole stack, not just its first family.
    expect(families).toContain("Brand, serif");
  });

  it("reports the token whose first choice the site does not provide", () => {
    render(<FontsPanel faces={[]} tokens={tokens} />);
    expect(
      screen.getByText(
        /1 ask first for a typeface this site provides no file for/
      )
    ).toBeTruthy();
    expect(
      screen.getByText(/Brand is the typeface this token asks for first/)
    ).toBeTruthy();
  });

  it("stops reporting it once the site loads that face", () => {
    // The must-move half: same tokens, one face added. Without it the report
    // could be a constant.
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.queryByText(/ask first for a typeface/)).toBeNull();
    expect(
      screen.getByText(
        /none asking first for a typeface this site provides no file for/
      )
    ).toBeTruthy();
  });

  it("offers the jump to Tokens only when the host supplied one", () => {
    const onOpenTokens = vi.fn();
    const { rerender } = render(
      <FontsPanel faces={[]} tokens={tokens} onOpenTokens={onOpenTokens} />
    );
    expect(screen.getByRole("button", { name: "Edit in Tokens" })).toBeTruthy();

    rerender(<FontsPanel faces={[]} tokens={tokens} />);
    expect(screen.queryByRole("button", { name: "Edit in Tokens" })).toBeNull();
  });

  it("demonstrates each face with its OWN weight and style", () => {
    // Family alone selects the browser's normal upright face, so a site loading
    // regular and italic of one family would draw two identical specimens —
    // the list would then demonstrate the opposite of what it claims.
    const italic: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-i.woff2", format: "woff2" }],
      style: "italic",
      weight: "700",
    };
    render(
      <FontsPanel faces={[face("Brand"), italic]} tokens={{ tokens: [] }} />
    );
    const specimens = screen.getAllByText(
      "Almost before we knew it, we had left the ground"
    );
    expect(specimens.some(el => el.style.fontStyle === "italic")).toBe(true);
    expect(specimens.some(el => el.style.fontWeight === "700")).toBe(true);
  });

  it("keys subset faces apart rather than colliding them", () => {
    // Subsetting by `unicodeRange` is how a large script ships, and those faces
    // share family, weight and style by design. A key on those three alone
    // collides, and React cannot reconcile the rows.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const latin: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-latin.woff2", format: "woff2" }],
      unicodeRange: "U+0000-00FF",
    };
    const greek: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-greek.woff2", format: "woff2" }],
      unicodeRange: "U+0370-03FF",
    };
    render(<FontsPanel faces={[latin, greek]} tokens={{ tokens: [] }} />);
    const duplicateKey = warn.mock.calls.some(call =>
      String(call[0]).includes("same key")
    );
    warn.mockRestore();
    expect(duplicateKey).toBe(false);
  });

  it("draws a subset face with glyphs that face can actually render", () => {
    // A face limited to the Greek range covers none of the Latin sentence, so
    // the browser would draw the row from another subset or a fallback — the
    // row would claim to demonstrate a file whose glyphs are nowhere on screen.
    const greek: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-greek.woff2", format: "woff2" }],
      unicodeRange: "U+0370-03FF",
    };
    render(<FontsPanel faces={[greek]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Αλμοστ/)).toBeTruthy();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
  });

  it("keeps the Latin specimen for a face declaring no range", () => {
    render(<FontsPanel faces={[face("Brand")]} tokens={{ tokens: [] }} />);
    expect(
      screen.getByText("Almost before we knew it, we had left the ground")
    ).toBeTruthy();
  });

  it("expands a WILDCARD range rather than reading its leading digits", () => {
    // `U+4??` is `U+0400-04FF`. Read as a plain hex run it captures `4` alone,
    // which lands three orders of magnitude below the block it names and hands
    // a Cyrillic face the Latin sentence it cannot draw.
    const cyrillic: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-cyrillic.woff2", format: "woff2" }],
      unicodeRange: "U+4??",
    };
    render(<FontsPanel faces={[cyrillic]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Почти/)).toBeTruthy();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
  });

  it("refuses a sentence the range only PARTLY covers", () => {
    // A range opening in the Cyrillic block does not mean it reaches across it.
    // Two codepoints cannot draw a sentence, so the row falls back to glyphs
    // taken from the range itself rather than demonstrating a fallback font.
    const sliver: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-sliver.woff2", format: "woff2" }],
      unicodeRange: "U+0400-0401",
    };
    render(<FontsPanel faces={[sliver]} tokens={{ tokens: [] }} />);
    expect(screen.queryByText(/Почти/)).toBeNull();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
    expect(screen.getByText("\u0400\u0401")).toBeTruthy();
  });

  it("reads a comma-separated range as the union of its intervals", () => {
    /*
     * Split so that NEITHER interval covers the sentence alone: the Cyrillic
     * specimen opens with a capital, which lives in the first, and every other
     * letter lives in the second. A test whose first interval already covered
     * the whole sentence would pass while the parser silently discarded the
     * rest, which is the reading it exists to rule out.
     */
    const split: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-cyrillic.woff2", format: "woff2" }],
      unicodeRange: "U+0410-042F, U+0430-044F",
    };
    render(<FontsPanel faces={[split]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Почти/)).toBeTruthy();
  });

  it("samples glyphs that DRAW, not the C1 controls", () => {
    /*
     * `U+0080-00FF` covers no canned sentence, so the sampler starts at
     * U+0080 — and the thirty-two invisible C1 controls fill the whole budget
     * before reaching a single accented letter, leaving a specimen that
     * renders as nothing.
     */
    const latin1: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-latin1.woff2", format: "woff2" }],
      unicodeRange: "U+0080-00FF",
    };
    render(<FontsPanel faces={[latin1]} tokens={{ tokens: [] }} />);
    // Accented letters the face can actually demonstrate, rather than the
    // symbols the front of the interval opens with.
    expect(screen.getByText(/Æ/)).toBeTruthy();
    expect(screen.getByText(/Ð/)).toBeTruthy();
  });

  it("draws NOTHING for a face subset entirely to control characters", () => {
    /*
     * Separate from the case above, because striding alone already reaches the
     * letters in a wide interval — so that test cannot tell whether controls
     * are skipped. Here the whole interval is the C1 block: every codepoint is
     * non-printing, and the honest specimen is an empty one rather than a
     * string of invisible characters that merely LOOKS empty.
     */
    const controlsOnly: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-c1.woff2", format: "woff2" }],
      unicodeRange: "U+0080-009F",
    };
    const { container } = render(
      <FontsPanel faces={[controlsOnly]} tokens={{ tokens: [] }} />
    );
    const specimens = Array.from(
      container.querySelectorAll(".nx-fonts__specimen")
    );
    // The control: a selector matching nothing would satisfy the loop below
    // without ever reading a specimen.
    expect(specimens.length).toBeGreaterThan(0);
    for (const specimen of specimens) {
      expect(specimen.textContent).toBe("");
    }
  });

  it("refuses a range reaching past the end of Unicode", () => {
    // `validateFontFace` accepts `U+110000-110010` — it checks the characters,
    // not the numbers — and `String.fromCodePoint` throws above U+10FFFF, which
    // took the whole panel down rather than the one row.
    const impossible: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand.woff2", format: "woff2" }],
      unicodeRange: "U+110000-110010",
    };
    render(<FontsPanel faces={[impossible]} tokens={{ tokens: [] }} />);
    // It renders at all, and falls back to the sentence rather than sampling a
    // codepoint that does not exist.
    expect(
      screen.getByText("Almost before we knew it, we had left the ground")
    ).toBeTruthy();
  });

  it("says a site with no faces has none, rather than staying silent", () => {
    render(<FontsPanel faces={[]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/loads no font files of its own/)).toBeTruthy();
    expect(screen.getByText(/no typeface tokens yet/)).toBeTruthy();
  });
});

describe("adding a font file", () => {
  const woff2 = (name: string): File =>
    new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], name, {
      type: "font/woff2",
    });

  /** Choose a file the way a picker does, since jsdom has no picker. */
  async function chooseFile(file: File): Promise<void> {
    const input = screen.getByLabelText("Font file") as HTMLInputElement;
    // `configurable`, because a case that re-picks defines this twice on one
    // input — and a non-configurable property throws on the second, which reads
    // as the component refusing the file rather than the harness refusing.
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(input);
    });
  }

  it("offers NO control when the host cannot store a file", () => {
    /*
     * Absent rather than disabled. A host with no media pipeline cannot store
     * anything, and a greyed-out button is a promise that something is coming.
     */
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.queryByLabelText("Font file")).toBeNull();
    expect(screen.queryByRole("button", { name: /add font file/i })).toBeNull();
  });

  it("hands the host the file and the descriptors the author stated", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(
      <FontsPanel
        faces={[face("Brand")]}
        onAddFace={onAddFace}
        tokens={tokens}
      />
    );

    await chooseFile(woff2("Inter-BoldItalic.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "700" },
    });
    fireEvent.change(screen.getByLabelText("Style"), {
      target: { value: "italic" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).toHaveBeenCalledTimes(1);
    const request = onAddFace.mock.calls[0]?.[0];
    expect(request?.file.name).toBe("Inter-BoldItalic.woff2");
    // The family is prefilled from the stem; the weight and style are NOT
    // inferred from it, because a wrong one loads and silently matches nothing.
    expect(request?.family).toBe("Inter");
    expect(request?.weight).toBe("700");
    expect(request?.style).toBe("italic");
  });

  it("does not overwrite a family the author already typed", async () => {
    /*
     * The prefill is a convenience, and a convenience that discards typing is
     * not one. Re-picking a file is the ordinary way to correct a mistake.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    fireEvent.change(screen.getByLabelText("Family"), {
      target: { value: "Founders Grotesk" },
    });
    await chooseFile(woff2("Inter-Regular.woff2"));

    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Founders Grotesk"
    );
  });

  it("shows the host's refusal and KEEPS what the author entered", async () => {
    /*
     * A refusal an author can act on has to leave the thing being refused on
     * screen. Clearing the form would make the fix a re-entry.
     */
    const onAddFace = vi.fn(
      async (_request: FontFaceUpload) => "That file is not a font."
    );
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "That file is not a font."
    );
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Inter"
    );
  });

  it("REFRESHES an untouched family guess when the file changes", async () => {
    /*
     * Emptiness cannot tell a guess from a typed name. Reading "is it blank"
     * refused to overwrite the GUESS as well, so re-picking after choosing the
     * wrong file left the first file's family in place and would have stored
     * the second file's bytes under it.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Inter"
    );

    await chooseFile(woff2("Roboto-Regular.woff2"));
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Roboto"
    );
  });

  it("resets the CUT once a face is stored", async () => {
    /*
     * Adding a family means adding its regular, its bold and its italic in
     * turn. A retained `700 Italic` is applied to the NEXT file by default —
     * a face stored under a weight nobody chose, which loads and matches
     * nothing.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Bold.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "700" },
    });
    fireEvent.change(screen.getByLabelText("Style"), {
      target: { value: "italic" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect((screen.getByLabelText("Weight") as HTMLInputElement).value).toBe(
      "400"
    );
    expect((screen.getByLabelText("Style") as HTMLSelectElement).value).toBe(
      "normal"
    );
  });

  it("REFUSES a weight the browser would ignore, before uploading", async () => {
    /*
     * The `datalist` only suggests, and the stored-style validator checks these
     * descriptors for characters that would break the sheet rather than for the
     * `font-weight` grammar — so `70O` reached the sheet, the browser ignored
     * the descriptor, and the face was matched at a weight nobody chose while
     * the panel reported a successful add.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "70O" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/1 to 1000/);
  });

  it("accepts a variable RANGE, which is the form a menu cannot express", () => {
    // The control: a check that only allowed single numbers would refuse the
    // one form the free-text field exists for.
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "100 900" },
    });
    expect((screen.getByLabelText("Weight") as HTMLInputElement).value).toBe(
      "100 900"
    );
  });

  it("REFUSES a descending range, which is two valid weights and no range", async () => {
    /*
     * Every endpoint here passes a per-part check, which is why this is not
     * covered by the case above: the defect is the ORDER. A `font-weight`
     * descriptor requires the lighter endpoint first, so a browser drops the
     * whole declaration and matches the face at a weight nobody chose — the
     * same silent outcome as `70O`, reached from the other direction.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Variable.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "900 100" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).not.toHaveBeenCalled();
  });

  it("STORES the same pair the right way round", async () => {
    // The control for the case above: without it, "refuses 900 100" is also
    // satisfied by a check that refuses every range, which is the one form the
    // free-text field exists for.
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Variable.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "100 900" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).toHaveBeenCalledTimes(1);
    expect(onAddFace.mock.calls[0]?.[0].weight).toBe("100 900");
  });

  it("offers the file types the HOST accepts, not a list of its own", () => {
    /*
     * The panel cannot know which formats this site stores and serves, and a
     * list restated here drifts from the host's silently — a format the host
     * adds becomes one nobody can choose.
     */
    render(
      <FontsPanel
        acceptFiles=".woff2,font/woff2"
        faces={[]}
        onAddFace={async () => undefined}
        tokens={tokens}
      />
    );

    expect(screen.getByLabelText("Font file").getAttribute("accept")).toBe(
      ".woff2,font/woff2"
    );
  });

  it("clears the file and family once the host stored one", async () => {
    // The control for the case above: without it, "keeps the fields" is also
    // satisfied by a form that never clears them.
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      ""
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the add controls inside the entry editor's own form", () => {
  const woff2 = (name: string): File =>
    new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], name, {
      type: "font/woff2",
    });

  /**
   * The panel where the product puts it: inside a `<form>`.
   *
   * The wrapper is the mechanism under test, not scaffolding. `EntryFormProvider`
   * renders one around every field, so a panel rendered bare is a composition
   * the product never builds — and the defect these cases exist for is
   * invisible in it.
   */
  function renderInEntryForm(
    onAddFace: (r: FontFaceUpload) => Promise<string | undefined>
  ): {
    entrySubmitted: ReturnType<typeof vi.fn>;
  } {
    const entrySubmitted = vi.fn();
    render(
      <form
        onSubmit={event => {
          event.preventDefault();
          entrySubmitted();
        }}
      >
        <FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />
      </form>
    );
    return { entrySubmitted };
  }

  async function chooseFile(file: File): Promise<void> {
    const input = screen.getByLabelText("Font file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(input);
    });
  }

  it("builds NO form of its own, which HTML forbids here anyway", () => {
    /*
     * Asserted on the structure rather than on a behaviour, because the two
     * failures a nested form causes are reached by different routes — an
     * implicit submit from a keystroke, and a bubbling submit event — and both
     * come from the element existing.
     *
     * This case carries the keystroke route ON ITS OWN. jsdom does not
     * implement implicit form submission, so Enter in a text field raises no
     * submit event here however the markup is nested — measured: restoring the
     * nested form leaves the Enter case below GREEN, and only this assertion
     * and the click case move. A browser is where that route is observable,
     * which is what the `site-style` e2e covers; in this file the element's
     * absence is the evidence.
     */
    const { container } = render(
      <form>
        <FontsPanel
          faces={[]}
          onAddFace={async () => undefined}
          tokens={tokens}
        />
      </form>
    );

    expect(container.querySelectorAll("form")).toHaveLength(1);
  });

  it("adds the font when Enter is pressed, without saving the entry", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    const { entrySubmitted } = renderInEntryForm(onAddFace);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Family"), {
        key: "Enter",
      });
    });

    // Both halves matter. Adding without the second assertion is satisfied by
    // a panel that adds the font AND saves the document underneath it.
    expect(onAddFace).toHaveBeenCalledTimes(1);
    expect(entrySubmitted).not.toHaveBeenCalled();
  });

  it("does not save the entry when the Add button is pressed", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    const { entrySubmitted } = renderInEntryForm(onAddFace);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).toHaveBeenCalledTimes(1);
    expect(entrySubmitted).not.toHaveBeenCalled();
  });

  it("lets an IME keystroke through rather than taking Enter from it", async () => {
    /*
     * An author using an IME presses Enter to accept the candidate they are
     * part-way through typing. The browser does not submit on that keystroke,
     * so acting on it would add a font mid-word and make the field unusable in
     * Japanese, Chinese and Korean to prevent nothing.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    renderInEntryForm(onAddFace);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Family"), {
        key: "Enter",
        isComposing: true,
      });
    });

    expect(onAddFace).not.toHaveBeenCalled();
  });
});

describe("the faces this site loads", () => {
  it("groups the cuts of one family under its name", () => {
    /*
     * Adding a typeface means adding its regular, its bold and its italic, and
     * a flat list repeats the name down the panel while saying nothing about
     * which weights the family covers.
     */
    const brand = (weight: string, style?: string): FontFaceDef => ({
      family: "Brand",
      src: [{ url: `/fonts/${weight}${style ?? ""}.woff2`, format: "woff2" }],
      weight,
      ...(style !== undefined && { style }),
    });

    render(
      <FontsPanel
        faces={[brand("400"), brand("700"), brand("400", "italic")]}
        tokens={tokens}
      />
    );

    /*
     * Scoped to the faces section. The tokens section below names the same
     * family — that is the join this panel exists for — so an unscoped query
     * matches text this case is not about and would report two headings for a
     * grouping that produced one.
     */
    const listed = within(
      screen.getByRole("region", { name: "Font files this site loads" })
    );
    expect(listed.getAllByText("Brand")).toHaveLength(1);
    expect(listed.getByText("400")).toBeTruthy();
    expect(listed.getByText("700")).toBeTruthy();
    expect(listed.getByText("400 Italic")).toBeTruthy();
  });

  it("calls a face declaring neither weight nor style the Regular", () => {
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.getByText("Regular")).toBeTruthy();
  });
});

describe("what a cut label and a specimen say", () => {
  const cut = (weight?: string, style?: string): FontFaceDef => ({
    family: "Brand",
    src: [{ url: `/f/${weight ?? "x"}${style ?? ""}.woff2`, format: "woff2" }],
    ...(weight !== undefined && { weight }),
    ...(style !== undefined && { style }),
  });

  it("names a NON-italic slant rather than calling it Regular", () => {
    /*
     * `oblique` is a valid descriptor the specimen renders faithfully, so a row
     * labelled `Regular` beside visibly slanted letters contradicts the thing
     * it describes.
     */
    render(<FontsPanel faces={[cut(undefined, "oblique")]} tokens={tokens} />);
    const listed = within(
      screen.getByRole("region", { name: "Font files this site loads" })
    );
    expect(listed.getByText("Oblique")).toBeTruthy();
    expect(listed.queryByText("Regular")).toBeNull();
  });

  it("gives the specimen ONE weight when the face declares a range", () => {
    /*
     * `100 900` is valid in `@font-face` and invalid as an element's
     * `font-weight`: the browser drops the whole declaration and draws at its
     * normal weight, so a range excluding 400 would render the specimen in a
     * fallback while the row claims to demonstrate the file.
     */
    render(<FontsPanel faces={[cut("100 900")]} tokens={tokens} />);
    const specimen = screen
      .getByRole("region", { name: "Font files this site loads" })
      .querySelector(".nx-fonts__specimen") as HTMLElement;
    expect(specimen.style.fontWeight).toBe("400");
  });

  it("uses the range's lower bound when it does not reach 400", () => {
    // The control for the case above: a constant 400 would satisfy it while
    // naming a weight this face does not provide.
    render(<FontsPanel faces={[cut("500 900")]} tokens={tokens} />);
    const specimen = screen
      .getByRole("region", { name: "Font files this site loads" })
      .querySelector(".nx-fonts__specimen") as HTMLElement;
    expect(specimen.style.fontWeight).toBe("500");
  });

  it("groups two spellings of one family under a single heading", () => {
    /*
     * CSS resolves a family name case-insensitively, and `hostedFamilies`
     * already compares that way — two headings here would claim a split the
     * browser does not make.
     */
    render(
      <FontsPanel
        faces={[
          { family: "Brand", src: [{ url: "/a.woff2" }], weight: "400" },
          { family: "brand", src: [{ url: "/b.woff2" }], weight: "700" },
        ]}
        tokens={tokens}
      />
    );
    /*
     * The GROUP count, not a text match. `/^Brand$/` is case-sensitive, so it
     * matches one heading whether the panel drew one group or two — an
     * assertion that passes on the implementation it exists to reject.
     */
    const region = screen.getByRole("region", {
      name: "Font files this site loads",
    });
    expect(region.querySelectorAll(".nx-fonts__family-group")).toHaveLength(1);
    const listed = within(region);
    expect(listed.getByText("400")).toBeTruthy();
    expect(listed.getByText("700")).toBeTruthy();
  });
});
