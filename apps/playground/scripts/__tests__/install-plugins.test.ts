/**
 * Installing the playground's plugins, one install at a time.
 *
 * What these pin is the order and the stop: a dependent plugin's install reads
 * its dependency as installed, so installs run in the order given and the first
 * failure ends the run with that install's status, rather than carrying on and
 * reporting success over a plugin that never installed.
 */
import { describe, expect, it } from "vitest";

import { installPlugins } from "../install-plugins";

describe("installPlugins", () => {
  it("installs every plugin, in the order given", () => {
    const ran: string[] = [];
    const result = installPlugins(["@a/one", "@a/two", "@a/three"], name => {
      ran.push(name);
      return 0;
    });

    expect(ran).toEqual(["@a/one", "@a/two", "@a/three"]);
    expect(result).toEqual({
      ok: true,
      installed: ["@a/one", "@a/two", "@a/three"],
    });
  });

  it("stops at the first failure and answers with its status", () => {
    const ran: string[] = [];
    const result = installPlugins(["@a/one", "@a/two", "@a/three"], name => {
      ran.push(name);
      return name === "@a/two" ? 3 : 0;
    });

    // Nothing after the failure ran: a later plugin may depend on it.
    expect(ran).toEqual(["@a/one", "@a/two"]);
    expect(result).toEqual({
      ok: false,
      installed: ["@a/one"],
      failed: "@a/two",
      status: 3,
    });
  });

  it("installs nothing, successfully, when no plugin is configured", () => {
    expect(installPlugins([], () => 1)).toEqual({ ok: true, installed: [] });
  });
});
