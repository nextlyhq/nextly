/**
 * The Pages panel's header & footer set writes, one function each: rename a
 * set and copy one, through the plugin's routes.
 *
 * Each sends through `writePluginRoute`, so it carries the admin's session
 * and CSRF token and rejects with the admin's parsed error when core refuses
 * it, and each answers the set as written, from the mutation envelope.
 *
 * @module @nextlyhq/plugin-page-builder/admin/layout-writes-client
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  layoutDuplicatePath,
  layoutTitlePath,
  type WrittenLayout,
} from "../layout-writes-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** One write to a set route, answered by the set its envelope carries. */
async function writeLayout(
  method: "POST" | "PATCH",
  path: string,
  body?: { title: string }
): Promise<WrittenLayout> {
  const answer = await writePluginRoute<{ item?: WrittenLayout }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path,
    method,
    ...(body === undefined ? {} : { body }),
  });
  if (answer?.item === undefined) {
    throw new Error("The set route answered without the set it wrote.");
  }
  return answer.item;
}

/** Give the set a new title, and change nothing else. */
export function renameLayout(
  id: string,
  title: string
): Promise<WrittenLayout> {
  return writeLayout("PATCH", layoutTitlePath(id), { title });
}

/** Copy the set as a draft titled "Copy of" its title. */
export function duplicateLayout(id: string): Promise<WrittenLayout> {
  return writeLayout("POST", layoutDuplicatePath(id));
}
