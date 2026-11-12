/**
 * What the problem list's server and the admin's screens agree on: the kinds
 * of problem, the words each kind is explained with, where each is fixed,
 * and the shape the list's routes answer with. Plain data only, importing
 * nothing but the settings' contract, itself import-free, and the limits of
 * the title and description check, a leaf, so the admin's
 * client bundle and any other screen reading the list (a page's SEO tab)
 * take it without bringing server code along.
 *
 * @module problems/contract
 */
import { SEO_ADMIN_SLUG, SETTINGS_PAGE_HREF } from "../settings/contract";

// The limits the title and description are checked against, from the one
// check the SEO tab and the list share, named in the kinds' explanations.
import { DESCRIPTION_LIMIT, TITLE_LIMIT } from "./text-checks";

/** Where the list is read, under the plugin's routes. */
export const PROBLEMS_ROUTE_PATH = "/problems";

/** Where a person asks for the whole site to be checked again. */
export const PROBLEMS_CHECK_ROUTE_PATH = "/problems/check";

/** How old the last full check may be before opening the list rechecks the site. */
export const FULL_CHECK_MAX_AGE_MS: number = 24 * 60 * 60 * 1000;

/** Every kind of problem the list checks for. */
export type ProblemKind =
  | "productionAddress"
  | "proxyNotWired"
  | "connection"
  | "noAddress"
  | "redirectChain"
  | "languageCode"
  | "notListed"
  | "noTitle"
  | "noDescription"
  | "sharedTitle"
  | "sharedDescription"
  | "longTitle"
  | "longDescription"
  | "canonical"
  | "brokenLink"
  | "shareImage"
  | "imageAlt"
  | "structuredData";

/**
 * Each kind's heading and the one sentence that explains it, said once above
 * every problem of that kind, and whether it belongs to the whole site
 * rather than to a page.
 */
export const KIND_TEXT: Readonly<
  Record<ProblemKind, { title: string; explain: string; siteWide: boolean }>
> = {
  productionAddress: {
    title: "Production address missing",
    explain: "Nextly can't tell the real site from a test copy.",
    siteWide: true,
  },
  proxyNotWired: {
    title: "Redirects saved but not served",
    explain:
      "The site's Proxy isn't running, so visitors and search engines asking for an old address get “not found”, and addresses not found aren't logged.",
    siteWide: true,
  },
  connection: {
    title: "Optional connection not working",
    explain:
      "No page is affected, but the service isn't getting what the site sends it.",
    siteWide: true,
  },
  redirectChain: {
    title: "Redirect that takes more than one hop",
    explain:
      "Each extra hop slows the visit, and search engines may stop following before the end.",
    siteWide: true,
  },
  languageCode: {
    title: "Language search engines can't name",
    explain:
      "Pages in this language get no language links, so search engines may show people the wrong language.",
    siteWide: true,
  },
  notListed: {
    title: "Page left out of the sitemap",
    explain:
      "The page has no official address, so search engines aren't told about it.",
    siteWide: false,
  },
  noAddress: {
    title: "Content type with no public address",
    explain: "The site can't tell search engines where these pages live.",
    siteWide: true,
  },
  noTitle: {
    title: "Page with no title",
    explain:
      "Search engines make up a title for a page that has none. Give it its own, or a pattern for its content type.",
    siteWide: false,
  },
  noDescription: {
    title: "Page with no description",
    explain:
      "Search engines show a piece of the page instead, which may not say what it is about.",
    siteWide: false,
  },
  sharedTitle: {
    title: "Same title on several pages",
    explain: "Google may show only one of them. Give each page its own title.",
    siteWide: false,
  },
  sharedDescription: {
    title: "Same description on several pages",
    explain:
      "Each page should say what makes it different. Give each one its own description.",
    siteWide: false,
  },
  longTitle: {
    title: "Title longer than Google shows",
    explain: `Google shows about ${TITLE_LIMIT} characters of a title and cuts the rest to fit the screen. The title is saved and served as it is; put what matters first.`,
    siteWide: false,
  },
  longDescription: {
    title: "Description longer than Google shows",
    explain: `Google shows about ${DESCRIPTION_LIMIT} characters of a description and cuts the rest. The description is saved and served as it is; put what matters first.`,
    siteWide: false,
  },
  canonical: {
    title: "Official address points elsewhere",
    explain:
      "The page tells search engines another address is the official one, so this page is left out of results.",
    siteWide: false,
  },
  brokenLink: {
    title: "Broken internal link",
    explain: "A link on your site points to a page that doesn't exist.",
    siteWide: false,
  },
  shareImage: {
    title: "Share image missing or the wrong size",
    explain:
      "Networks crop images that aren't about 1200 × 630, and not every network shows an SVG, AVIF or WebP image.",
    siteWide: false,
  },
  imageAlt: {
    title: "Images with no alt text",
    explain:
      "Describe each image in a few words for people who can't see it. Mark purely decorative images as decorative.",
    siteWide: false,
  },
  structuredData: {
    title: "Structured data missing a detail",
    explain: "Google needs this detail to show the page's extra information.",
    siteWide: false,
  },
};

