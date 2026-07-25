/**
 * Blog post route (page-builder editor-choice demo). Each post picks its editor via the
 * `editorMode` field: "page-builder" renders the visual `layout` through <PageRenderer>;
 * "standard" renders the post's title + excerpt. This mirrors the WordPress + Elementor
 * workflow where each entry chooses the builder or the default editor.
 */
import {
  PageRenderer,
  type DataProvider,
} from "@nextlyhq/plugin-page-builder/render";
import { notFound } from "next/navigation";
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";

import nextlyConfig from "../../../../../nextly.config";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

function makeDataProvider(nx: NextlyInstance): DataProvider {
  return {
    find: async args => {
      // A page-builder layout can Query-Loop any collection, not just posts.
      // Cache each provider read and tag it with ITS collection, so those tags
      // attach to this page and a write to the queried collection revalidates it
      // — otherwise the loop would stay stale once the route is no longer
      // force-dynamic. Public reads (no per-caller filter), so a stable key is
      // fine.
      const collection = args.collection;
      const result = await cachedFind(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Direct API arg shapes vary by slug
        () => nx.find(args as any),
        {
          tags: nextlyTags(collection),
          keyParts: ["pb-find", JSON.stringify(args)],
        }
      );
      return {
        items: result.items ?? [],
      };
    },
    findOne: async ({ collection, id }) => {
      const doc = await cachedFind(() => nx.findByID({ collection, id }), {
        tags: nextlyTags(collection, id),
        keyParts: ["pb-find-one", collection, id],
      });
      return doc ?? null;
    },
    resolveMedia: async () => null,
  };
}

interface PostData {
  title?: string;
  excerpt?: string;
  editorMode?: string;
  layout?: unknown;
}

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const nx = await getNextly({ config: nextlyConfig });
  // Cache the published-post read and tag it with the collection tag, so
  // publishing or editing a post busts the cache and this page regenerates on
  // the next visit — no rebuild, no `force-dynamic`. The read filters by
  // `status: published` only (not by caller), so it is public and safe to cache
  // under a stable, slug-keyed entry shared by every reader.
  const post = await cachedFind<PostData | null>(
    async () => {
      const { items } = await nx.find({
        collection: "posts",
        where: { slug: { equals: slug }, status: { equals: "published" } },
        limit: 1,
      });
      return items[0] ?? null;
    },
    { tags: nextlyTags("posts"), keyParts: ["posts", "detail", slug] }
  );
  if (!post) notFound();

  // Page-builder mode → render the visual layout.
  if (post.editorMode === "page-builder" && post.layout) {
    return (
      <PageRenderer
        document={post.layout as never}
        dataProvider={makeDataProvider(nx)}
      />
    );
  }

  // Standard mode → the default editor's content.
  return (
    <article style={{ maxWidth: 720, margin: "40px auto", padding: "0 24px" }}>
      <h1>{post.title}</h1>
      {post.excerpt ? <p>{post.excerpt}</p> : null}
    </article>
  );
}
