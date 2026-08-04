/**
 * Site tokens and font faces: what a site defines once and every page reads.
 *
 * A token is a NAME the styling layer already knows how to reference —
 * `tokenCustomProperty` turns `color.primary` into `--site-color-primary`, and
 * the catalog decides which properties may hold which kind. What was missing
 * was the other half: the table those names resolve in, and the CSS that makes
 * them resolve at all.
 *
 * ## Names are dot paths; the CSS prefix is applied at emission
 *
 * `color.primary`, `space.4`, `content.width`. The prefix is the site's choice
 * (`--site-` by default) and is validated rather than trusted, because two of
 * them are reserved: `--nx-` is the admin's own namespace and `--tw-` is
 * Tailwind's internals. A site that took either would restyle surfaces it does
 * not own.
 *
 * ## Modes are in the model from the start
 *
 * Not because dark mode is being built here, but because retrofitting a second
 * value onto a one-value token is a data migration, and adding it now costs one
 * optional field. What activates a mode is the HOST's decision — it owns the
 * document, and it may already have a theme toggle — so this emits the values
 * under a strategy and takes no position on who flips it.
 *
 * @module style/site-tokens
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
import { checkUrlValue } from "./css-value";
import { DEFAULT_TOKEN_PREFIX, tokenCustomProperty } from "./declarations";

/** The modes a token may carry a value for. */
export type TokenMode = "light" | "dark";

export const TOKEN_MODES: readonly TokenMode[] = ["light", "dark"];

/**
 * How a dark-mode token block is made to apply.
 *
 * `attribute` is the default because it is the only one the site can control:
 * a host with a theme toggle sets `data-nx-theme="dark"` and the values follow.
 * `media` follows the operating system instead, which is right for a site with
 * no toggle and wrong for one that has it — hence a choice rather than a
 * constant.
 */
export type DarkModeStrategy = "attribute" | "media";

/** One site token: a name, what kind of value it holds, and that value. */
export interface SiteToken {
  /** Dot-path name, as authors read and write it. */
  name: string;
  kind: TokenKind;
  /**
   * The value for each mode.
   *
   * `light` is required and is what a document with no mode resolves — a token
   * defined only for dark would vanish for every reader who never turns it on.
   */
  values: { light: string; dark?: string };
  /** Author-facing note, carried through DTCG import/export. */
  description?: string;
}

/** Everything a site defines for its pages to read. */
export interface SiteTokenSet {
  tokens: readonly SiteToken[];
  /** Custom-property prefix; `--site-` when unset. */
  prefix?: string;
  darkMode?: DarkModeStrategy;
}

/** One file a font face can be loaded from. */
export interface FontSource {
  /**
   * A path on this site. Absolute-with-host is refused — see
   * {@link validateFontFace}.
   */
  url: string;
  /** `woff2`, `woff`, … Emitted as `format(…)` when present. */
  format?: string;
}

/** A `@font-face` a site self-hosts. */
export interface FontFaceDef {
  family: string;
  src: readonly FontSource[];
  weight?: string;
  style?: string;
  /** Defaults to `swap`: text is readable while the file loads. */
  display?: string;
  unicodeRange?: string;
}

/**
 * The attribute a host sets to activate dark values.
 *
 * Named rather than themed: it says what it selects and belongs to no design
 * system, so a host wiring its own toggle to it is not adopting anything else.
 */
export const DARK_MODE_ATTRIBUTE = "data-nx-theme";

/**
 * Prefixes a site may not take.
 *
 * `--nx-` is the admin's own; `--tw-` is Tailwind's internals. Either would let
 * a site's token silently restyle surfaces the site does not own — the admin
 * panel around the editor, or the utility classes a host's own markup uses.
 */
const RESERVED_PREFIXES = ["--nx-", "--tw-"];

const PREFIX_SHAPE = /^--[a-z0-9-]*$/;

/**
 * The prefix to emit under, with a reason when the requested one is refused.
 *
 * A refused prefix falls back rather than throwing, in keeping with the rest of
 * the compiler: one bad setting should cost the site its naming choice, not its
 * stylesheet.
 */
export function resolveTokenPrefix(prefix: string | undefined): {
  prefix: string;
  issue?: ValidationIssue;
} {
  if (prefix === undefined) return { prefix: DEFAULT_TOKEN_PREFIX };
  if (!PREFIX_SHAPE.test(prefix)) {
    return {
      prefix: DEFAULT_TOKEN_PREFIX,
      issue: tokenIssue(
        `"${prefix}" is not a custom-property prefix, so tokens were written under "${DEFAULT_TOKEN_PREFIX}". A prefix starts with "--" and holds only lowercase letters, digits and dashes.`
      ),
    };
  }
  const reserved = RESERVED_PREFIXES.find(value => prefix.startsWith(value));
  if (reserved !== undefined) {
    return {
      prefix: DEFAULT_TOKEN_PREFIX,
      issue: tokenIssue(
        `"${prefix}" starts with "${reserved}", which is reserved, so tokens were written under "${DEFAULT_TOKEN_PREFIX}" instead. Tokens under that prefix would change the ${reserved === "--nx-" ? "admin interface" : "Tailwind internals"} as well as this site.`
      ),
    };
  }
  return { prefix };
}

function tokenIssue(
  message: string,
  severity: ValidationIssue["severity"] = "warning"
): ValidationIssue {
  return { path: "siteTokens", code: "invalid-style-value", severity, message };
}

/**
 * The tokens a site starts with.
 *
 * Deliberately small. Every entry here is one an author would otherwise have to
 * invent before the system does anything for them, and `content.width` is the
 * one that earns its place loudest: the Container preset reads it, so editing
 * one token re-widths every container on the site. A default set that tried to
 * be a design system would be a set most sites delete.
 */
