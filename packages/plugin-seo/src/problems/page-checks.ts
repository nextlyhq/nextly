/**
 * The checks the problem list runs on one page, from what is already known
 * about it: its answer as the resolver works it out (so a value a lower
 * level supplies correctly is never reported empty), its share image and
 * structured data problems, the images its content shows and the links in
 * it that lead nowhere. Pure: what each fact holds is gathered elsewhere.
 *
 * @module problems/page-checks
 */
import type { LanguageCodeProblem } from "../languages/hreflang";
import { standingOf } from "../languages/versions";
import type { SeoAnswer, Sourced } from "../resolver/order";
import type { ShareImageProblem } from "../social/problems";
import { DETAIL_LABELS } from "../structured-data/catalog";
import type { StructuredDataProblem } from "../structured-data/graph";

import {
  DESCRIPTION_LIMIT,
  TITLE_LIMIT,
  WHOLE_SITE,
  type Problem,
  type ProblemFix,
  type ProblemKind,
  type ProblemSubject,
} from "./contract";

/** An image a page's content shows, and the alt text it is shown with. */
export interface ImageFact {
  /** The page's top-level field the image is in. */
  field: string;
  /** What the list names it by: its file name, or its address. */
  name: string;
  /** Kept in the media library, where its alt text is set. */
  media: boolean;
  /** Its alt text as stored; anything but text is none. */
  alt: unknown;
  /** Marked as purely decorative, so an empty alt text is right. */
  decorative?: boolean;
}

/** A link in a page's content to an address on the site no page holds. */
export interface LinkFact {
  /** The page's top-level field the link is in. */
  field: string;
  /** The address as the link names it. */
  url: string;
}

/** What is known about one page when it is checked. */
export interface PageFacts {
  subject: ProblemSubject;
  answer: SeoAnswer;
  /** The canonical the answer names is the page's own address ({@link canonicalIsOwn}). */
  canonicalIsOwn: boolean;
  shareImage: readonly ShareImageProblem[];
  structuredData: readonly StructuredDataProblem[];
  images: readonly ImageFact[];
  brokenLinks: readonly LinkFact[];
  /** The site's languages left out of the page's language links. */
  languageCodes: readonly LanguageCodeProblem[];
}

/** The site's languages left out of language links, each said of the whole site. */
function languageCodeProblems(facts: PageFacts): Problem[] {
  // The site's languages are set in its config or in Settings, so the note
  // names both rather than guessing which this site uses.
  return facts.languageCodes.map(problem => ({
    kind: "languageCode",
    subject: WHOLE_SITE,
    what: problem.message,
    action: COPY_NOTE,
    fix: {
      place: "developer",
      note: `Give the language "${problem.language}" a code search engines accept, such as "de" or "pt-BR", where the site's languages are set: localization in nextly.config.ts, or Settings.`,
    },
  }));
}

/** How long `text` reads: in characters, so an emoji counts once. */
function characters(text: string): number {
  return [...text].length;
}

/** What a developer is asked for, for a value only code sets. */
const CODE_NOTE = (page: ProblemSubject, what: string) =>
  `${page.detail ?? page.label}: ${what} is set by the page's route code. Change it there.`;

/** The action that copies a note for a developer. */
const COPY_NOTE = "Copy a note for a developer";

/**
 * Where a title or description is fixed: on the page's SEO tab, where a
 * value typed wins over every level below it, unless the value comes from
 * the route's code, which a person cannot override there.
 */
function textFix(
  value: Sourced<string> | undefined,
  field: "metaTitle" | "metaDescription",
  page: ProblemSubject
): { action?: string; fix: ProblemFix } {
  if (value?.from === "code") {
    const what = field === "metaTitle" ? "the title" : "the description";
    return {
      action: COPY_NOTE,
      fix: { place: "developer", note: CODE_NOTE(page, what) },
    };
  }
  return { fix: { place: "page", tab: "seo", field } };
}

