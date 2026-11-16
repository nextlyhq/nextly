/**
 * What the suites on entries and pages contending for one address share: a
 * site whose `posts` are served under `/blog` by a code-declared template
 * address, real saves of its entries, pages and template, and the address
 * store read back as committed.
 *
 * @module __tests__/entry-page-claims-harness
 */
import type { TestNextly } from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, type CollectionConfig } from "nextly/config";

import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";
import { TEMPLATES_SLUG } from "../collections/templates";
import {
  pageBuilderContent,
  type PageBuilderContentProvider,
} from "../page-content";
import { pageBuilder } from "../plugin";

/** The collection whose entries are served at `/blog/<slug>`. */
export const POSTS = "posts";

/** The page builder with `posts` served under `/blog`. */
export function blogPageBuilder(): ReturnType<typeof pageBuilder> {
  return pageBuilder({ templates: { addresses: { [POSTS]: "/blog" } } });
}

/** `posts`, with a Draft/Published lifecycle and a slug of its own. */
export function postsCollection(): CollectionConfig {
  return defineCollection({
    slug: POSTS,
    labels: { singular: "Post", plural: "Posts" },
    status: true,
    fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
  });
}

const PLAIN_PAGE = { formatVersion: 1, kind: "page", nodes: [] };
const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

/** The id of a created document, as the Direct API answers it. */
export const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

/** Save a published post at `/blog/<slug>`, answering the save itself. */
export function savePost(t: TestNextly, slug: string): Promise<unknown> {
  return t.nextly.create({
    collection: POSTS,
    data: { title: `Post ${slug}`, slug, status: "published" },
    overrideAccess: true,
  });
}

/** Save a published page with `slug`, answering the save itself. */
export function savePage(
  t: TestNextly,
  title: string,
  slug: string
): Promise<unknown> {
  return t.nextly.create({
    collection: "pages",
    data: { title, slug, content: PLAIN_PAGE, status: "published" },
    overrideAccess: true,
  });
}

/** Publish the template of `posts`, which serves its entries under `/blog`. */
export async function publishPostsTemplate(t: TestNextly): Promise<string> {
  return idOf(
    await t.nextly.create({
      collection: TEMPLATES_SLUG,
      data: {
        title: "Posts",
        collection: POSTS,
        content: TEMPLATE,
        status: "published",
      },
      overrideAccess: true,
    })
  );
}

/** The content route's provider, over the test's own instance. */
export const pageContent = (t: TestNextly): PageBuilderContentProvider =>
  pageBuilderContent({ nextly: t.nextly as never });

/**
 * Wait for the start-up passes over the address store to finish: the
 * address listing joins them, so what it answers is the store they leave.
 */
export async function startupSettled(
  t: TestNextly
): Promise<readonly (readonly string[])[]> {
  return pageContent(t).addresses(undefined, 100, []);
}

/** Every claim row as stored, of any kind. */
export async function claimRows(
  t: TestNextly
): Promise<Record<string, unknown>[]> {
  const found = await t.nextly.find({
    collection: ADDRESS_CLAIMS_SLUG,
    overrideAccess: true,
    depth: 0,
    limit: 500,
  });
  return found.items as Record<string, unknown>[];
}

/**
 * The claims and waits held, as `<kind> <path> <collection>:<id>`, sorted.
 * Lock rows are left out: they serialise saves, and serve nothing.
 */
export async function held(t: TestNextly): Promise<string[]> {
  return (await claimRows(t))
    .filter(row => row.kind !== "lock")
    .map(
      row =>
        `${String(row.kind)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)}`
    )
    .sort();
}
