/**
 * Site code: the routes that read, check and save the code every published
 * page carries.
 */
import type { PluginRoute } from "@nextlyhq/plugin-sdk";

import { siteCodeRoutes } from "../site-code/route";
import { MANAGE_SITE_PERMISSION } from "../site-settings";

import type { Definition } from "./state";

/** The routes site code contributes, by name. */
export function routesForSiteCode(def: Definition): {
  readonly siteCode: PluginRoute[];
} {
  const { opts } = def;
  return {
    // The site's code, read, checked and saved under the site settings
    // permission; saved by a signed-in person only.
    siteCode: siteCodeRoutes({
      nextly: async () => {
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const nextly = await getCachedNextly();
        return {
          findSingle: args => nextly.findSingle(args),
          updateSingle: args => nextly.updateSingle(args),
        };
      },
      options: opts.siteCode,
      permission: MANAGE_SITE_PERMISSION,
      // Read as the server, for "Last changed by": the name only.
      personName: async id => {
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const nextly = await getCachedNextly();
        const person = await nextly.users.findByID({ id });
        return typeof person?.name === "string" && person.name !== ""
          ? person.name
          : null;
      },
    }),
  };
}