/**
 * How much a problem matters to search:
 *
 * - `error`: the site, a whole content type or the page is kept out of
 *   search or misdescribed there, or what was set does not reach it;
 * - `warning`: the page is found, but shows worse than it could, or an
 *   optional connection is not getting what the site sends;
 * - `notice`: worth a look, with nothing wrong in what is served.
 */
export type ProblemSeverity = "error" | "warning" | "notice";

/** The severities, most serious first, as the screens list them. */
export const SEVERITY_ORDER: readonly ProblemSeverity[] = [
  "error",
  "warning",
  "notice",
];

/** Each kind's one severity, so the Overview and the list agree on it. */
export const KIND_SEVERITY: Readonly<Record<ProblemKind, ProblemSeverity>> = {
  productionAddress: "error",
  noAddress: "error",
  proxyNotWired: "error",
  noTitle: "error",
  canonical: "error",
  connection: "warning",
  redirectChain: "warning",
  languageCode: "warning",
  notListed: "warning",
  brokenLink: "warning",
  noDescription: "warning",
  sharedTitle: "warning",
  sharedDescription: "warning",
  shareImage: "warning",
  structuredData: "warning",
  longTitle: "notice",
  longDescription: "notice",
  imageAlt: "notice",
};

/** How many problems there are of each severity. */
export type SeverityCounts = Record<ProblemSeverity, number>;

/**
 * The key a problem is counted under: a page check once for each page it
 * fails on, in each language, however many times it fails there (three
 * broken links on one page are one problem), and a site check once,
 * however many things it names (two redirect chains are one problem).
 */
function countedAs(problem: Problem): string {
  const { kind, subject } = problem;
  if (subject.id === undefined) return kind;
  return [kind, subject.type ?? "", subject.id, subject.locale ?? ""].join(
    "\u0000"
  );
}

/**
 * How many problems of each severity `problems` hold, counted as the
 * Overview's health verdict and the problem list both count them.
 */
export function severityCounts(problems: readonly Problem[]): SeverityCounts {
  const counted = new Map<string, ProblemSeverity>();
  for (const problem of problems) {
    counted.set(countedAs(problem), KIND_SEVERITY[problem.kind]);
  }
  const counts: SeverityCounts = { error: 0, warning: 0, notice: 0 };
  for (const severity of counted.values()) counts[severity] += 1;
  return counts;
}

/**
 * How many problems need fixing: the errors and the warnings, as the SEO
 * menu's Problems item shows them. Notices are left to the list.
 */
export function problemsToFix(counts: SeverityCounts): number {
  return counts.error + counts.warning;
}

/**
 * The order the list draws its groups in: what keeps the whole site or a
 * whole type out of search first, then what changes how a page shows.
 */
export const KIND_ORDER: readonly ProblemKind[] = [
  "productionAddress",
  "noAddress",
  "proxyNotWired",
  "connection",
  "redirectChain",
  "languageCode",
  "notListed",
  "noTitle",
  "sharedTitle",
  "canonical",
  "brokenLink",
  "noDescription",
  "sharedDescription",
  "longTitle",
  "longDescription",
  "shareImage",
  "imageAlt",
  "structuredData",
];

/**
 * What a problem is about: a page, by its content type's key (the
 * collection's slug, or `single:<slug>`) and id, or for a site-wide problem
 * the thing it names (a content type, the whole site).
 */
export interface ProblemSubject {
  /** The content type's key, where the subject is a page or a type. */
  type?: string;
  /** The page's id, where the subject is a page. */
  id?: string;
  /** What the list calls it: the page's title, or the type's name. */
  label: string;
  /** The page's address, or a line saying what else it is (`3 entries`). */
  detail?: string;
  /**
   * The language the page was checked in, where it is not the site's
   * default: its fix opens the editor in that language.
   */
  locale?: string;
}

/** Where the plugin's screens are served. */
const ADMIN_BASE = `/admin/plugins/${SEO_ADMIN_SLUG}`;

