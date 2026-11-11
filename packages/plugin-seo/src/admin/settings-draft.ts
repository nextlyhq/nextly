/**
 * The SEO settings screen's values while a person edits them: read from the
 * stored Single, compared with it to say what a save sends, and the rules a
 * title pattern is previewed and checked by.
 *
 * Plain functions over plain values, so the screen and its tests share them
 * and none of it needs React.
 *
 * @module admin/settings-draft
 */
import { isRecord } from "../plain-values";
import {
  AI_CRAWLER_CHOICES,
  SITE_KINDS,
  type AiCrawlerChoice,
  type SeoContentType,
  type SiteKind,
} from "../settings/contract";
import {
  defaultTitlePattern,
  fillPattern,
  SEPARATORS,
  unknownTokens,
  type Separator,
} from "../settings/patterns";

/** One of the brand's official accounts, as the form holds it. */
export interface ProfileDraft {
  network: string;
  url: string;
}

/** Every value the screen edits, as the form holds it. */
export interface SettingsDraft {
  siteName: string;
  productionAddresses: string[];
  separator: Separator;
  description: string;
  /** A media item's id, or none. */
  image: string | null;
  siteKind: SiteKind | null;
  aiCrawlers: AiCrawlerChoice;
  brandName: string;
  brandOtherNames: string;
  logo: string | null;
  socialProfiles: ProfileDraft[];
  patterns: Record<string, { title?: string; description?: string }>;
  setupStep: number;
  setupDismissed: boolean;
}

/** The stored Single as the admin reads it. */
export type StoredSettings = Readonly<Record<string, unknown>>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

/** A media value's id: stored as one, or read back as the item itself. */
function mediaId(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  if (isRecord(value) && typeof value.id === "number") return String(value.id);
  return null;
}

function profilesOf(value: unknown): ProfileDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(profile => ({
    network: text(profile.network),
    url: text(profile.url),
  }));
}

function patternsOf(value: unknown): SettingsDraft["patterns"] {
  if (!isRecord(value)) return {};
  const patterns: SettingsDraft["patterns"] = {};
  for (const [type, parts] of Object.entries(value)) {
    if (!isRecord(parts)) continue;
    const title = typeof parts.title === "string" ? parts.title : undefined;
    const description =
      typeof parts.description === "string" ? parts.description : undefined;
    patterns[type] = {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    };
  }
  return patterns;
}

/** The form's values for the stored settings. */
export function draftOf(stored: StoredSettings): SettingsDraft {
  return {
    siteName: text(stored.siteName),
    productionAddresses: Array.isArray(stored.productionAddresses)
      ? stored.productionAddresses.filter(
          (address): address is string => typeof address === "string"
        )
      : [],
    separator: oneOf(SEPARATORS, stored.separator) ?? "|",
    description: text(stored.description),
    image: mediaId(stored.image),
    siteKind: oneOf(SITE_KINDS, stored.siteKind) ?? null,
    aiCrawlers: oneOf(AI_CRAWLER_CHOICES, stored.aiCrawlers) ?? "all",
    brandName: text(stored.brandName),
    brandOtherNames: text(stored.brandOtherNames),
    logo: mediaId(stored.logo),
    socialProfiles: profilesOf(stored.socialProfiles),
    patterns: patternsOf(stored.patterns),
    setupStep: typeof stored.setupStep === "number" ? stored.setupStep : 0,
    setupDismissed: stored.setupDismissed === true,
  };
}

/**
 * The values as they are stored: blank addresses and profiles left out, and
 * each profile's network read from its address.
 */
function storedForm(draft: SettingsDraft): Record<string, unknown> {
  return {
    ...draft,
    productionAddresses: draft.productionAddresses
      .map(address => address.trim())
      .filter(address => address !== ""),
    socialProfiles: draft.socialProfiles
      .map(profile => ({ url: profile.url.trim(), network: profile.network }))
      .filter(profile => profile.url !== "")
      .map(profile => ({
        network: networkOf(profile.url) || profile.network,
        url: profile.url,
      })),
  };
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What a save of `draft` sends: the values that differ from what is stored,
 * with the version they were read at, so a save made in between is refused
 * rather than overwritten. A document never saved has no version, and is
 * replaced. Null when nothing changed.
 */
export function changesOf(
  stored: StoredSettings,
  draft: SettingsDraft
): Record<string, unknown> | null {
  const before = storedForm(draftOf(stored));
  const after = storedForm(draft);
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (!same(value, before[key])) changes[key] = value;
  }
  if (Object.keys(changes).length === 0) return null;
  return typeof stored._rev === "string"
    ? { ...changes, _rev: stored._rev }
    : { ...changes, _overwrite: true };
}

