/**
 * The sign-in pages' links, and the media picker's link to the library, read
 * under any brand: their words reach AA's 4.5:1 for small text on every
 * surface they sit on, in light and dark, and they are underlined at rest, so
 * they read as links without relying on colour.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour. These links
 * drew their words in it, and under the e2e suite's indigo `#6366f1` that is
 * 4.35:1 on the light page, under the 4.5:1 axe's `color-contrast` asks. The
 * words take the text colour instead, as the admin's other small links do;
 * the brand keeps the fills, borders and rings it was made for.
 *
 * jsdom computes no stylesheet, so the colour a class paints is resolved from
 * the theme file, with the brand declared the way the admin's server
 * stylesheet declares it. Most of these links sit on pages reached only after
 * a server answers (a sent reset link, a verified email), so every link in
 * those files is read from its source; the sign-in page's offer to sign up is
 * also rendered, so the classes read are the classes drawn.
 *
 * @module components/__tests__/brand-link-words.test
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, waitFor } from "@testing-library/react";
import { getBrandingCss } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetSetupStatusCache } from "@admin/lib/auth/setup-status";

import {
  contrastRatio,
  compositeOver,
} from "../../../../ui/src/styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../../../../ui/src/styles/contrast/parse-theme";
import {
  resolveColor,
  type ResolveContext,
} from "../../../../ui/src/styles/contrast/resolve";
import { Login } from "../features/auth-login";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
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

/** The surfaces these links sit on: the page, a card and a dialog. */
const SURFACES = ["background", "card", "popover"] as const;

/** AA for small text. */
const SMALL_TEXT = 4.5;

/** The class names that apply at rest, without a state or breakpoint. */
function restingClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .filter(name => name !== "" && !name.includes(":"));
}

/** The theme colour token the words' `text-*` class paints. */
function wordsToken(classes: string[]): string {
  for (const name of classes) {
    const token = /^text-([a-z-]+)$/.exec(name)?.[1];
    if (token && scale.has(`--color-${token}`)) return token;
  }
  throw new Error(`no theme text colour in "${classes.join(" ")}"`);
}

/** The lowest ratio the words reach, and where. */
function lowestContrast(classes: string[]): { ratio: number; where: string } {
  const token = wordsToken(classes);
  const measured = Object.entries(MODES).flatMap(([mode, ctx]) =>
    SURFACES.map(surface => {
      const ground = resolveColor(`var(--color-${surface})`, ctx);
      const ink = compositeOver(
        resolveColor(`var(--color-${token})`, ctx),
        ground
      );
      return { ratio: contrastRatio(ink, ground), where: `${mode} ${surface}` };
    })
  );
  measured.sort((a, b) => a.ratio - b.ratio);
  const [lowest] = measured;
  if (!lowest) throw new Error("nothing measured");
  return lowest;
}

function expectReadableLink(className: string, what: string): void {
  const classes = restingClasses(className);
  const { ratio, where } = lowestContrast(classes);
  expect(
    ratio,
    `${what} in text-${wordsToken(classes)} reads ${ratio.toFixed(2)}:1 on ${where}`
  ).toBeGreaterThanOrEqual(SMALL_TEXT);
  // Told from the words around it by more than colour.
  expect(classes, `${what} is not underlined at rest`).toContain("underline");
}

/** The links each file draws, and how many, so a missed one is noticed. */
const LINK_FILES: Record<string, number> = {
  "../features/auth-login/index.tsx": 2,
  "../features/auth-forgot-password/index.tsx": 2,
  "../features/auth-reset-password/index.tsx": 3,
  "../features/auth-signup/index.tsx": 2,
  "../features/auth-verify-email/index.tsx": 3,
  "../features/auth-accept-invite/index.tsx": 3,
  "../features/media-library/MediaPickerDialog/index.tsx": 2,
};

/** Each `<Link>` or `<a>` in a source file, with its literal class list. */
function linksIn(source: string): { className: string; at: string }[] {
  return [
    ...source.matchAll(/<(?:Link|a)\s(?:[^<>]|=>)*?className="([^"]*)"/g),
  ].map(match => ({
    className: match[1] ?? "",
    at: `line ${source.slice(0, match.index).split("\n").length}`,
  }));
}

describe("links drawn on the sign-in pages and in the media picker", () => {
  for (const [file, count] of Object.entries(LINK_FILES)) {
    it(`read under an indigo brand: ${file.replace("../features/", "")}`, () => {
      const source = readFileSync(resolve(here, file), "utf8");
      const links = linksIn(source);
      expect(links).toHaveLength(count);
      for (const { className, at } of links) {
        expectReadableLink(className, `the link at ${at}`);
      }
    });
  }
});

describe("the sign-in page's offer to sign up, as drawn", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    resetSetupStatusCache();
  });

  it("reads under an indigo brand", async () => {
    get.mockImplementation(async (path: string) =>
      path === "/auth/setup-status"
        ? { isSetup: true, allowRegistration: true }
        : {
            providers: [],
            challengeViews: {},
            slots: { beforeForm: [], afterForm: [], branding: [] },
          }
    );
    render(<Login />);
    const link = await waitFor(() =>
      screen.getByRole("link", { name: "Sign up" })
    );
    expectReadableLink(link.getAttribute("class") ?? "", "Sign up");
  });
});
