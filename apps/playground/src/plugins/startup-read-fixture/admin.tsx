"use client";

/**
 * The startup read fixture's page, registered by a side-effect import in the
 * playground's admin route, as a real app loads a plugin's admin components.
 * It reads its plugin's route as any plugin page does, with `usePluginRoute`,
 * and draws what the route answers.
 */
import { registerComponents, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  STARTUP_READ_PAGE_COMPONENT,
  STARTUP_READ_PLUGIN,
  STARTUP_READ_ROUTE,
} from "./constants";

function StartupReadPage() {
  const greeting = usePluginRoute<{ message: string }>({
    plugin: STARTUP_READ_PLUGIN,
    path: STARTUP_READ_ROUTE,
  });
  return <p>{greeting.data?.message ?? ""}</p>;
}

registerComponents({ [STARTUP_READ_PAGE_COMPONENT]: StartupReadPage });
