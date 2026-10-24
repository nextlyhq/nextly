/**
 * What the Design tab shows, decided apart from how it is drawn: the brand
 * settings being edited and what a save would change, which emails each
 * layout wraps, and what the site's own design variables offer.
 *
 * @module components/features/email-hub/design/design-model
 */

import type {
  BrandFont,
  BrandLink,
  BrandReach,
  BrandSettings,
  BrandSettingsChange,
} from "@admin/services/emailBrandApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { DEFAULT_LAYOUT_SLUG } from "../messages/messages-model";

// ============================================================
// Words
// ============================================================

/** `1 email`, `20 emails`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The first few names, then how many more. */
export function namesLine(names: string[], shown = 3): string {
  const head = names.slice(0, shown).join(", ");
  return names.length > shown
    ? `${head} and ${names.length - shown} more`
    : head;
}

// ============================================================
// Colours
// ============================================================

/** A hex colour as the server stores it (`#rrggbb`, lowercase), or null. */
export function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map(digit => digit + digit)
          .join("")
      : match[1];
  return `#${digits.toLowerCase()}`;
}

/** The three colours a person picks, with what each one paints. */
export const COLOUR_ROLES = [
  {
    key: "accentColor",
    label: "Accent colour",
    hint: "Buttons and links",
  },
  {
    key: "backgroundColor",
    label: "Email background",
    hint: "Behind the email",
  },
  {
    key: "contentColor",
    label: "Content background",
    hint: "The panel the text sits on",
  },
] as const satisfies ReadonlyArray<{
  key: keyof BrandSettings;
  label: string;
  hint: string;
}>;

export type ColourRole = (typeof COLOUR_ROLES)[number]["key"];

// ============================================================
// The draft
// ============================================================

/** The settings being edited: what is saved, with the edits over it. */
export function draftOf(
  saved: BrandSettings,
  edits: Partial<BrandSettings>
): BrandSettings {
  return { ...saved, ...edits };
}

/** The settings a save would change, each with its new value. */
export function changeOf(
  saved: BrandSettings,
  draft: BrandSettings
): BrandSettingsChange {
  const change: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof BrandSettings>) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) {
      change[key] = draft[key];
    }
  }
  return change;
}

export function isEmptyChange(change: BrandSettingsChange): boolean {
  return Object.keys(change).length === 0;
}

/** A link with both halves filled in. */
function isComplete(link: BrandLink): boolean {
  return link.label.trim() !== "" && link.url.trim() !== "";
}

/**
 * The change a preview renders with. A link still being typed is left out,
 * so the preview shows the links that are complete rather than refusing all
 * of them; a save sends every link, and the server says which one is wrong.
 */
export function previewChangeOf(
  change: BrandSettingsChange
): BrandSettingsChange | undefined {
  if (isEmptyChange(change)) return undefined;
  if (!change.footerLinks) return change;
  return { ...change, footerLinks: change.footerLinks.filter(isComplete) };
}

/**
 * A media library address as the settings take it: absolute. The library
 * may hand back a path on this site, which an email client opening the email
 * elsewhere could not load.
 */