/** A content type's title pattern, and whether it is its own or the default. */
export function patternOf(
  draft: SettingsDraft,
  key: string
): { pattern: string; own: boolean } {
  const own = draft.patterns[key]?.title;
  return own === undefined
    ? { pattern: defaultTitlePattern(draft.separator), own: false }
    : { pattern: own, own: true };
}

/**
 * The title a type's newest page would have under `pattern`, and whether the
 * pattern gave way to the page's own title, as the head does where the page
 * leaves a variable empty. A type with no page yet is shown with each
 * variable's own name.
 */
export function previewOf(
  pattern: string,
  type: SeoContentType,
  siteName: string
): { title: string; gaveWay: boolean } {
  const example = type.example;
  const values: Record<string, string | number> = {};
  for (const field of type.fields) {
    const value =
      example === undefined ? field.token : example.values[field.name];
    if (value !== undefined) values[field.name] = value;
  }
  const title = example?.title ?? "Page title";
  const filled = fillPattern(
    pattern,
    {
      title,
      ...(siteName.trim() === "" ? {} : { siteName: siteName.trim() }),
    },
    values
  );
  return filled === undefined
    ? { title, gaveWay: true }
    : { title: filled, gaveWay: false };
}

/** Why `pattern` cannot be used for `type`, in one sentence; null when it can. */
export function patternProblem(
  pattern: string,
  type: SeoContentType
): string | null {
  if (pattern.trim() === "") {
    return "Write a pattern, or reset it to the default.";
  }
  const unknown = unknownTokens(pattern, type.fields);
  if (unknown.length === 0) return null;
  const named = unknown.join(" or ");
  return `${type.label} have no field called ${named}. Click a variable below to add one.`;
}

/**
 * `draft` with a new separator between titles and the site's name: every
 * pattern that used the old one between two parts uses the new one.
 */
export function withSeparator(
  draft: SettingsDraft,
  separator: Separator
): SettingsDraft {
  const old = ` ${draft.separator} `;
  const patterns: SettingsDraft["patterns"] = {};
  for (const [key, parts] of Object.entries(draft.patterns)) {
    patterns[key] =
      parts.title === undefined
        ? parts
        : { ...parts, title: parts.title.split(old).join(` ${separator} `) };
  }
  return { ...draft, separator, patterns };
}

/** The networks known by their address, for a profile's label. */
const NETWORKS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)bsky\.app$/, "Bluesky"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)crunchbase\.com$/, "Crunchbase"],
  [/(^|\.)wikipedia\.org$/, "Wikipedia"],
];

/** The network a profile's address is on: a known name, else its host. */
export function networkOf(url: string): string {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
  const known = NETWORKS.find(([pattern]) => pattern.test(host));
  return known === undefined ? host.replace(/^www\./, "") : known[1];
}

/** One thing first-time setup ends on, and the tab where it is fixed. */
export interface AttentionItem {
  text: string;
  fix: string;
  tab: "general" | "types" | "brand";
}

/** What a logo and share image still missing are, said as one item. */
function imagesItem(draft: SettingsDraft): AttentionItem | null {
  if (draft.logo !== null && draft.image !== null) return null;
  if (draft.logo === null && draft.image === null) {
    return {
      text: "No logo or share image yet",
      fix: "Add a logo",
      tab: "brand",
    };
  }
  return draft.logo === null
    ? { text: "No logo yet", fix: "Add a logo", tab: "brand" }
    : { text: "No share image yet", fix: "Add a share image", tab: "general" };
}

/**
 * What needs attention first once setup is answered: a missing production
 * address, each content type with no public address, and a missing logo or
 * share image, each with the tab it is fixed on.
 */
export function attentionItems(
  draft: SettingsDraft,
  types: readonly SeoContentType[]
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!draft.productionAddresses.some(address => address.trim() !== "")) {
    items.push({
      text: "No production address is saved",
      fix: "Set the address",
      tab: "general",
    });
  }
  for (const type of types.filter(each => !each.public)) {
    items.push({
      text: `${type.label} have no public address`,
      fix: "See content types",
      tab: "types",
    });
  }
  const images = imagesItem(draft);
  if (images !== null) items.push(images);
  return items;
}
