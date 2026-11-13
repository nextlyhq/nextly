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
  tokenKey,
  unknownTokens,
  type Separator,
} from "../settings/patterns";
import {
  VERIFICATION_SERVICES,
  type VerificationServiceKey,
} from "../settings/verification";
import {
  DETAIL_GUESSES,
  STRUCTURED_DATA_TYPES,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "../structured-data/catalog";
import type {
  DetailMapping,
  DetailSource,
  StructuredDataTypeRule,
} from "../structured-data/rules";

/** One of the brand's official accounts, as the form holds it. */
export interface ProfileDraft {
  network: string;
  url: string;
}

/** One other service's tag, as the form holds it while a person types. */
export interface OtherTagDraft {
  name: string;
  code: string;
}

/**
 * The verification codes as the form holds them: each box's text as typed,
 * and the other services' tags. A box holds only a code once what was pasted
 * is read (`settings/verification`); until then the save is held up.
 */
export type VerificationDraft = Record<VerificationServiceKey, string> & {
  others: OtherTagDraft[];
};

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
  /** The content types hidden from search as a whole, by key. */
  hiddenTypes: string[];
  /** Each content type's structured data choice and detail mapping, by key. */
  structuredData: Record<string, StructuredDataTypeRule>;
  /** Whether IndexNow is told of changed pages. */
  indexNow: boolean;
  /** Whether `/llms.txt` is served. */
  llmsTxt: boolean;
  /** Whether each listed page has a plain-text copy. */
  plainTextCopies: boolean;
  /** The codes other services verify the site with. */
  verificationCodes: VerificationDraft;
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

/**
 * The stored verification codes as the form holds them: each service's
 * code, and each other service's tag, with anything that is not text left
 * out. Nothing stored, as before the field existed, is every box empty.
 */
export function verificationDraftOf(value: unknown): VerificationDraft {
  const stored = isRecord(value) ? value : {};
  const codes = Object.fromEntries(
    VERIFICATION_SERVICES.map(service => [
      service.key,
      text(stored[service.key]),
    ])
  ) as Record<VerificationServiceKey, string>;
  const others = Array.isArray(stored.others)
    ? stored.others.filter(isRecord).map(tag => ({
        name: text(tag.name),
        code: text(tag.code),
      }))
    : [];
  return { ...codes, others };
}

/**
 * The verification codes as they are stored: each code trimmed, an empty box
 * left out, an empty other-service row dropped, and null where nothing is
 * left, so clearing every box clears the value.
 */
function storedVerification(
  draft: VerificationDraft
): Record<string, unknown> | null {
  const stored: Record<string, unknown> = {};
  for (const service of VERIFICATION_SERVICES) {
    const code = draft[service.key].trim();
    if (code !== "") stored[service.key] = code;
  }
  const others = draft.others
    .map(tag => ({ name: tag.name.trim(), code: tag.code.trim() }))
    .filter(tag => tag.name !== "" || tag.code !== "");
  if (others.length > 0) stored.others = others;
  return Object.keys(stored).length === 0 ? null : stored;
}

/** What the plugin's own options answer while the settings hold nothing. */
export interface SettingsDefaults {
  /** The plugin's `aiCrawlers` option: what robots.txt asks until the site chooses. */
  aiCrawlers?: AiCrawlerChoice;
  /** The plugin's `hiddenTypes` option: what is hidden until the site chooses. */
  hiddenTypes?: readonly string[];
  /**
   * The plugin's `structuredData.types` option: each content type's choice
   * and mapping until the site makes its own for that type.
   */
  structuredData?: Readonly<Record<string, StructuredDataTypeRule>>;
}

/** The form's values for the stored settings, `defaults` where nothing is stored. */
export function draftOf(
  stored: StoredSettings,
  defaults: SettingsDefaults = {}
): SettingsDraft {
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
    // The choice in force: the site's own, else the plugin's, so the screen
    // shows what robots.txt asks and picking "all" over a stricter option is
    // a change that saves.
    aiCrawlers:
      oneOf(AI_CRAWLER_CHOICES, stored.aiCrawlers) ??
      defaults.aiCrawlers ??
      "all",
    brandName: text(stored.brandName),
    brandOtherNames: text(stored.brandOtherNames),
    logo: mediaId(stored.logo),
    socialProfiles: profilesOf(stored.socialProfiles),
    patterns: patternsOf(stored.patterns),
    setupStep: typeof stored.setupStep === "number" ? stored.setupStep : 0,
    setupDismissed: stored.setupDismissed === true,
    // The types hidden in force: the site's own list, else the plugin's, so
    // showing one the plugin hides is a change that saves.
    hiddenTypes: Array.isArray(stored.hiddenTypes)
      ? stored.hiddenTypes.filter(
          (key): key is string => typeof key === "string"
        )
      : [...(defaults.hiddenTypes ?? [])],
    // The rules in force: the site's own for a type it chose for, else the
    // plugin's, as the page's markup reads them.
    structuredData: {
      ...defaults.structuredData,
      ...structuredDataOf(stored.structuredData),
    },
    // Off unless stored as switched on.
    indexNow: stored.indexNow === true,
    llmsTxt: stored.llmsTxt === true,
    plainTextCopies: stored.plainTextCopies === true,
    verificationCodes: verificationDraftOf(stored.verificationCodes),
  };
}

