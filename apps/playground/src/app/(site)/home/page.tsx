/**
 * Public render route for the Homepage single (page-builder M7). Proves singles render
 * identically to collection pages: fetch the single via `findSingle`, hand its
 * page-builder `layout` field to `<PageRenderer>` with the same dataProvider adapter.
 */
import {
  PageRenderer,
  type DataProvider,
} from "@nextlyhq/plugin-page-builder/render";
import { notFound } from "next/navigation";
import { getNextly } from "nextly";

import nextlyConfig from "../../../../nextly.config";

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

interface HomeData {
  layout?: unknown;
}

export default async function HomePage() {
  const nx = await getNextly({ config: nextlyConfig });

  const home = (await nx.findSingle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- single slug is a generated union
    { slug: "homepage" } as any
  )) as HomeData | undefined;

  if (!home?.layout) notFound();

  return (
    <PageRenderer
      document={home.layout as never}
      dataProvider={makeDataProvider(nx)}
    />
  );
}
