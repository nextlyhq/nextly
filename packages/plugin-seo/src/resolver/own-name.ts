/**
 * A page's own name: what its heading shows, which `{Title}` stands for in a
 * title pattern, structured data names the page by, and llms.txt,
 * llms-full.txt and a page's plain-text copy list it under. One answer, so
 * none of them names a page differently.
 *
 * A type's pages are named from the first of its title fields with a value:
 * the field the site's options choose for the type (`titleFields`), else the
 * one its admin names its entries by (`admin.useAsTitle`), else the usual
 * `title`, `name` and `heading`. A Single's `title` is Nextly's own unless
 * its author declared it, filled from the Single's label ("Blog Page"), so
 * it names the page only where nothing better does: the route's own title
 * comes first.
 *
 * @module resolver/own-name
 */
import {
  ownIdentityFieldNames,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { singleDeclaration } from "../bulk/singles";
import { nameOfAddress } from "../code-pages/store";
import { plainTitle } from "../outputs/plain-copy";
import { isRecord, textOf } from "../plain-values";
import { TITLE_FIELDS } from "../settings/patterns";
import { valueAtPath } from "../value-path";

/**
 * The field each content type's pages are named from, by its key (a
 * collection's slug, or `single:<slug>`), as the site's options choose it: a
 * field's name, or a dotted path into a group (`hero.heading`).
 */
export type TitleFields = Readonly<Record<string, string>>;

/** Where a type's pages take their name from. */
export interface TitleSources {
  /** The fields read, in order, the first with a value naming the page. */
  fields: readonly string[];
  /**
   * The Single's `title` is Nextly's, filled from its label: read only where
   * nothing else names the page, after the route's own title.
   */
  labelTitle: boolean;
}

/** A collection's declaration in the app's configuration, where it is there. */
function collectionDeclaration(
  ctx: PluginContext,
  slug: string
): Record<string, unknown> | undefined {
  const declared: readonly unknown[] = ctx.config.collections ?? [];
  return declared.find(
    (entity): entity is Record<string, unknown> =>
      isRecord(entity) && entity.slug === slug
  );
}

/**
 * Whether the Single `slug`'s `title` is Nextly's rather than its author's,
 * by the rule the admin's editor and the save path read: one its author did
 * not declare. A Single made in the Schema Builder has no declaration, and
 * its `title` is always Nextly's.
 */
function titleIsNextlys(ctx: PluginContext, slug: string): boolean {
  const declared = singleDeclaration(ctx, slug)?.fields;
  return !ownIdentityFieldNames(
    Array.isArray(declared) ? declared : undefined
  ).includes("title");
}

/**
 * The fields the pages of the type `key` are named from, in the order they
 * are read: the field `chosen` names for it, the field its admin names its
 * entries by, then `title`, `name` and `heading`, each once. A Single's
 * `title` that is Nextly's is left out, and said to be.
 */
export function titleSourcesOf(
  ctx: PluginContext,
  key: string,
  chosen?: TitleFields
): TitleSources {
  const single = key.startsWith("single:");
  const labelTitle = single && titleIsNextlys(ctx, key.slice("single:".length));
  const admin = single ? undefined : collectionDeclaration(ctx, key)?.admin;
  const useAsTitle = isRecord(admin) ? textOf(admin.useAsTitle) : undefined;
  const fields: string[] = [];
  const add = (field: string | undefined) => {
    if (field === undefined || field === "id" || fields.includes(field)) {
      return;
    }
    fields.push(field);
  };
  // A field the site chose is read even where it is the Single's `title`.
  add(chosen?.[key]);
  add(useAsTitle);
  for (const field of TITLE_FIELDS) {
    if (!(labelTitle && field === "title")) add(field);
  }
  return { fields, labelTitle };
}

/**
 * The page's title from the first of `fields` holding one, as text with no
 * markup, and the field it came from; none where none holds any.
 */
export function ownTitleIn(
  document: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): { value: string; field: string } | undefined {
  for (const field of fields) {
    const value = plainTitle(textOf(valueAtPath(document, field)));
    if (value !== undefined) return { value, field };
  }
  return undefined;
}

/** A separator between a title and the site's name after it. */
const BEFORE_SITE_NAME = /\s*[|—–·:-]\s*$/;

/**
 * `title` without the site's name its pattern put after it, so
 * "Pricing | Acme" names the page "Pricing". A title that only ends with
 * the name, with no separator before it ("Why we chose Acme"), is kept.
 */
function withoutSiteName(
  title: string | undefined,
  siteName: string | undefined
): string | undefined {
  const text = textOf(title);
  if (text === undefined || siteName === undefined) return text;
  const name = siteName.trim().toLowerCase();
  if (name === "" || !text.toLowerCase().endsWith(name)) return text;
  const before = text.slice(0, text.length - name.length);
  if (!BEFORE_SITE_NAME.test(before)) return text;
  return textOf(before.replace(BEFORE_SITE_NAME, "")) ?? text;
}

/** What a page's own name is worked out from. */
export interface NamedPage {
  /** The name its route gives it, where the route names it. */
  hint?: string;
  /** The site's home page, named by its whole title. */
  home: boolean;
  /** Its stored document: its content, or a page built in code's record. */
  document: Readonly<Record<string, unknown>>;
  /** The fields it is named from (`titleSourcesOf`). */
  fields: readonly string[];
  /** The title its route's code gives it. */
  codeTitle?: string;
  /** A page built in code, whose record names it from its address. */
  codePage: boolean;
  /** The title its head carries. */
  title?: string;
  /** The site's name, which a title's pattern puts after the page's own. */
  siteName?: string;
}

/**
 * The page's own name, as its heading shows it: what its route names it,
 * else its own title field, else its route's title or its head's title,
 * each without the site's name, and none with any markup.
 *
 * The home page is the exception: it is named by its whole title, which is
 * the site's own, since a home page's title field is usually just "Home".
 * A page built in code is named from its address (`/pricing` is "Pricing")
 * only where its route gives no title, so there its route's title wins.
 */
export function pageNameOf(page: NamedPage): string | undefined {
  const fromRoute = plainTitle(textOf(page.hint));
  if (fromRoute !== undefined) return fromRoute;
  if (page.home) return plainTitle(textOf(page.title));
  const fromCode = withoutSiteName(
    plainTitle(textOf(page.codeTitle)),
    page.siteName
  );
  const own = ownTitleIn(page.document, page.fields)?.value;
  const path = textOf(page.document.path);
  const fromAddress =
    page.codePage &&
    path !== undefined &&
    own === nameOfAddress(path) &&
    fromCode !== undefined;
  return (
    (fromAddress ? undefined : own) ??
    fromCode ??
    withoutSiteName(plainTitle(textOf(page.title)), page.siteName)
  );
}
