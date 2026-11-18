/**
 * The "Use a component ▾" menu's reads and its write: the published
 * components marked for an area, with their pictures once the menu opens,
 * and putting one in a set's area, through the plugin's routes. And "Create
 * a header" on the canvas's band: a new one put in the default's empty area.
 *
 * The write sends through `writePluginRoute`, so it carries the admin's
 * session and CSRF token and rejects with the admin's parsed error when it is
 * refused, and answers what it wrote, from the mutation envelope.
 *
 * @module @nextlyhq/plugin-page-builder/admin/layout-area-client
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  useDocumentLocale,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import {
  areaComponentsPath,
  defaultAreaPath,
  layoutAreaPath,
  type AreaComponentsResponse,
  type PutInAreaBody,
  type WrittenArea,
} from "../layout-area-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** One read of the components marked for an area, as the hook answers it. */
export interface AreaComponentsRead {
  readonly data: AreaComponentsResponse | undefined;
  readonly error: unknown;
  readonly refetch: () => void;
}

/**
 * The published components marked for `area`, in the language being edited,
 * with their pictures' definitions when `pictures` is asked. Asked again on
 * every mount: a component published in another tab is a choice the author
 * should see.
 */
export function useAreaComponents(
  area: RegionArea,
  ask: { readonly enabled?: boolean; readonly pictures?: boolean } = {}
): AreaComponentsRead {
  const locale = useDocumentLocale()?.code ?? null;
  const read = usePluginRoute<AreaComponentsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: areaComponentsPath(area, {
      locale,
      ...(ask.pictures === true ? { pictures: true } : {}),
    }),
    enabled: ask.enabled ?? true,
    staleTime: 0,
  });
  return { data: read.data, error: read.error, refetch: read.refetch };
}

/**
 * Put `component` in `area` of set `setId`, published, answering what was
 * written and the route's sentence saying so.
 */
export async function putComponentInArea(
  setId: string,
  area: RegionArea,
  component: string
): Promise<{ readonly message: string; readonly item: WrittenArea }> {
  const answer = await writePluginRoute<{
    message?: string;
    item?: WrittenArea;
  }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: layoutAreaPath(setId, area),
    method: "PATCH",
    body: { component } satisfies PutInAreaBody,
  });
  if (answer?.item === undefined) {
    throw new Error("The set route answered without what it wrote.");
  }
  return { message: answer.message ?? "", item: answer.item };
}

/**
 * Create a header (or footer) from the starter's design and put it in the
 * site default's empty `area`, answering what was written and the route's
 * sentence saying so. The default is found on the server.
 */
export async function createInDefaultArea(
  area: RegionArea
): Promise<{ readonly message: string; readonly item: WrittenArea }> {
  const answer = await writePluginRoute<{
    message?: string;
    item?: WrittenArea;
  }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: defaultAreaPath(area),
    method: "POST",
    body: {},
  });
  if (answer?.item === undefined) {
    throw new Error("The default area route answered without what it wrote.");
  }
  return { message: answer.message ?? "", item: answer.item };
}