export function defaultSiteTokens(): SiteToken[] {
  return [
    {
      name: "content.width",
      kind: "dimension",
      values: { light: "72rem" },
      description: "How wide a centred container may grow.",
    },
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111827", dark: "#f9fafb" },
    },
    {
      name: "color.background",
      kind: "color",
      values: { light: "#ffffff", dark: "#0b0f19" },
    },
    {
      name: "color.primary",
      kind: "color",
      values: { light: "#2563eb", dark: "#60a5fa" },
    },
    { name: "font.body", kind: "fontFamily", values: { light: "system-ui" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ];
}

/**
 * A font face a site may actually serve, or the reasons it may not.
 *
 * Self-hosted only, and this is a product rule rather than a technical one: a
 * `@font-face` pointing at somebody else's server makes every visitor's browser
 * announce itself to that server, with their IP address, before a word of the
 * page is readable. A German court found exactly that arrangement unlawful for
 * Google Fonts, so a site cannot be handed a text box that quietly recreates
 * it. The remedy is to upload the file, which is why the message says so.
 */
export function validateFontFace(
  face: FontFaceDef,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (message: string): void => {
    issues.push({
      path,
      code: "invalid-style-value",
      severity: "error",
      message,
    });
  };

  if (face.family.trim() === "") fail("A font needs a family name.");
  if (face.src.length === 0) {
    fail(`"${face.family}" has no font file to load.`);
  }

  for (const source of face.src) {
    const rejection = checkUrlValue(source.url, "raw");
    if (rejection !== null) {
      fail(`"${face.family}" has a font file URL that cannot be used.`);
      continue;
    }
    if (!isSameOriginUrl(source.url)) {
      fail(
        `"${face.family}" loads a font from "${source.url}", which is on another server. Upload the font file to this site and point it at a path here — a font fetched from elsewhere tells that server every visitor's IP address before the page can be read.`
      );
    }
  }

  return issues;
}

/**
 * Whether a URL stays on the site serving the page.
 *
 * A path, with or without a leading slash, and nothing carrying a scheme or an
 * authority. `//host/f.woff2` is refused with the rest: it names another server
 * while looking like a path, which is the whole reason it is worth naming here.
 */
function isSameOriginUrl(url: string): boolean {
  const value = url.trim();
  if (value === "") return false;
  if (value.startsWith("//")) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/**
 * The `@font-face` rules for the faces that passed validation.
 *
 * A face with any error contributes nothing: half a `@font-face` — a family
 * declaring a file the browser will not fetch — renders as the default font
 * rather than as the next family the author listed, so emitting it would be
 * worse than leaving it out.
 */
export function emitFontFaces(faces: readonly FontFaceDef[]): {
  css: string;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const blocks: string[] = [];

  faces.forEach((face, index) => {
    const faceIssues = validateFontFace(face, `fonts[${index}]`);
    issues.push(...faceIssues);
    if (faceIssues.length > 0) return;

    const src = face.src
      .map(source =>
        source.format === undefined || source.format === ""
          ? `url("${source.url}")`
          : `url("${source.url}") format("${source.format}")`
      )
      .join(",");

    const parts = [
      `font-family:"${face.family}"`,
      `src:${src}`,
      `font-display:${face.display ?? "swap"}`,
    ];
    if (face.weight !== undefined) parts.push(`font-weight:${face.weight}`);
    if (face.style !== undefined) parts.push(`font-style:${face.style}`);
    if (face.unicodeRange !== undefined) {
      parts.push(`unicode-range:${face.unicodeRange}`);
    }
    blocks.push(`@font-face{${parts.join(";")}}`);
  });

  return { css: blocks.join(""), issues };
}

/**
 * The custom-property blocks a site's tokens resolve in.
 *
 * Emitted onto a selector the caller supplies rather than `:root`, so a page's
 * tokens reach the page and stop there. Writing them at the document root would
 * make a site's values apply to a host's own markup, which is the collision
 * this styling layer spends its effort avoiding everywhere else.
 *
 * The dark block is only written when some token actually differs in dark. An
 * empty block is not free: it is a selector a host reads in devtools and takes
 * for a place where something should be happening.
 */
export function emitTokenBlocks(
  set: SiteTokenSet,
  selector: string
): { css: string; issues: ValidationIssue[] } {
  const { prefix, issue } = resolveTokenPrefix(set.prefix);
  const issues: ValidationIssue[] = issue ? [issue] : [];

  const light: string[] = [];
  const dark: string[] = [];
  const seen = new Map<string, string>();

  for (const token of set.tokens) {
    const property = tokenCustomProperty(token.name, prefix);
    // Two names can land on one property — `color.primary-dark` and
    // `color-primary.dark` both give `--site-color-primary-dark`. Emitting both
    // would let one silently resolve to the other's value, so the second is
    // refused and named.
    const previous = seen.get(property);
    if (previous !== undefined) {
      issues.push(
        tokenIssue(
          `"${token.name}" and "${previous}" both become "${property}", so "${token.name}" was not written. Rename one of them.`
        )
      );
      continue;
    }
    seen.set(property, token.name);

    light.push(`${property}:${token.values.light}`);
    if (token.values.dark !== undefined) {
      dark.push(`${property}:${token.values.dark}`);
    }
  }

  if (light.length === 0) return { css: "", issues };

  let css = `${selector}{${light.join(";")}}`;
  if (dark.length > 0) {
    const body = `${selector}{${dark.join(";")}}`;
    css +=
      (set.darkMode ?? "attribute") === "media"
        ? `@media (prefers-color-scheme:dark){${body}}`
        : `[${DARK_MODE_ATTRIBUTE}="dark"] ${body}`;
  }
  return { css, issues };
}
