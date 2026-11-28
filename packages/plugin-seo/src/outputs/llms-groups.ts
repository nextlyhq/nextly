/**
 * The sections the llms files list the site's pages under, as the site
 * chose them in the SEO settings (`aiFiles`): each page's group (its
 * content type, or, for a page built in code, its folder), the heading the
 * group is listed under, its place in the list, and whether it is listed at
 * all or under "Optional". One reading for llms.txt, llms-full.txt, a
 * folder's own files and the settings screen's list of groups, so the
 * screen offers exactly the groups the files write.
 *
 * @module outputs/llms-groups
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { codePagesSlug } from "../code-pages/collection";
import { isRecord, textOf } from "../plain-values";
import {
  addressStartsWith,
  codeFolders,
  codeGroupHeading,
  codeGroupKey,
  inFolder,
  OPTIONAL_HEADING,
  SINGLES_HEADING,
  type AiFiles,
  type AiFilesGroup,
} from "../settings/ai-files";

import type { ListedPage } from "./listing";

/** One group of the site's pages, as the llms files and the settings screen name it. */
export interface LlmsGroup {
  key: string;
  /** The heading it is listed under unless the site renames it. */
  defaultHeading: string;
  /** How many listed pages it holds. */
  pages: number;
}

/** A listed page, with its group and the section it is written under. */
export interface GroupedPage {
  page: ListedPage;
  /** Its group's key. */
  key: string;
  /** The heading it is listed under: its group's, or "Optional". */
  section: string;
}

/** The pages the llms files list, in their order, and every group the listing holds. */
export interface LlmsList {
  /** The pages listed, in the order the files write them; groups left out are not among them. */
  listed: GroupedPage[];
  /** Every group the listing holds, left out or not, in the listing's order. */
  groups: LlmsGroup[];
}

/** A collection's plural label, as the admin's lists use it. */
async function collectionLabel(
  ctx: PluginContext,
  slug: string
): Promise<string> {
  const meta: unknown = await ctx.services.collections.getCollection(slug, {});
  const record = isRecord(meta) ? meta : {};
  const labels = isRecord(record.labels) ? record.labels : {};
  return (
    textOf(labels.plural) ??
    textOf(labels.singular) ??
    textOf(record.label) ??
    slug
  );
}

/**
 * `pages`, the listing's, grouped and ordered as `files` chooses: the
 * groups the site placed first, in its order, then the rest in the order
 * the listing reaches them, each page keeping its place within its group.
 * A group the site leaves out is not listed; one it lists under "Optional"
 * is written there, which llms.txt writes last. Each type's label is read
 * once.
 */
export async function llmsListOf(
  ctx: PluginContext,
  pages: readonly ListedPage[],
  files: AiFiles | undefined
): Promise<LlmsList> {
  const codeSlug = codePagesSlug(ctx);
  const isCode = (page: ListedPage) => page.holder.collection === codeSlug;
  const folders = codeFolders(pages.filter(isCode).map(page => page.path));
  const keyOf = (page: ListedPage) =>
    isCode(page) ? codeGroupKey(page.path, folders) : page.holder.collection;
  const groups = new Map<string, LlmsGroup>();
  for (const page of pages) {
    const key = keyOf(page);
    const known = groups.get(key);
    if (known !== undefined) {
      known.pages += 1;
      continue;
    }
    groups.set(key, {
      key,
      defaultHeading: isCode(page)
        ? codeGroupHeading(key)
        : key.startsWith("single:")
          ? SINGLES_HEADING
          : await collectionLabel(ctx, key),
      pages: 1,
    });
  }
  const chosen = new Map<string, AiFilesGroup>(
    (files?.groups ?? []).map(group => [group.key, group])
  );
  // The site's order first; a group it never placed after them all, in the
  // listing's order.
  const placed = (files?.groups ?? []).map(group => group.key);
  const unplaced = [...groups.keys()].filter(key => !chosen.has(key));
  const rank = new Map(
    [...placed, ...unplaced].map((key, place) => [key, place])
  );
  const listed = pages
    .map((page, at) => ({ page, at, key: keyOf(page) }))
    .filter(({ key }) => chosen.get(key)?.leftOut !== true)
    .sort(
      (a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0) || a.at - b.at
    )
    .map(({ page, key }) => {
      const choice = chosen.get(key);
      return {
        page,
        key,
        section:
          choice?.optional === true
            ? OPTIONAL_HEADING
            : (choice?.heading ??
              groups.get(key)?.defaultHeading ??
              SINGLES_HEADING),
      };
    });
  return { listed, groups: [...groups.values()] };
}

/** A listed page's address, from the root of the host it is served at. */
const servedPath = (page: ListedPage): string => new URL(page.loc).pathname;

/**
 * The pages of `listed` llms-full.txt holds, as `files` chooses: every one,
 * those of the groups chosen, or those whose address starts with one of the
 * paths chosen.
 */
export function inFullFile(
  listed: readonly GroupedPage[],
  files: AiFiles | undefined
): GroupedPage[] {
  const contents = files?.fullContents;
  if (contents === undefined || contents.include === "everything") {
    return [...listed];
  }
  if (contents.include === "groups") {
    const keys = new Set(contents.groups);
    return listed.filter(each => keys.has(each.key));
  }
  return listed.filter(each =>
    contents.prefixes.some(prefix =>
      addressStartsWith(servedPath(each.page), prefix)
    )
  );
}

/** The pages of `listed` in `folder`: its own page, and every page under it. */
export const inFolderFiles = (
  listed: readonly GroupedPage[],
  folder: string
): GroupedPage[] =>
  listed.filter(each => inFolder(servedPath(each.page), folder));