/** Each type's stored structured data choice, as far as the form edits it. */
export function structuredDataOf(
  value: unknown
): Record<string, StructuredDataTypeRule> {
  if (!isRecord(value)) return {};
  const rules: Record<string, StructuredDataTypeRule> = {};
  for (const [key, rule] of Object.entries(value)) {
    if (isRecord(rule)) rules[key] = rule;
  }
  return rules;
}

/** Whether every page of the type `key` is hidden from search. */
export function isHidden(draft: SettingsDraft, key: string): boolean {
  return draft.hiddenTypes.includes(key);
}

/** `draft` with the type `key` hidden from search as a whole, or shown. */
export function withHidden(
  draft: SettingsDraft,
  key: string,
  hidden: boolean
): SettingsDraft {
  const others = draft.hiddenTypes.filter(each => each !== key);
  return { ...draft, hiddenTypes: hidden ? [...others, key] : others };
}

/** The structured data type the type `key` chose, or none: automatic. */
export function structuredTypeOf(
  draft: SettingsDraft,
  key: string
): StructuredDataTypeKey | undefined {
  return draft.structuredData[key]?.type;
}

/**
 * `draft` with only the type `key`'s rule changed. An empty rule is kept: it
 * is the type described automatically, over any choice the plugin makes.
 */
function withRule(
  draft: SettingsDraft,
  key: string,
  rule: StructuredDataTypeRule
): SettingsDraft {
  return {
    ...draft,
    structuredData: { ...draft.structuredData, [key]: rule },
  };
}

/** A value as text with every object's keys in order, to compare rules by. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sorted(value[key])])
  );
}

const sameRule = (a: StructuredDataTypeRule, b: StructuredDataTypeRule) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const isEmptyRule = (rule: StructuredDataTypeRule): boolean =>
  rule.type === undefined && Object.keys(rule.details ?? {}).length === 0;

/**
 * The rules the site saves: those that differ from the plugin's, so a type
 * the site never chose for keeps following the plugin's option. An empty
 * rule is saved only where it overrides one of the plugin's.
 */
function savedRules(
  rules: SettingsDraft["structuredData"],
  defaults: SettingsDefaults
): SettingsDraft["structuredData"] {
  const fromPlugin = defaults.structuredData ?? {};
  return Object.fromEntries(
    Object.entries(rules).filter(([key, rule]) => {
      const plugin = fromPlugin[key];
      return plugin === undefined
        ? !isEmptyRule(rule)
        : !sameRule(rule, plugin);
    })
  );
}

/** `draft` with the type `key` described as `type`, or automatically. */
export function withStructuredType(
  draft: SettingsDraft,
  key: string,
  type: StructuredDataTypeKey | undefined
): SettingsDraft {
  const { type: _previous, ...rest } = draft.structuredData[key] ?? {};
  return withRule(draft, key, type === undefined ? rest : { ...rest, type });
}

