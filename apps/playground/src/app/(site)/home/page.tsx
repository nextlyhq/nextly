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

type NextlyInstance = Awaited<ReturnType<typeof getNextly>>;

function makeDataProvider(nx: NextlyInstance): DataProvider {
  return {
    find: async args => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Direct API arg shapes vary by slug
      const result = await nx.find(args as any);
      return { items: result.items ?? [] };
    },
    findOne: async ({ collection, id }) => {
      const doc = await nx.findByID({ collection, id });
      return doc ?? null;
    },
    resolveMedia: async () => null,
  };
}

interface HomeData {
  layout?: unknown;
}

export default async function HomePage() {
  const nx = await getNextly({ config: nextlyConfig });

  const home = (await nx.findSingle({ slug: "homepage" })) as
    | HomeData
    | undefined;

  if (!home?.layout) notFound();

  return (
    <PageRenderer
      document={home.layout as never}
      dataProvider={makeDataProvider(nx)}
    />
  );
}