/** The problem list's screen: its path under the plugin, and its component. */
export const PROBLEMS_PAGE: {
  readonly path: "problems";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoProblemsPage";
} = {
  path: "problems",
  component: "@nextlyhq/plugin-seo/admin#SeoProblemsPage",
};

/** Where the problem list's screen is, for a link. */
export const PROBLEMS_PAGE_HREF: string = `${ADMIN_BASE}/${PROBLEMS_PAGE.path}`;

/** The query parameter the problem list is narrowed to one severity by. */
const SEVERITY_PARAM = "severity";

/** The severity an address's query names, or none. */
export function severityIn(search: string): ProblemSeverity | undefined {
  const named = new URLSearchParams(search).get(SEVERITY_PARAM);
  return SEVERITY_ORDER.find(severity => severity === named);
}

/** How many problems `problems` hold, counted as `severityCounts` counts them. */
export function problemTotal(problems: readonly Problem[]): number {
  const counts = severityCounts(problems);
  return counts.error + counts.warning + counts.notice;
}

/** The problem list, narrowed to `severity` where one is named. */
export function problemsHref(severity?: ProblemSeverity): string {
  return severity === undefined
    ? PROBLEMS_PAGE_HREF
    : `${PROBLEMS_PAGE_HREF}?${SEVERITY_PARAM}=${severity}`;
}

/**
 * The id the page's SEO tab is opened by in an editor's address
 * (`?tab=<id>`). An editor without the tab opens its content instead.
 */
export const SEO_TAB_ID = "nextlyhq-plugin-seo.tab";

/** What a problem of the whole site is about. */
export const WHOLE_SITE: ProblemSubject = { label: "Whole site" };

/** The SEO settings' tabs a fix can land on. */
export type SettingsTab = "general" | "types" | "brand" | "connections";

/**
 * Where a problem is fixed:
 *
 * - `page`: the page's own editor, on its SEO tab or its content, at a field;
 * - `settings`: the SEO settings, on a tab;
 * - `media`: the media library, where an image's alt text is kept;
 * - `developer`: code, so the list hands over a note to copy for a developer.
 */
export type ProblemFix =
  | { place: "page"; tab: "seo" | "content"; field?: string }
  | { place: "settings"; tab: SettingsTab }
  | { place: "media" }
  | { place: "developer"; note: string };

/** One problem, as the list draws it. */
export interface Problem {
  kind: ProblemKind;
  subject: ProblemSubject;
  /** What is wrong here, in one plain sentence or less. */
  what: string;
  /** The fix's button text, which says what it does: `Change the title`. */
  action: string;
  fix: ProblemFix;
}

/**
 * Where a problem's fix is, as an admin address; none for a note handed to
 * a developer, which is copied rather than opened.
 */
export function fixHref(problem: Problem): string | undefined {
  const { fix, subject } = problem;
  switch (fix.place) {
    case "page": {
      if (subject.type === undefined || subject.id === undefined) {
        return undefined;
      }
      const editor = subject.type.startsWith("single:")
        ? `/admin/singles/${encodeURIComponent(subject.type.slice(7))}`
        : `/admin/collections/${encodeURIComponent(subject.type)}/${encodeURIComponent(subject.id)}`;
      const query = new URLSearchParams();
      if (fix.tab === "seo") query.set("tab", SEO_TAB_ID);
      // The editor's language, as the admin names it in the address.
      if (subject.locale !== undefined) query.set("locale", subject.locale);
      const search = query.toString();
      return search === "" ? editor : `${editor}?${search}`;
    }
    case "settings":
      return `${SETTINGS_PAGE_HREF}?tab=${fix.tab}`;
    case "media":
      return "/admin/media";
    case "developer":
      return undefined;
  }
}

/** What the list's routes answer. */
export interface ProblemListBody {
  problems: Problem[];
  /** The site's host, from its first production address, where it has one. */
  site?: string;
  /** When the whole site was last checked, as ISO text; absent before the first. */
  checkedAt?: string;
  /** How many pages the last full check read. */
  pagesChecked: number;
  /**
   * A change since the last full check can have altered another page's
   * result, such as a removal, a new address or a changed title.
   */
  outOfDate: boolean;
  /** The last full check is over a day old, or there has been none. */
  due: boolean;
  /**
   * The page types the list covers for the reader, by key (a collection's
   * slug, or `single:<slug>`): a page of another type was not checked for
   * them, so its absence from the list says nothing about it.
   */
  types?: string[];
}