/** The problems with the page's title and description. */
function textProblems(facts: PageFacts): Problem[] {
  const { answer, subject } = facts;
  const problems: Problem[] = [];
  const check = (
    value: Sourced<string> | undefined,
    field: "metaTitle" | "metaDescription",
    limit: number,
    missing: { kind: ProblemKind; what: string; action: string },
    long: { kind: ProblemKind; action: string }
  ) => {
    const { action, fix } = textFix(value, field, subject);
    if (value === undefined) {
      problems.push({
        kind: missing.kind,
        subject,
        what: missing.what,
        action: missing.action,
        fix,
      });
      return;
    }
    const length = characters(value.value);
    if (length > limit) {
      problems.push({
        kind: long.kind,
        subject,
        what: `${length} characters`,
        action: action ?? long.action,
        fix,
      });
    }
  };
  check(
    answer.title,
    "metaTitle",
    TITLE_LIMIT,
    { kind: "noTitle", what: "No title from any level", action: "Add a title" },
    { kind: "longTitle", action: "Shorten the title" }
  );
  check(
    answer.description,
    "metaDescription",
    DESCRIPTION_LIMIT,
    {
      kind: "noDescription",
      what: "No description from any level",
      action: "Add a description",
    },
    { kind: "longDescription", action: "Shorten the description" }
  );
  return problems;
}

/**
 * A canonical a person typed that names an address other than the page's
 * own, which tells search engines to list that one instead.
 */
function canonicalProblem(facts: PageFacts): Problem[] {
  const canonical = facts.answer.canonical;
  if (canonical?.from !== "page" || facts.canonicalIsOwn) return [];
  return [
    {
      kind: "canonical",
      subject: facts.subject,
      what: `Points search engines to ${canonical.value}`,
      action: "Change the official address",
      fix: { place: "page", tab: "seo", field: "canonical" },
    },
  ];
}

/** The page's share image: none at all, or one networks show badly. */
function shareImageProblems(facts: PageFacts): Problem[] {
  const { subject } = facts;
  if (facts.answer.image === undefined) {
    return [
      {
        kind: "shareImage",
        subject,
        what: "No share image from any level, so networks show the link without a picture",
        action: "Add a share image",
        fix: { place: "page", tab: "seo", field: "ogImage" },
      },
    ];
  }
  return facts.shareImage.map(problem => {
    const base = {
      kind: "shareImage" as const,
      subject,
      what: problem.message,
    };
    if (problem.fix === "route") {
      return {
        ...base,
        action: COPY_NOTE,
        fix: {
          place: "developer" as const,
          note: CODE_NOTE(subject, "the share image"),
        },
      };
    }
    // The site's address is missing, which every page shares: said once,
    // of the whole site.
    if (problem.fix === "settings") {
      return {
        ...base,
        subject: WHOLE_SITE,
        action: "Set the address",
        fix: { place: "settings" as const, tab: "general" as const },
      };
    }
    return {
      ...base,
      action: "Make a share image",
      fix: { place: "page" as const, tab: "seo" as const, field: "ogImage" },
    };
  });
}

/** What keeps the page's structured data out, fixed where each detail is kept. */
function structuredDataProblems(facts: PageFacts): Problem[] {
  const { subject } = facts;
  return facts.structuredData.map(problem => {
    const base = {
      kind: "structuredData" as const,
      subject,
      what: problem.message,
    };
    const label =
      problem.detail === "title"
        ? "title"
        : problem.detail === "siteAddress"
          ? "site's address"
          : DETAIL_LABELS[problem.detail];
    switch (problem.fix) {
      case "content":
        return {
          ...base,
          action: `Add the ${label}`,
          fix: {
            place: "page" as const,
            tab: "content" as const,
            ...(problem.field === undefined ? {} : { field: problem.field }),
          },
        };
      // A detail's field is mapped in the plugin's options until the
      // settings offer it.
      case "mapping":
        return {
          ...base,
          action: COPY_NOTE,
          fix: {
            place: "developer" as const,
            note: `${subject.detail ?? subject.label}: no field of ${subject.type ?? "this type"} holds the ${label}. Map one in seoPlugin({ structuredData: { types: { ${subject.type ?? "<type>"}: { details } } } }).`,
          },
        };
      case "settings":
        return {
          ...base,
          subject: WHOLE_SITE,
          action: "Set the address",
          fix: { place: "settings" as const, tab: "general" as const },
        };
      case "route":
        return {
          ...base,
          action: COPY_NOTE,
          fix: {
            place: "developer" as const,
            note: `${subject.detail ?? subject.label}: the route reads the ${label} without the entry it names. Read the page with a depth of at least 1.`,
          },
        };
    }
  });
}

