/**
 * Reading and writing one plugin's settings over REST.
 *
 * The read NEVER returns a secret's value. A browser has no use for the
 * plaintext of a credential, and anything the page receives can be read by
 * anything else running on it — so the projection says only whether a secret
 * has been set, which is what an operator needs in order to decide whether to
 * replace it.
 *
 * @module dispatcher/handlers/plugin-settings-dispatcher
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { respondAction, respondData } from "../../api/response-shapes";
import type { NextlyServiceConfig } from "../../di/register";
import {
  PluginSettingsService,
  pluginSettingsSecrets,
} from "../../domains/plugins/settings-service";
import { createPluginSettingsStore } from "../../domains/plugins/settings-store";
import { NextlyError } from "../../errors/nextly-error";
import { env } from "../../lib/env";
import type { ServiceContainer } from "../../services";
import { readAuthenticatedUser } from "../helpers/authenticated-user";
import { requireParam } from "../helpers/validation";
import type { Params } from "../types";

/** Build the service for the named plugin, or refuse if it stores no settings. */
function serviceFor(
  container: ServiceContainer,
  config: NextlyServiceConfig | undefined,
  pluginName: string
): PluginSettingsService {
  const plugin = config?.plugins?.find(p => p.name === pluginName);
  const schema = plugin?.contributes?.settings;
  if (!plugin || !schema) {
    // The same answer for "no such plugin" and "that plugin stores nothing":
    // both mean there is no settings resource at this address.
    throw NextlyError.notFound({
      logContext: { entity: "plugin-settings", plugin: pluginName },
    });
  }

  const adapter = (
    container as unknown as {
      adapter: {
        getDrizzle: () => unknown;
        dialect: SupportedDialect;
      };
    }
  ).adapter;

  return new PluginSettingsService({
    owner: plugin.name,
    schema,
    secretPaths: plugin.capabilities?.secrets ?? [],
    store: createPluginSettingsStore(adapter.getDrizzle(), adapter.dialect),
    secrets: () => pluginSettingsSecrets(env),
  });
}

export async function dispatchPluginSettings(
  container: ServiceContainer,
  config: NextlyServiceConfig | undefined,
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const pluginName = requireParam(params, "plugin", "Plugin name");
  const service = serviceFor(container, config, pluginName);

  if (method === "getPluginSettings") {
    return respondData({ settings: await service.getRedacted() });
  }

  if (method === "updatePluginSettings") {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "body",
            code: "INVALID",
            message: "Settings must be an object.",
          },
        ],
      });
    }
    // A secret arrives here only as a WRITE. The read never handed one out, so
    // a client echoing back what it was given sends `{ set: true }`, which the
    // schema refuses rather than storing over the real value.
    // The CALLER, read the way every other dispatched write reads it. This
    // took `params.userId`, which names the TARGET of a user route and is
    // never populated here — so `updated_by` was null on every settings
    // update, losing the actor the column was added to keep.
    await service.set(body as Record<string, unknown>, {
      actorUserId: readAuthenticatedUser(params)?.id,
    });
    return respondAction("Settings updated.");
  }

  throw NextlyError.notFound({
    logContext: { entity: "plugin-settings", method },
  });
}
