/**
 * The blog fixture: the blog template's own collections, registered for the
 * browser suite only (`NEXTLY_E2E_STYLE_FIXTURE=1`), so its post page can be
 * rebuilt with a collection template and compared with the page the template
 * writes by hand.
 *
 * Built from the template's definitions, not a copy of them, so the fixture
 * cannot drift from what a scaffolded blog stores: the same fields, the same
 * hooks (the slug from the title, the reading time, the featured image's alt
 * check, the byline from the writer's profile) and the same access rules.
 * Only two things change:
 *
 * - **The slugs**, under `journal-`, because this app already has its own
 *   `posts`, `categories`, `tags` and `authors`, with other fields. The
 *   relations between the four are pointed at the renamed ones; `author` (the
 *   owning account) and the media fields keep `users` and `media`. The posts'
 *   hooks are made again for `journal-authors`, so a post is credited from
 *   the fixture's profiles, not this app's own `authors`.
 * - **A blocks field on the posts**, `postBlocks`, which the template's Entry
 *   content block draws below the article: a post's own blocks, which the
 *   scaffolded blog does not have.
 *
 * The posts are served at `/journal/<slug>` with their template
 * (`nextly.config.ts`), and their author, category and tag links name the
 * hand-written pages' addresses (`./links`).
 *
 * @module blog-fixture/collections
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineCollection, type CollectionConfig } from "nextly/config";

import { Authors } from "../../../../templates/blog/src/collections/Authors";
import { Categories } from "../../../../templates/blog/src/collections/Categories";
import {
  Posts,
  postsHooks,
} from "../../../../templates/blog/src/collections/Posts";
import { Tags } from "../../../../templates/blog/src/collections/Tags";

/** Each of the template's collections, by the slug it has here. */
export const JOURNAL = {
  posts: "journal-posts",
  authors: "journal-authors",
  categories: "journal-categories",
  tags: "journal-tags",
} as const;

/** The template's slug of each collection, to the slug it has here. */
const RENAMED: Readonly<Record<string, string>> = {
  [Posts.slug]: JOURNAL.posts,
  [Authors.slug]: JOURNAL.authors,
  [Categories.slug]: JOURNAL.categories,
  [Tags.slug]: JOURNAL.tags,
};

/**
 * A field with its relation pointed at the renamed collection. Only a
 * top-level field's own `relationTo` is read: none of the template's four
 * collections relates to another from inside a group.
 */
function repointed<F extends CollectionConfig["fields"][number]>(field: F): F {
  if (!("relationTo" in field) || typeof field.relationTo !== "string") {
    return field;
  }
  const target = RENAMED[field.relationTo];
  return target === undefined ? field : { ...field, relationTo: target };
}

/** The fields a collection may declare, a plugin's among them. */
type DeclaredFields = Parameters<typeof defineCollection>[0]["fields"];

/**
 * The template's collection `source`, under `slug` and the given labels, with
 * `extraFields` after its own, and `hooks` in place of its own where a hook
 * names another of the four by its slug. Defined again, so the renamed
 * collection is validated as the template's own is.
 */
function renamed(
  source: CollectionConfig,
  slug: string,
  labels: { singular: string; plural: string },
  extraFields: DeclaredFields = [],
  hooks: CollectionConfig["hooks"] = source.hooks
): CollectionConfig {
  return defineCollection({
    ...source,
    slug,
    labels,
    fields: [...source.fields.map(repointed), ...extraFields],
    hooks,
  });
}

const JournalPosts = renamed(
  Posts,
  JOURNAL.posts,
  { singular: "Journal post", plural: "Journal posts" },
  [blocks({ name: "postBlocks", label: "Post blocks" })],
  postsHooks({ authors: JOURNAL.authors })
);

const JournalAuthors = renamed(Authors, JOURNAL.authors, {
  singular: "Journal author",
  plural: "Journal authors",
});

const JournalCategories = renamed(Categories, JOURNAL.categories, {
  singular: "Journal category",
  plural: "Journal categories",
});

const JournalTags = renamed(Tags, JOURNAL.tags, {
  singular: "Journal tag",
  plural: "Journal tags",
});

/** The four, in the order the config registers them. */
export const JOURNAL_COLLECTIONS: readonly CollectionConfig[] = [
  JournalAuthors,
  JournalCategories,
  JournalTags,
  JournalPosts,
];