/**
 * Whether an image has alt text, or is marked decorative, where an empty
 * one is right. Text that is blank is no alt text: nothing in an editor
 * tells a forgotten one from a deliberate one, so only the decorative mark
 * says an image needs none.
 */
function described(image: ImageFact): boolean {
  if (image.decorative === true) return true;
  return typeof image.alt === "string" && image.alt.trim() !== "";
}

/** `n image(s): a, b`, as the list names a group of images. */
function imageList(names: readonly string[]): string {
  return `${names.length} ${names.length === 1 ? "image" : "images"}: ${names.join(", ")}`;
}

/**
 * The page's images with no alt text: one problem for those in each field
 * of its content, and one for those kept in the media library, where their
 * alt text is set once for every page that shows them.
 */
function imageAltProblems(facts: PageFacts): Problem[] {
  const groups = new Map<string, { names: string[]; fix: ProblemFix }>();
  for (const image of facts.images) {
    if (described(image)) continue;
    const key = image.media ? "\u0000media" : image.field;
    const group = groups.get(key) ?? {
      names: [],
      fix: image.media
        ? { place: "media" }
        : { place: "page", tab: "content", field: image.field },
    };
    if (!group.names.includes(image.name)) group.names.push(image.name);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    kind: "imageAlt",
    subject: facts.subject,
    what: imageList(group.names),
    action: "Add alt text",
    fix: group.fix,
  }));
}

/** Each link in the page's content to an address on the site that no page holds. */
function brokenLinkProblems(facts: PageFacts): Problem[] {
  return facts.brokenLinks.map(link => ({
    kind: "brokenLink",
    subject: facts.subject,
    what: `Links to ${link.url}, which is not found`,
    action: "Edit the link",
    fix: { place: "page", tab: "content", field: link.field },
  }));
}

/**
 * Every problem `facts` show. A page kept out of search on purpose (its own
 * setting, or its whole type hidden) is checked only for what its visitors
 * meet, a link that leads nowhere and an image with no alt text: how it
 * would show in search or when shared is not a problem it has.
 */
export function pageProblems(facts: PageFacts): Problem[] {
  if (!facts.answer.robots.value.index) {
    return [...brokenLinkProblems(facts), ...imageAltProblems(facts)];
  }
  return [
    ...textProblems(facts),
    ...canonicalProblem(facts),
    ...brokenLinkProblems(facts),
    ...shareImageProblems(facts),
    ...imageAltProblems(facts),
    ...structuredDataProblems(facts),
    ...languageCodeProblems(facts),
  ];
}

/**
 * Whether the canonical the answer names is the page's own address as its
 * language serves it (`served`), on its language's own domain where it has
 * one, else on `origin`. Decided by the rule the sitemap lists pages by, so
 * a page the sitemap leaves out for naming another address is the page
 * this reports. Read as listed, so a page hidden from search is judged too.
 */
export function canonicalIsOwn(
  answer: SeoAnswer,
  origin: string,
  served: string | undefined
): boolean {
  const listed: SeoAnswer = {
    ...answer,
    robots: { value: { index: true, follow: true }, from: "site" },
  };
  const standing = standingOf(listed, origin, served);
  return standing !== null && standing !== "lost";
}