/** The fields the type `key` reads each detail of `type` from. */
export function mappingOf(
  draft: SettingsDraft,
  key: string,
  type: StructuredDataTypeKey
): DetailMapping {
  return draft.structuredData[key]?.details?.[type] ?? {};
}

/** `draft` with `detail` of `type` read from `field`, or from nothing chosen. */
export function withDetailField(
  draft: SettingsDraft,
  key: string,
  type: StructuredDataTypeKey,
  detail: StructuredDataDetail,
  field: string
): SettingsDraft {
  const rule = draft.structuredData[key] ?? {};
  const { [detail]: _previous, ...mapping } = mappingOf(draft, key, type);
  const nextMapping: DetailMapping =
    field === "" ? mapping : { ...mapping, [detail]: field };
  const details = { ...rule.details };
  if (Object.keys(nextMapping).length === 0) delete details[type];
  else details[type] = nextMapping;
  const { details: _details, ...withoutDetails } = rule;
  return withRule(
    draft,
    key,
    Object.keys(details).length === 0
      ? withoutDetails
      : { ...withoutDetails, details }
  );
}

/**
 * The details a page supplies itself until a field is chosen, with what the
 * mapping screen calls that source.
 */
export const FROM_THE_PAGE: Readonly<
  Partial<Record<StructuredDataDetail, string>>
> = {
  // The page's own share image, from the order of who wins.
  image: "The page's share image",
  // A page's route can give the questions it shows, with no field holding
  // them.
  questions: "The questions the page's route gives",
};

/**
 * The details `type` needs that the content type has no field for yet:
 * neither mapped nor held by a field named like the detail, which is where
 * the page's markup looks when nothing is mapped.
 */
export function missingDetails(
  draft: SettingsDraft,
  type: SeoContentType,
  structuredType: StructuredDataTypeKey
): StructuredDataDetail[] {
  const mapping = mappingOf(draft, type.key, structuredType);
  // The markup finds a detail by name among the entry's own fields only,
  // never inside a group.
  const named = new Set(
    type.mappableFields
      .filter(field => !field.name.includes("."))
      .map(field => tokenKey(field.name))
  );
  return STRUCTURED_DATA_TYPES[structuredType].needs.filter(detail => {
    const source = mapping[detail];
    if (source !== undefined) return !holdsField(type, source);
    return (
      FROM_THE_PAGE[detail] === undefined &&
      !DETAIL_GUESSES[detail].some(guess => named.has(tokenKey(guess)))
    );
  });
}

/**
 * Whether a mapped source still reads something: a fixed value, a field the
 * type has, or a path into a field whose inside is not listed, such as a
 * linked entry's `author.name`. A group's fields are listed, so a path into
 * a group must be one of them. A field since removed reads nothing, so its
 * detail is missing until another is chosen.
 */
export function holdsField(
  type: SeoContentType,
  source: DetailSource
): boolean {
  if (typeof source !== "string") return true;
  const names = type.mappableFields.map(field => field.name);
  if (names.includes(source)) return true;
  const root = source.split(".")[0] ?? "";
  const listedInside = names.some(name => name.startsWith(`${root}.`));
  return names.includes(root) && !listedInside;
}

/**
 * The values as they are stored: blank addresses and profiles left out, and
 * each profile's network read from its address.
 */
