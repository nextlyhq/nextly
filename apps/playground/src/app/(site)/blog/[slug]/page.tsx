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

import nextlyConfig from "../../../../../nextly.config";

// DB-backed page: render per-request; never prerendered at build (the build
// environment has no database).
export const dynamic = "force-dynamic";

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

function makeDataProvider(nx: NextlyInstance): DataProvider {
  return {
    find: async args => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Direct API arg shapes vary by slug
      const result = await nx.find(args as any);
      return {
        items: (result.items ?? []) as unknown as Record<string, unknown>[],
      };
    },
    findOne: async ({ collection, id }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- slug is a generated union
      const doc = await nx.findByID({ collection, id } as any);
      return (doc ?? null) as Record<string, unknown> | null;
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
  const { items } = await nx.find({
    collection: "posts",
    where: { slug: { equals: slug }, status: { equals: "published" } },
    limit: 1,
  });
  const post = items[0] as PostData | undefined;
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
