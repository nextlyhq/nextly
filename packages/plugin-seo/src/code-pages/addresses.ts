/**
 * Every public address the site knows of: each published entry at the
 * address its content type declares, each page a route renders from its own
 * code, and each address a route with a variable part declared. Each says
 * where it comes from, its title on Google, and whether search engines are
 * told to list it; a page built in code also says whether its route calls
 * the plugin's metadata function, without which nothing set for it reaches
 * the page.
 *
 * Every value is the one answer the page's head is built from.
 *
 * @module code-pages/addresses
 */
import {
  NextlyError,
  publicAddressOf,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { absolute, resolveIn } from "../languages/versions";
import { candidates, type Candidate } from "../outputs/listing";
import { isRecord, textOf } from "../plain-values";
import type { SeoAnswer, Sourced } from "../resolver/order";
import type { ReadRules } from "../resolver/provider";

import { codePages, resolveCodePage, type CodePage } from "./answers";
import type {
  AddressStanding,
  AutomaticValue,
  CodePageSeo,
  PreviewImage,
  SiteAddress,
} from "./contract";
import type { CodeRoute } from "./routes";
import { nameOfAddress, type CodePageRow } from "./store";

/** How an answer stands with search engines. */
function standingOfAnswer(answer: SeoAnswer): AddressStanding {
  if (answer.robots.value.index) return "listed";
  return answer.robots.from === "type" ? "type-hidden" : "hidden";
}

/** An automatic value as the screen names where it came from. */
function automatic(
  value: Sourced<string> | undefined
): AutomaticValue | undefined {
  if (value === undefined) return undefined;
  const from =
    value.from === "code" ||
    value.from === "pattern" ||
    value.from === "content"
      ? value.from
      : "site";
  return {
    value: value.value,
    from,
    ...(value.pattern === undefined ? {} : { pattern: value.pattern }),
  };
}

/** Whatever of `values` is defined, as an object to spread. */
function present<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/** What a person typed for a page built in code, as the panel shows it. */
function typedOf(row: CodePageRow | undefined): CodePageSeo["typed"] {
  return {
    hidden: row?.noindex === true,
    ...present({
      title: row?.metaTitle,
      description: row?.metaDescription,
      image: row?.ogImage,
    }),
  };
}

/** The share image an answer serves, as the preview shows it. */
function previewImageOf(answer: SeoAnswer): PreviewImage | undefined {
  if (answer.image === undefined) return undefined;
  const { url, width, height } = answer.image.value;
  return {
    url,
    ...present({ width, height }),
    own: answer.image.from === "page",
  };
}

/** The address an answer names, made absolute on the site's origin. */
function canonicalOf(answer: SeoAnswer, origin: string): string | undefined {
  if (answer.canonical === undefined) return undefined;
  return absolute(answer.canonical.value, origin) ?? undefined;
}

/**
 * What a page built in code would show with nothing typed for it: the
 * automatic values the panel offers beneath a person's own.
 */
async function automaticOf(
  ctx: PluginContext,
  page: CodePage,
  readRules: ReadRules | undefined
): Promise<CodePageSeo["automatic"]> {
  const { route, row, answer } = page;
  const beneath =
    row === undefined
      ? answer
      : await resolveCodePage(
          ctx,
          route.path,
          { ...row, metaTitle: undefined, metaDescription: undefined },
          readRules
        );
  return present({
    title: automatic(beneath.title),
    description: automatic(beneath.description),
  });
}

/** A page built in code as the screen lists it. */
async function codeAddressOf(
  ctx: PluginContext,
  page: CodePage,
  site: { origin: string; name: string | undefined },
  readRules: ReadRules | undefined
): Promise<SiteAddress> {
  const { route, row, answer } = page;
  const seo: CodePageSeo = {
    typed: typedOf(row),
    automatic: await automaticOf(ctx, page, readRules),
    ...present({ image: previewImageOf(answer), siteName: site.name }),
  };
  return {
    path: route.path,
    name: row?.name ?? nameOfAddress(route.path),
    source: route.source,
    from: route.route,
    standing:
      row?.connected === true ? standingOfAnswer(answer) : "not-connected",
    ...present({
      title: answer.title?.value,
      canonical: canonicalOf(answer, site.origin),
    }),
    seo,
  };
}

/** The label the admin's lists use for a content type. */
async function labelOf(
  ctx: PluginContext,
  type: PublicAddressType
): Promise<string> {
  if (type.kind === "collection") {
    try {
      const meta: unknown = await ctx.services.collections.getCollection(
        type.slug,
        {}
      );
      const labels = isRecord(meta) && isRecord(meta.labels) ? meta.labels : {};
      const label = textOf(labels.plural) ?? textOf(labels.singular);
      if (label !== undefined) return label;
    } catch (error) {
      if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
    }
  }
  return nameOfAddress(`/${type.slug}`);
}

/** The label of each content type, read once for a whole listing. */
function labelsOf(
  ctx: PluginContext
): (type: PublicAddressType) => Promise<string> {
  const labels = new Map<string, Promise<string>>();
  return type => {
    const key = `${type.kind}:${type.slug}`;
    let label = labels.get(key);
    if (label === undefined) {
      label = labelOf(ctx, type);
      labels.set(key, label);
    }
    return label;
  };
}

/** One published entry as the screen lists it, where it has an address. */
async function entryAddressOf(
  ctx: PluginContext,
  candidate: Candidate,
  options: {
    language: string;
    origin: string;
    label: (type: PublicAddressType) => Promise<string>;
    readRules: ReadRules | undefined;
  }
): Promise<SiteAddress | undefined> {
  const { type, holder, document } = candidate;
  const own = await publicAddressOf(type, document, options.language);
  if (own.status !== "resolved") return undefined;
  const label = await options.label(type);
  const answer = await resolveIn(
    ctx,
    type,
    document,
    options.language,
    options.readRules
  );
  return {
    path: own.path,
    name: textOf(document.title) ?? textOf(document.name) ?? label,
    source: "entry",
    from: label,
    standing: standingOfAnswer(answer),
    ...present({
      title: answer.title?.value,
      canonical: canonicalOf(answer, options.origin),
    }),
    entry: { kind: type.kind, slug: type.slug, id: holder.id },
  };
}

/** Each published entry at its declared address, in the site's language. */
async function entryAddresses(
  ctx: PluginContext,
  origin: string,
  readRules: ReadRules | undefined
): Promise<SiteAddress[]> {
  const options = {
    language: await ctx.publicAddresses.defaultLanguage(),
    origin,
    label: labelsOf(ctx),
    readRules,
  };
  const found: SiteAddress[] = [];
  for await (const batch of candidates(ctx, { origin })) {
    for (const candidate of batch) {
      const address = await entryAddressOf(ctx, candidate, options);
      if (address !== undefined) found.push(address);
    }
  }
  return found;
}

/**
 * Every public address the site knows of, by address: its entries first
 * where an entry and a route name one address, since the entry's `seo`
 * group is then the address's one home for its SEO.
 */
export async function siteAddresses(
  ctx: PluginContext,
  options: {
    origin: string;
    routes: readonly CodeRoute[];
    readRules?: ReadRules;
  }
): Promise<SiteAddress[]> {
  const entries = await entryAddresses(ctx, options.origin, options.readRules);
  const entryPaths = new Set(entries.map(entry => entry.path));
  const pages = await codePages(
    ctx,
    options.routes,
    options.readRules,
    entryPaths
  );
  const rules = await options.readRules?.(ctx, undefined);
  const site = { origin: options.origin, name: rules?.siteName };
  const code: SiteAddress[] = [];
  for (const page of pages) {
    code.push(await codeAddressOf(ctx, page, site, options.readRules));
  }
  return [...entries, ...code].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}