export function absoluteLogoUrl(url: string, origin: string): string | null {
  try {
    const resolved = new URL(url, origin);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

/** The file a logo address names, for showing beside its thumbnail. */
export function logoFileName(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || url;
  } catch {
    return url;
  }
}

// ============================================================
// Reach
// ============================================================

/** Whose emails the default layout's change has been kept from. */
export function defaultLayoutKept(reach: BrandReach[]): boolean {
  return reach.some(
    entry =>
      entry.reason === "layoutWithoutBrand" &&
      entry.layout?.slug === DEFAULT_LAYOUT_SLUG
  );
}

/** Why the settings don't reach an email, in a few words. */
export function unreachedReason(entry: BrandReach): string {
  switch (entry.reason) {
    case "setInCode":
      return "Sent from your site's code";
    case "inactive":
      return "Off";
    case "noLayout":
      return "Sent without a layout";
    case "layoutWithoutBrand":
      return entry.layout
        ? `On ${entry.layout.name}, ${entry.layout.overridden ? "your site's version" : "your own"}`
        : "Its layout doesn't use them";
    default:
      return "Not reached";
  }
}

/** The emails to preview: those the settings reach first, then the rest. */
export function previewEmailOrder(
  reach: ReadonlyArray<Pick<BrandReach, "templateId" | "reached">>,
  emails: EmailTemplateRecord[]
): EmailTemplateRecord[] {
  const reached = new Set(
    reach.filter(entry => entry.reached).map(entry => entry.templateId)
  );
  return [
    ...emails.filter(email => reached.has(email.id)),
    ...emails.filter(email => !reached.has(email.id)),
  ];
}

// ============================================================
// Layouts and the emails they wrap
// ============================================================

/**
 * The emails each layout wraps, by layout id: the one an email names when
 * that is a layout, otherwise the default layout, as a send chooses. An email
 * sent without a layout is under none.
 */
export function emailsByLayout(
  records: EmailTemplateRecord[]
): Map<string, EmailTemplateRecord[]> {
  const layouts = new Map(
    records
      .filter(record => record.kind === "layout")
      .map(record => [record.id, record])
  );
  const fallback = records.find(
    record => record.kind === "layout" && record.slug === DEFAULT_LAYOUT_SLUG
  );
  const used = new Map<string, EmailTemplateRecord[]>();
  for (const email of records) {
    if (email.kind !== "template" || !email.useLayout) continue;
    const named = email.layoutId ? layouts.get(email.layoutId) : undefined;
    const layout = named ?? fallback;
    if (!layout) continue;
    used.set(layout.id, [...(used.get(layout.id) ?? []), email]);
  }
  return used;
}

// ============================================================
// Match my site
// ============================================================

/** One of the site's colour variables. */
export interface SiteColour {
  /** The CSS custom property the site emits, such as `--site-color-primary`. */
  name: string;
  /** The light-theme value, as a hex colour. */
  value: string;
}

/** What the site's design variables offer the email. */
export interface SiteStyle {
  colours: SiteColour[];
  /** The family the site's text is set in, if it names one. */
  font: string | null;
}

interface StoredToken {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  values?: { light?: unknown };
}

const DEFAULT_PREFIX = "--site-";

/** A JSON field's value, whether it arrives parsed or as its text. */
function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function customProperty(token: StoredToken, prefix: string): string {
  const name = typeof token.id === "string" ? token.id : String(token.name);
  return prefix + name.replace(/\./g, "-");
}

function lightValue(token: StoredToken): string | null {
  const light = token.values?.light;
  return typeof light === "string" ? light : null;
}

/**
 * The colours and font of the site's design variables, from the page
 * builder's stored site style. Only light-theme values a hex can hold are
 * offered, since that is what an email takes; null when the site defines no
 * colours to offer.
 */
export function siteStyleOf(stored: unknown): SiteStyle | null {
  const set = (parsedJson(stored) ?? {}) as {
    tokens?: unknown;
    prefix?: unknown;
  };
  const tokens = Array.isArray(set.tokens) ? (set.tokens as StoredToken[]) : [];
  const prefix =
    typeof set.prefix === "string" && set.prefix.startsWith("--")
      ? set.prefix
      : DEFAULT_PREFIX;
  const colours: SiteColour[] = [];
  for (const token of tokens) {
    const value = token.kind === "color" ? lightValue(token) : null;
    const hex = value ? normalizeHex(value) : null;
    if (hex) colours.push({ name: customProperty(token, prefix), value: hex });
  }
  if (colours.length === 0) return null;
  const fontToken =
    tokens.find(t => t.kind === "fontFamily" && t.name === "font.body") ??
    tokens.find(t => t.kind === "fontFamily");
  return { colours, font: fontToken ? lightValue(fontToken) : null };
}

/** Words a variable's name carries when it is meant for each role. */
const ROLE_WORDS: Record<ColourRole, string[]> = {
  accentColor: ["accent", "brand", "primary"],
  backgroundColor: ["background", "page", "surface"],
  contentColor: ["card", "content", "panel", "surface"],
};

/**
 * The site colour suggested for a role: the first whose name carries one of
 * the role's words, in the order the words are listed; none when no name
 * does.
 */
export function suggestedColour(
  role: ColourRole,
  colours: SiteColour[],
  taken: string[] = []
): SiteColour | null {
  for (const word of ROLE_WORDS[role]) {
    const match = colours.find(
      colour =>
        colour.name.toLowerCase().includes(word) && !taken.includes(colour.name)
    );
    if (match) return match;
  }
  return null;
}

/** A suggestion for each role, never the same colour for two of them. */
export function suggestedColours(
  colours: SiteColour[]
): Partial<Record<ColourRole, SiteColour>> {
  const picks: Partial<Record<ColourRole, SiteColour>> = {};
  const taken: string[] = [];
  for (const { key } of COLOUR_ROLES) {
    const pick = suggestedColour(key, colours, taken);
    if (pick) {
      picks[key] = pick;
      taken.push(pick.name);
    }
  }
  return picks;
}

/** The first family a CSS font stack names, without quotes. */
function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/** The generic family a stack falls back to, for the closest email-safe one. */
function genericOf(stack: string): "serif" | "monospace" | "system" | "sans" {
  const lower = stack.toLowerCase();
  if (/\bmonospace\b/.test(lower)) return "monospace";
  // Before the generic fallbacks: `system-ui, sans-serif` is a system stack.
  if (/system-ui|-apple-system/.test(lower)) return "system";
  if (/\bsans-serif\b/.test(lower)) return "sans";
  if (/\bserif\b/.test(lower)) return "serif";
  return "sans";
}

const CLOSEST_BY_GENERIC = {
  serif: "georgia",
  monospace: "courier",
  system: "system",
  sans: "arial",
} as const;

/**
 * The email-safe font for the site's font: the same family when it is on the
 * list, otherwise the closest by its generic family, saying which.
 */
export function emailSafeFontFor(
  stack: string,
  fonts: BrandFont[]
): { font: BrandFont; same: boolean; family: string } | null {
  const family = firstFamily(stack);
  const same = fonts.find(
    font =>
      font.label.toLowerCase() === family.toLowerCase() ||
      firstFamily(font.stack).toLowerCase() === family.toLowerCase()
  );
  if (same) return { font: same, same: true, family };
  const closest = fonts.find(
    font => font.key === CLOSEST_BY_GENERIC[genericOf(stack)]
  );
  return closest ? { font: closest, same: false, family } : null;
}
