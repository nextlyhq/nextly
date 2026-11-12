/**
 * The site's own permissions are stored under the owner key `app`, and a
 * plugin's under the plugin's name. A plugin named `app` would share that key,
 * so uninstalling it, the orphan pass of `nextly migrate` or a rollback could
 * take the site's permissions for the plugin's, or the plugin's for the site's.
 * The name is refused where the plugin list is resolved.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import { validatePluginNames } from "./validate-names";

function plugin(name: string, enabled?: boolean): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: "*",
    ...(enabled === undefined ? {} : { enabled }),
  };
}

/** The refusal's code and reason, or undefined when the list is accepted. */
function refusal(
  plugins: PluginDefinition[]
): { code: string; reason: unknown; plugin: unknown } | undefined {
  try {
    validatePluginNames(plugins);
  } catch (error) {
    const { code, logContext } = error as {
      code: string;
      logContext?: Record<string, unknown>;
    };
    return { code, reason: logContext?.reason, plugin: logContext?.plugin };
  }
  return undefined;
}

describe("validatePluginNames", () => {
  // Owner keys are compared by the database, and MySQL compares them without
  // regard to case, so `App` reaches the same rows as `app`.
  it.each(["app", "App", "APP"])("refuses a plugin named %s", name => {
    expect(refusal([plugin("@acme/seo"), plugin(name)])).toEqual({
      code: "PLUGIN_RESOLUTION_ERROR",
      reason: "plugin-name-reserved",
      plugin: name,
    });
  });

  it("names the plugin and says the name is reserved for the site's own permissions", () => {
    let logMessage: string | undefined;
    try {
      validatePluginNames([plugin("app")]);
    } catch (error) {
      logMessage = (error as { logMessage?: string }).logMessage;
    }
    expect(logMessage).toBe(
      'Plugin "app" uses the name "app", which is reserved for the site\'s own permissions. Choose another name for the plugin.'
    );
  });

  // A disabled plugin keeps its schema and its stored permissions, so its name
  // is still an owner key.
  it("refuses a disabled plugin named app too", () => {
    expect(refusal([plugin("app", false)])?.reason).toBe(
      "plugin-name-reserved"
    );
  });

  // The controls: only the exact name is reserved, not every name holding it.
  it.each(["apps", "my-app", "@acme/app", "app-store", "application"])(
    "accepts a plugin named %s",
    name => {
      expect(refusal([plugin(name)])).toBeUndefined();
    }
  );

  it("accepts an empty plugin list", () => {
    expect(refusal([])).toBeUndefined();
  });
});
