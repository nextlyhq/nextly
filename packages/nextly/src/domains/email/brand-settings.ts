/**
 * Brand settings: how the emails that use core's default layout look.
 *
 * A logo and its width, an accent colour, the email's background and content
 * colours, a font from an email-safe list, and footer text and links. Core's
 * default layout is written in them, and every layout can read them as the
 * `brand` variable.
 *
 * Each setting starts from what the default layout showed before it had
 * settings: the starting values render that layout byte for byte, so no
 * email changes until someone changes a setting. A setting stored as null is
 * its starting value, which is also how a site that never saved any reads.
 *
 * @module domains/email/brand-settings
 */

import { z } from "zod";

import {
  markHtml,
  renderLiquid,
  type TrustedHtml,
} from "./services/liquid-engine";
import { escapeHtml } from "./services/template-engine";

// ============================================================
// Email-safe fonts
// ============================================================

/**
 * The fonts a brand can use: stacks that every major mail client renders,
 * each ending in a generic family for the clients that have none of the rest.
 * The first is the stack the default layout used before brand settings.
 *
 * A setting names a font by its key and never carries a stack, so what is
 * written into an email's styles always comes from this list.
 */
export const EMAIL_SAFE_FONTS = [
  {
    key: "system",
    label: "System",
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  { key: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  {
    key: "helvetica",
    label: "Helvetica",
    stack: "Helvetica, Arial, sans-serif",
  },
  { key: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { key: "tahoma", label: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
  {
    key: "trebuchet",
    label: "Trebuchet MS",
    stack: "'Trebuchet MS', 'Lucida Grande', Tahoma, sans-serif",
  },
  {
    key: "georgia",
    label: "Georgia",
    stack: "Georgia, 'Times New Roman', Times, serif",
  },
  {
    key: "times",
    label: "Times New Roman",
    stack: "'Times New Roman', Times, Georgia, serif",
  },
  {
    key: "courier",
    label: "Courier New",
    stack: "'Courier New', Courier, monospace",
  },
] as const;

export type EmailSafeFontKey = (typeof EMAIL_SAFE_FONTS)[number]["key"];

const FONT_KEYS = EMAIL_SAFE_FONTS.map(font => font.key) as [
  EmailSafeFontKey,
  ...EmailSafeFontKey[],
];

function fontStack(key: EmailSafeFontKey): string {
  return (
    EMAIL_SAFE_FONTS.find(font => font.key === key) ?? EMAIL_SAFE_FONTS[0]
  ).stack;
}

// ============================================================
// Settings
// ============================================================

/** A footer link: what it says and where it goes. */
export interface BrandLink {
  label: string;
  url: string;
}

/** The brand settings as a render reads them, every one resolved. */
export interface BrandSettings {
  /** An absolute http(s) URL of the logo, or null for no logo. */
  logoUrl: string | null;
  /** The logo's width in pixels. */
  logoWidth: number;
  /** Links and, in written emails, buttons. */
  accentColor: string;
  /** Behind the content. */
  backgroundColor: string;
  /** The content's own background. */
  contentColor: string;
  fontFamily: EmailSafeFontKey;
  /**
   * The footer's text, or null for the standard line ("© {year} {site name}.
   * All rights reserved."). An empty string leaves the line empty.
   */
  footerText: string | null;
  footerLinks: BrandLink[];
}

/**
 * The starting values: what the default layout showed before brand settings.
 * The accent is the colour of the buttons in core's built-in emails.
 */
export const STARTING_BRAND: Readonly<BrandSettings> = Object.freeze({
  logoUrl: null,
  logoWidth: 120,
  accentColor: "#18181b",
  backgroundColor: "#f4f4f5",
  contentColor: "#ffffff",
  fontFamily: "system",
  footerText: null,
  footerLinks: [],
});

/** Absolute http(s) only: a mail client has no page to resolve a relative URL against. */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A link may also open the reader's mail client. */
function isLinkUrl(value: string): boolean {
  if (isWebUrl(value)) return true;
  try {
    return new URL(value).protocol === "mailto:";
  } catch {
    return false;
  }
}

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, such as #18181b.")
  .transform(value => value.toLowerCase());

/** Each setting's own rule, shared by what a request may write and what a read accepts. */
const FIELD_SCHEMAS = {
  logoUrl: z
    .string()
    .max(2048)
    .refine(isWebUrl, "Use an absolute http or https URL."),
  logoWidth: z.number().int().min(16).max(600),
  accentColor: hexColor,
  backgroundColor: hexColor,
  contentColor: hexColor,
  fontFamily: z.enum(FONT_KEYS),
  footerText: z.string().max(500),
  footerLinks: z
    .array(
      z
        .object({
          label: z.string().trim().min(1).max(100),
          url: z
            .string()
            .max(2048)
            .refine(isLinkUrl, "Use an http, https or mailto URL."),
        })
        .strict()
    )
    .max(10),
} satisfies Record<keyof BrandSettings, z.ZodTypeAny>;

/**
 * A change to the brand settings: any of them, each a value or null to return
 * it to its starting value. A key it does not name is refused.
 */
export const brandSettingsUpdateSchema = z
  .object(nullableEach(FIELD_SCHEMAS))
  .partial()
  .strict();

/** Each rule, also accepting null. Derived, so a setting added above is writable. */
function nullableEach<T extends Record<string, z.ZodTypeAny>>(
  shape: T
): { [K in keyof T]: z.ZodNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.nullable()])
  ) as { [K in keyof T]: z.ZodNullable<T[K]> };
}

export type BrandSettingsUpdate = z.infer<typeof brandSettingsUpdateSchema>;

/** What is stored: each setting, or null where it is its starting value. */
export type StoredBrandSettings = {
  [K in keyof BrandSettings]: unknown;
};

/**
 * Resolve stored settings. A setting that is null, absent, or no longer
 * passes its rule (a row written some other way) reads as its starting
 * value, so what reaches a render has always passed the rule.
 */
export function resolveBrand(
  stored: Partial<StoredBrandSettings> | null
): BrandSettings {
  const resolved = { ...STARTING_BRAND, footerLinks: [] } as BrandSettings;
  if (!stored) return resolved;
  for (const key of Object.keys(FIELD_SCHEMAS) as Array<keyof BrandSettings>) {
    const value = stored[key];
    if (value === null || value === undefined) continue;
    const parsed = FIELD_SCHEMAS[key].safeParse(value);
    if (parsed.success) {
      (resolved as Record<keyof BrandSettings, unknown>)[key] = parsed.data;
    }
  }
  return resolved;
}

// ============================================================
// The `brand` variable
// ============================================================

/**
 * The name the settings are always under, whatever a send's data holds.
 * `brand` is a plain word a site's sends may already use for something of
 * their own (a product's brand name, say), and in a template body a send's
 * own value wins; core's built-ins read the settings here instead, so no send
 * can change their buttons. Reserved: a send's value under this name is
 * ignored.
 */
export const BRAND_BINDING = "nextly_brand";

/** The values a layout's chrome is filled with, as the render resolved them. */
export interface LayoutChrome {
  year: unknown;
  appName: unknown;
}

/** The markup the default layout places, built from the settings. */
export interface BrandMarkup {
  /** The logo, centred above the content, or nothing. */
  logo: TrustedHtml;
  /** The footer line's contents. */
  footer: TrustedHtml;
  /** A line of footer links, or nothing. */
  links: TrustedHtml;
  /** The dark-mode rules for the colours still at their starting values. */
  darkMode: TrustedHtml;
}

/** What a layout reads as `brand`. */
export type BrandVariables = Omit<BrandSettings, "fontFamily"> & {
  /** The font's CSS stack, written as it is. */
  fontFamily: TrustedHtml;
  /** The font's key in the email-safe list. */
  font: EmailSafeFontKey;
  html: BrandMarkup;
};

/** The standard footer line, as the default layout wrote it before brand settings. */
const STANDARD_FOOTER = "&copy; {{year}} {{appName}}. All rights reserved.";

/** A value as an HTML template writes it: escaped, unless code marked it. */
function write(value: unknown): string {
  return renderLiquid("{{ value }}", { value }, "html");
}

/**
 * The `brand` variable for a layout.
 *
 * Plain paths into it (`{{brand.backgroundColor}}`) read the same on both
 * template engines, which is what core's default layout uses. The font stack
 * and the markup are marked, since an HTML template would otherwise escape the
 * quotes in a stack: both are built here, from the list above and from
 * settings that passed their rules, with every value from a setting escaped.
 */
export function brandVariables(
  settings: BrandSettings,
  chrome: LayoutChrome
): BrandVariables {
  const stack = fontStack(settings.fontFamily);
  return {
    ...settings,
    footerLinks: settings.footerLinks.map(link => ({ ...link })),
    fontFamily: markHtml(stack),
    font: settings.fontFamily,
    html: {
      logo: markHtml(logoMarkup(settings, chrome)),
      footer: markHtml(
        settings.footerText === null
          ? renderLiquid(STANDARD_FOOTER, { ...chrome }, "html")
          : escapeHtml(settings.footerText).replace(/\r?\n/g, "<br>")
      ),
      links: markHtml(linksMarkup(settings, stack)),
      darkMode: markHtml(darkModeRules(settings)),
    },
  };
}

/**
 * The default layout's dark-mode rules. They swap the starting colours for
 * dark ones, so each holds only while its colour is still the starting one: a
 * colour the site chose is the site's in dark mode too, since the settings
 * have no dark palette, and the card's light text goes with the card's
 * colour so it is never set on a background it was not chosen for.
 */
function darkModeRules(settings: BrandSettings): string {
  const rules: string[] = [];
  if (settings.backgroundColor === STARTING_BRAND.backgroundColor) {
    rules.push(".email-bg { background-color: #1a1a2e !important; }");
  }
  if (settings.contentColor === STARTING_BRAND.contentColor) {
    rules.push(
      ".email-card { background-color: #27272a !important; }",
      ".email-card h1, .email-card h2, .email-card p { color: #fafafa !important; }"
    );
  }
  // Indented as the rules sit in the layout's style block.
  return rules.join("\n      ");
}

function logoMarkup(settings: BrandSettings, chrome: LayoutChrome): string {
  if (!settings.logoUrl) return "";
  const width = settings.logoWidth;
  return (
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width: 600px;">` +
    `<tr><td align="center" style="padding: 0 0 24px;">` +
    `<img src="${escapeHtml(settings.logoUrl)}" width="${width}" alt="${write(chrome.appName)}" style="display: block; width: ${width}px; max-width: 100%; height: auto; border: 0;">` +
    `</td></tr></table>`
  );
}

function linksMarkup(settings: BrandSettings, stack: string): string {
  if (settings.footerLinks.length === 0) return "";
  const links = settings.footerLinks
    .map(
      link =>
        `<a href="${escapeHtml(link.url)}" style="color: ${escapeHtml(settings.accentColor)}; text-decoration: underline;">${escapeHtml(link.label)}</a>`
    )
    .join(" &middot; ");
  return `<p class="email-muted" style="margin: 8px 0 0; font-size: 12px; line-height: 18px; color: #52525b; font-family: ${stack};">${links}</p>`;
}

// ============================================================
// Which emails the settings reach
// ============================================================

/**
 * Why the brand settings do not reach an email:
 * - `setInCode`: the site's code version sends, which has no stored layout;
 * - `inactive`: it is switched off and has no code version, so nothing sends;
 * - `noLayout`: neither its own text nor a layout reads them: it sends
 *   without a layout, or no layout exists;
 * - `layoutWithoutBrand`: neither its own text nor its layout reads `brand`
 *   (an overridden default layout from before brand settings, say, or one of
 *   the site's own).
 */
export type BrandReachReason =
  | "setInCode"
  | "inactive"
  | "noLayout"
  | "layoutWithoutBrand";

/** One email, and whether the brand settings shape it. */
export interface BrandReach {
  templateId: string;
  slug: string;
  name: string;
  reached: boolean;
  /** Why not, when it is not reached; null when it is. */
  reason: BrandReachReason | null;
  /**
   * Where the settings reach it: its own text (a button in the accent, say)
   * and the layout it is wrapped in. Either one is enough.
   */
  via: { body: boolean; layout: boolean };
  /** The layout it is wrapped in, when it is wrapped in one. */
  layout: {
    id: string;
    slug: string;
    name: string;
    overridden: boolean;
  } | null;
}

/**
 * Everything an editor of the brand settings shows. A type alias rather than
 * an interface so a route can hand it to `respondData` as it is.
 */
export type BrandOverview = {
  settings: BrandSettings;
  /** The value each setting returns to when set to null. */
  starting: BrandSettings;
  fonts: Array<{ key: EmailSafeFontKey; label: string; stack: string }>;
  /** Every email that is not a layout, and whether the settings reach it. */
  reach: BrandReach[];
};
