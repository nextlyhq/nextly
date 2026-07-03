/**
 * Public page-builder render route (page-builder M3.3). This is the ONE place the host
 * app wires the CMS into the renderer: it initializes the Direct API and hands the
 * page's block tree to `<PageRenderer>`. The plugin itself never imports `getNextly`.
 */
import {
  PageRenderer,
  type DataProvider,
} from "@nextlyhq/plugin-page-builder/render";
import { notFound } from "next/navigation";
import { getNextly } from "nextly";

import nextlyConfig from "../../../../nextly.config";

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
    // Real media resolution can hook in here; the block stores a denormalized url.
    resolveMedia: async () => null,
  };
}

interface PageData {
  title?: string;
  content?: unknown;
  customCss?: string;
  editorMode?: string;
  body?: string;
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const nx = await getNextly({ config: nextlyConfig });
  const { items } = await nx.find({
    collection: "pages",
    where: {
      slug: { equals: slug.join("/") },
      status: { equals: "published" },
    },
    limit: 1,
    // Return rich-text fields as HTML so normal-editor pages render directly.
    richTextFormat: "html",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- richTextFormat is a query option
  } as any);

  const page = items[0] as PageData | undefined;
  if (!page) notFound();

  // Normal editor → render Nextly's rich-text body.
  if (page.editorMode === "normal") {
    return (
      <article
        style={{ maxWidth: 760, margin: "48px auto", padding: "0 24px" }}
        dangerouslySetInnerHTML={{ __html: page.body ?? "" }}
      />
    );
  }

  if (!page.content) notFound();
  return (
    <PageRenderer
      document={page.content as never}
      customCss={page.customCss}
      dataProvider={makeDataProvider(nx)}
    />
  );
}
