/**
 * A page's language links in its head: `<link rel="alternate" hreflang>` for
 * each language the page is published in and stands for itself in, itself
 * included, and `x-default` at the default language's.
 *
 * Every version is read and resolved in its own language, the one being
 * served too, so the page in each language names the same versions at the
 * same addresses: the links are reciprocal, and each points where that
 * version's own canonical does.
 *
 * @module languages/head
 */
import {
  publicAddressOf,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { productionAddressesOf } from "../canonical";
import { idOf, typeOf } from "../resolver/page-levels";
import { overAnswer, type ReadRules } from "../resolver/provider";
import { readSeoRules } from "../settings/rules";

import type { LanguageCodeProblem } from "./hreflang";
import {
  languageLinks,
  type LanguageLink,
  type LanguageVersion,
} from "./links";
import {
  documentsIn,
  heldLanguages,
  onceEach,
  otherLanguages,
  resolveIn,
  servedAt,
  singleIn,
  standingOf,
} from "./versions";

/**
 * The origin a version's canonical is compared on where the site states none
 * of its own: a typed canonical written as a full address then counts as the
 * page's own only where it is written as a path.
 */
const NO_ORIGIN = "https://site.invalid";

/** A page's language links, and the languages left out for their code. */
export interface PageLanguageLinks {
  /** None where the page has no other language it stands for itself in. */
  links: LanguageLink[];
  problems: LanguageCodeProblem[];
}

/**
 * The version of a page in `language`, read and resolved in it, where it is
 * published at one of `paths` and stands for itself there; null otherwise.
 */
async function versionIn(
  ctx: PluginContext,
  page: { type: PublicAddressType; id: string; paths: ReadonlySet<string> },
  language: string,
  readRules: ReadRules,
  origin: string
): Promise<LanguageVersion | null> {
  const { type, id } = page;
  const document =
    type.kind === "single"
      ? await singleIn(type.slug, language)
      : ((await documentsIn(ctx, type, [id], language)).get(id) ?? null);
  if (document === null) return null;
  const own = await publicAddressOf(type, document, language);
  // The record says where the version is published; a version whose address
  // has moved since is not linked until the record follows it.
  if (own.status !== "resolved" || !page.paths.has(own.path)) return null;
  const answer = await resolveIn(ctx, type, document, language, readRules);
  const standing = standingOf(
    answer,
    origin,
    await servedAt(own.path, language)
  );
  return standing === null || standing === "lost"
    ? null
    : { language, href: standing.href };
}

/**
 * The language links of the page `input` names, read in the language the
 * route served it in, or the site's default where it names none. None where
 * the version served does not stand for itself: a page hidden from search,
 * or one naming another page as its canonical, links to no other language.
 */
export async function pageLanguageLinks(
  ctx: PluginContext,
  input: PageMetadataInput,
  readRules: ReadRules = readSeoRules
): Promise<PageLanguageLinks> {
  const { type, key, document } = typeOf(input);
  const id = idOf(document);
  const held = (await heldLanguages(ctx, key, [id])).get(id);
  // Published in one language at most: there is nothing to link to.
  if (held === undefined || held.size < 2) return { links: [], problems: [] };
  const defaultLanguage = await ctx.publicAddresses.defaultLanguage();
  // Read once for each language, not once for each version resolved in it.
  const readOnce = onceEach(readRules);
  const rules = await readOnce(ctx, undefined);
  const origin =
    productionAddressesOf(rules.productionAddresses)[0] ?? NO_ORIGIN;
  const versions: LanguageVersion[] = [];
  for (const language of [
    defaultLanguage,
    ...otherLanguages([held], defaultLanguage),
  ]) {
    const paths = held.get(language);
    const version =
      paths === undefined
        ? null
        : await versionIn(ctx, { type, id, paths }, language, readOnce, origin);
    if (version !== null) versions.push(version);
  }
  const served = input.locale ?? defaultLanguage;
  const { links, problems } = languageLinks(versions, defaultLanguage);
  return versions.some(version => version.language === served)
    ? { links, problems }
    : { links: [], problems };
}

/**
 * `resolver` with each page's language links added to its answer, as the
 * `languages` core turns into the head's `alternates`. The versions are the
 * page's own document in its other languages and the address record, which
 * the head's own cache tags already cover.
 */
export function withLanguageLinks(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  readRules: ReadRules = readSeoRules
): PageMetadataResolver {
  return overAnswer(resolver, async (answer, input) => {
    const { links } = await pageLanguageLinks(ctx, input, readRules);
    if (links.length === 0) return answer;
    return {
      ...answer,
      languages: Object.fromEntries(
        links.map(link => [link.hreflang, link.href])
      ),
    };
  });
}