function storedForm(
  draft: SettingsDraft,
  defaults: SettingsDefaults
): Record<string, unknown> {
  return {
    ...draft,
    structuredData: savedRules(draft.structuredData, defaults),
    verificationCodes: storedVerification(draft.verificationCodes),
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
/**
 * `draft` moved from the settings it was made from onto newer ones: each
 * value edited since `before` stays as edited, and each other takes its
 * value in `after`, so a change made elsewhere meanwhile is kept. A map kept
 * per content type (patterns, structured data) is moved entry by entry, and
 * a list (hidden types, production addresses, social profiles) item by item,
 * so an edit to one type keeps another person's edit to another, and an
 * item added elsewhere stays.
 */
export function rebasedDraft(
  draft: SettingsDraft,
  before: SettingsDraft,
  after: SettingsDraft
): SettingsDraft {
  return {
    ...after,
    ...editedScalars(draft, before),
    patterns: rebasedEntries(draft.patterns, before.patterns, after.patterns),
    structuredData: rebasedEntries(
      draft.structuredData,
      before.structuredData,
      after.structuredData
    ),
    hiddenTypes: rebasedSet(
      draft.hiddenTypes,
      before.hiddenTypes,
      after.hiddenTypes
    ),
    productionAddresses: rebasedSet(
      draft.productionAddresses,
      before.productionAddresses,
      after.productionAddresses
    ),
    socialProfiles: rebasedSet(
      draft.socialProfiles,
      before.socialProfiles,
      after.socialProfiles
    ),
  };
}

/** The values moved as a whole map or list rather than as one value. */
const MOVED_BY_PART: ReadonlySet<keyof SettingsDraft> = new Set([
  "patterns",
  "structuredData",
  "hiddenTypes",
  "productionAddresses",
  "socialProfiles",
]);

/** The draft's own values, other than the per-type ones, edited since `before`. */
function editedScalars(
  draft: SettingsDraft,
  before: SettingsDraft
): Partial<SettingsDraft> {
  const edited: Partial<SettingsDraft> = {};
  for (const key of Object.keys(draft) as (keyof SettingsDraft)[]) {
    if (MOVED_BY_PART.has(key)) continue;
    if (!same(draft[key], before[key])) keepEdited(edited, draft, key);
  }
  return edited;
}

/** `target`'s `key` set to `source`'s, the value edited here. */
function keepEdited<K extends keyof SettingsDraft>(
  target: Partial<SettingsDraft>,
  source: SettingsDraft,
  key: K
): void {
  target[key] = source[key];
}

/** A map moved entry by entry: each entry edited here kept, every other the newer one. */
function rebasedEntries<T>(
  draft: Readonly<Record<string, T>>,
  before: Readonly<Record<string, T>>,
  after: Readonly<Record<string, T>>
): Record<string, T> {
  const next: Record<string, T> = { ...after };
  for (const key of new Set([...Object.keys(draft), ...Object.keys(before)])) {
    if (same(draft[key], before[key])) continue;
    const edited = draft[key];
    if (edited === undefined) delete next[key];
    else next[key] = edited;
  }
  return next;
}

/**
 * A list moved item by item, items told apart by value. Changed on one side
 * only, it is that side's list as it is. Changed on both, it is the newer
 * list, in its order, with what was taken out here taken out and what was
 * added here put in at the place it holds here. Order matters (the first production
 * address is the main one), so a main address changed elsewhere stays first
 * unless one was put first here.
 */
function rebasedSet<T>(
  draft: readonly T[],
  before: readonly T[],
  after: readonly T[]
): T[] {
  // Changed on one side only, the list is that side's, order and all.
  if (same(after, before)) return [...draft];
  if (same(draft, before)) return [...after];
  const has = (list: readonly T[], item: T) =>
    list.some(each => same(each, item));
  const next = after.filter(item => !has(before, item) || has(draft, item));
  draft.forEach((item, index) => {
    if (has(before, item) || has(next, item)) return;
    next.splice(Math.min(index, next.length), 0, item);
  });
  return next;
}

export function changesOf(
  stored: StoredSettings,
  draft: SettingsDraft,
  defaults: SettingsDefaults = {}
): Record<string, unknown> | null {
  const before = storedForm(draftOf(stored, defaults), defaults);
  const after = storedForm(draft, defaults);
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
  tab: "general" | "types" | "images" | "brand";
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
    : { text: "No share image yet", fix: "Add a share image", tab: "images" };
}

/**
 * What needs attention first once setup is answered: a missing production
 * address, each content type with no public address, and a missing logo or
 * share image, each with the tab it is fixed on.
 */
export function attentionItems(
  draft: SettingsDraft,
  types: readonly SeoContentType[],
  /** The addresses the server names, which stand in for saved ones. */
  serverAddresses: readonly string[] = []
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (
    serverAddresses.length === 0 &&
    !draft.productionAddresses.some(address => address.trim() !== "")
  ) {
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
