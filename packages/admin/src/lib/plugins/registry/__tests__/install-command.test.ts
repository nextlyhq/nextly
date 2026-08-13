/**
 * The three lines a reader copies to add a plugin.
 *
 * Two properties matter and they are separate: the lines must be derived from
 * the entry rather than stored beside it, and the install must name a version.
 * An unpinned install is the failure with teeth — every first-party plugin
 * declares an exact `nextly` peer for its own release, so resolving `latest`
 * on a project that is not on the newest one is a peer conflict on npm and a
 * startup compatibility failure elsewhere.
 */
import { describe, expect, it } from "vitest";

import { adminVersion } from "@admin/lib/admin-version";

import pkg from "../../../../../package.json";
import {
  importStatement,
  installCommand,
  pluginsArrayEntry,
} from "../install-command";
import type { RegistryPlugin } from "../types";

function entry(config: RegistryPlugin["config"]): RegistryPlugin {
  return {
    id: "@acme/thing",
    name: "Thing",
    description: "d",
    author: "Acme",
    category: "content",
    icon: { lucide: "Archive" },
    config,
  };
}

describe("installCommand", () => {
  it("pins to the given release", () => {
    expect(installCommand("@acme/p", "pnpm", "1.2.3")).toBe(
      "pnpm add @acme/p@1.2.3"
    );
  });

  /**
   * The separating case for the pin. Asserting only that a version appears
   * would pass on a build that injected a sentinel, and a command naming a
   * version that was never published is worse than one naming none.
   */
  it("omits the version rather than inventing one when it is unknown", () => {
    expect(installCommand("@acme/p", "pnpm", undefined)).toBe(
      "pnpm add @acme/p"
    );
  });

  /**
   * What the call site actually passes. `adminVersion()` reads a constant the
   * build injects from this package.json, so comparing the two confirms the
   * injection is wired rather than merely that some string came back — a
   * missing `define` would have it return undefined and the command would
   * silently go back to resolving `latest`.
   */
  it("names this package's own release when given the injected version", () => {
    expect(installCommand("@acme/p", "pnpm", adminVersion())).toBe(
      `pnpm add @acme/p@${pkg.version}`
    );
  });

  it("uses each manager's own add subcommand", () => {
    expect(installCommand("@acme/p", "npm", "1.0.0")).toBe(
      "npm install @acme/p@1.0.0"
    );
    expect(installCommand("@acme/p", "yarn", "1.0.0")).toBe(
      "yarn add @acme/p@1.0.0"
    );
    expect(installCommand("@acme/p", "bun", "1.0.0")).toBe(
      "bun add @acme/p@1.0.0"
    );
  });
});

describe("config lines", () => {
  it("imports the binding the array entry references", () => {
    const plugin = entry({ exportName: "thing", callArgs: "" });

    // Asserted together, because the defect they guard is disagreement: an
    // entry naming a symbol the import does not bring in compiles nowhere.
    expect(importStatement(plugin)).toBe(
      'import { thing } from "@acme/thing";'
    );
    expect(pluginsArrayEntry(plugin)).toBe("plugins: [thing()]");
  });

  it("leaves an uncalled export uncalled", () => {
    expect(
      pluginsArrayEntry(entry({ exportName: "thing", callArgs: null }))
    ).toBe("plugins: [thing]");
  });

  it("places required arguments inside the call", () => {
    expect(
      pluginsArrayEntry(
        entry({ exportName: "thing", callArgs: '{ collections: ["posts"] }' })
      )
    ).toBe('plugins: [thing({ collections: ["posts"] })]');
  });
});
