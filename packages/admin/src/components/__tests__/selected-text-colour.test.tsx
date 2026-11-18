/**
 * Selected states read under any brand: their words reach 4.5:1 on the tinted
 * fill that marks the selection, while the fill, border and ring keep the
 * brand's colour.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour. Drawn as the
 * words of a selected card or chip, on that same colour at 5%, the e2e suite's
 * indigo `#6366f1` reads under AA's 4.5:1 in both modes. Each case renders the
 * selected state, branded the way the admin's server stylesheet brands it,
 * then measures the colour each word's own class paints against its fill
 * composited over each surface it can sit on: the page, a card and a popover.
 *
 * jsdom computes no stylesheet, so the colours are resolved from the theme
 * file and the classes as written.
 *
 * @module components/__tests__/selected-text-colour.test
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, within } from "@testing-library/react";
import { getBrandingCss } from "nextly/config";
import { narrowFieldTypeCatalog } from "nextly/field-catalog";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  compositeOver,
  contrastRatio,
  type Rgb,
} from "../../../../ui/src/styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../../../../ui/src/styles/contrast/parse-theme";
import {
  applyOpacity,
  resolveColor,
  type ResolveContext,
} from "../../../../ui/src/styles/contrast/resolve";
import { FolderCardsRow } from "../features/media-library/FolderCardsRow";
import { HookConfigForm } from "../features/schema-builder/HooksEditor/HookConfigForm";
import { FieldTypePicker } from "../field-ui/FieldTypePicker";

// No shipped hook takes a list of choices yet, so the form is handed one that
// does: its chips are the selected state under test.
vi.mock("../features/schema-builder/HooksEditor/utils/prebuiltHooks", () => ({
  getPrebuiltHook: () => ({
    id: "notify",
    name: "Notify",
    description: "Notify on changes",
    hookType: "afterChange",
    category: "notification",
    configSchema: z.object({
      events: z
        .array(z.enum(["create", "update", "delete"]))
        .describe("Events to notify on"),
    }),
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(
  resolve(here, "../../../../ui/src/styles/theme.css"),
  "utf8"
);
const theme = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);

/** The e2e suite's brand: too light for small text on a light surface. */
const INDIGO = "#6366f1";

/** The declarations the admin's server stylesheet writes for the brand. */
const brandTokens: TokenMap = new Map(
  [
    ...(getBrandingCss({ colors: { primary: INDIGO } }) ?? "").matchAll(
      /(--nx-[\w-]+)\s*:\s*([^;]+);/g
    ),
  ].map(([, name, value]) => [name ?? "", (value ?? "").trim()])
);

const MODES: Record<"light" | "dark", ResolveContext> = {
  light: { tokens: new Map([...theme.light, ...brandTokens]), scale },
  dark: { tokens: new Map([...theme.dark, ...brandTokens]), scale },
};

/** The surfaces a selected card or chip can sit on. */
const SURFACES = ["background", "card", "popover"] as const;

/** AA for small text. */
const SMALL_TEXT = 4.5;

function bareClasses(element: Element): string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(name => name !== "" && !name.includes(":"));
}

/** The theme colour a `text-*` or `bg-*` class paints, with its opacity. */
function colourClass(
  element: Element,
  prefix: "text" | "bg"
): { token: string; opacity: number } | undefined {
  for (const name of bareClasses(element)) {
    const match = new RegExp(`^${prefix}-([a-z-]+)(?:/(\\d+))?$`).exec(name);
    const token = match?.[1];
    if (token && scale.has(`--color-${token}`)) {
      return { token, opacity: match?.[2] ? Number(match[2]) / 100 : 1 };
    }
  }
  return undefined;
}

function paint(
  { token, opacity }: { token: string; opacity: number },
  ctx: ResolveContext
): Rgb {
  return applyOpacity(resolveColor(`var(--color-${token})`, ctx), opacity);
}

/** The colour class of the element, or of its nearest ancestor with one. */
function nearestColour(
  element: Element,
  prefix: "text" | "bg"
): { token: string; opacity: number } {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const found = colourClass(at, prefix);
    if (found) return found;
  }
  throw new Error(`no ${prefix} colour on or above the element`);
}

/**
 * The contrast the words reach on the nearest fill behind them, over each
 * surface in each mode, lowest first, with the class they are painted with.
 */
function contrasts(words: HTMLElement): {
  textClass: string;
  measured: { ratio: number; where: string }[];
} {
  const text = nearestColour(words, "text");
  const fill = nearestColour(words, "bg");
  const measured = Object.entries(MODES).flatMap(([mode, ctx]) =>
    SURFACES.map(surface => {
      const ground = compositeOver(
        paint(fill, ctx),
        paint({ token: surface, opacity: 1 }, ctx)
      );
      const ink = compositeOver(paint(text, ctx), ground);
      return { ratio: contrastRatio(ink, ground), where: `${mode} ${surface}` };
    })
  );
  measured.sort((a, b) => a.ratio - b.ratio);
  return { textClass: `text-${text.token}`, measured };
}

function expectReadable(words: HTMLElement): void {
  const { textClass, measured } = contrasts(words);
  const [lowest] = measured;
  if (!lowest) throw new Error("nothing measured");
  const { ratio, where } = lowest;
  expect(
    ratio,
    `"${words.textContent}" in ${textClass} reads ${ratio.toFixed(2)}:1 on ${where}`
  ).toBeGreaterThanOrEqual(SMALL_TEXT);
}

function expectBrandMarks(element: Element, classes: string[]): void {
  const own = bareClasses(element);
  for (const name of classes) expect(own).toContain(name);
}

describe("selected states read under an indigo brand", () => {
  it("the media library's active folder card", () => {
    render(
      <FolderCardsRow
        folders={[
          {
            id: "f1",
            name: "Photos",
            createdBy: "u1",
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        ]}
        activeFolderId="f1"
        onFolderSelect={vi.fn()}
        onCreateSubfolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        openMenuId={null}
        onOpenMenuChange={vi.fn()}
      />
    );
    const name = screen.getByText("Photos");
    expectReadable(name);
    // The brand still marks the card: its tint and ring.
    const card = name.closest("button");
    if (!card) throw new Error("no card");
    expectBrandMarks(card, ["bg-primary/5", "ring-primary/20"]);
  });

  it("the field type picker's selected card", () => {
    const [entry] = narrowFieldTypeCatalog(["text"]);
    if (!entry) throw new Error("no catalog entry for text");
    render(
      <FieldTypePicker
        types={["text", "number"]}
        value="text"
        onChange={vi.fn()}
      />
    );
    const card = screen.getByRole("radio", { checked: true });
    expectReadable(within(card).getByText(entry.label));
    expectReadable(within(card).getByText(entry.hint));
    expectBrandMarks(card, ["border-primary", "bg-primary/5"]);
  });

  it("a hook's checked choice, and the unchecked ones beside it", () => {
    render(
      <HookConfigForm
        hookId="notify"
        config={{ events: ["create"] }}
        onConfigChange={vi.fn()}
        fieldNames={[]}
      />
    );
    const checked = screen.getByText("create");
    expectReadable(checked);
    expectBrandMarks(checked, ["bg-primary/5", "border-primary"]);
    expectReadable(screen.getByText("update"));
  });
});
