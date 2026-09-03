/**
 * The boot refusal for a menu item naming a collection its plugin does not own.
 *
 * Asserted here rather than only through the serializer, because WHERE it
 * throws is the property under test. Running only while `/api/admin-meta` is
 * built means the app boots, and then every branding and workspace request
 * throws — which can take the sign-in screen with it, so the operator meets a
 * configuration mistake as an outage rather than as a failed start.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import { definePlugin } from "./plugin-context";

import { validatePluginMenus } from "./validate-menus";

const base = { name: "@acme/p", version: "1.0.0", nextly: "*" } as const;

/** A plugin owning `patterns`, with one menu item naming `collection`. */
function withMenu(collection: string | undefined, nested = false) {
  const item = {
    label: "Patterns",
    to: "/admin/collections/patterns",
    collection,
  };
  return definePlugin({
    ...base,
    contributes: {
      collections: [{ slug: "patterns" } as never],
      admin: {
        menu: nested
          ? [{ label: "Design", to: "/admin/design", children: [item] }]
          : [item],
      },
    },
  } as unknown as PluginDefinition);
}

const reasonOf = (error: unknown) =>
  (error as { logContext?: { reason?: string } })?.logContext?.reason;

describe("validatePluginMenus", () => {
  it("accepts an item naming a collection the plugin contributes", () => {
    // The positive control. Every refusal below is also satisfied by a
    // validator that refuses everything, which would stop every boot.
    expect(() => validatePluginMenus([withMenu("patterns")])).not.toThrow();
  });

  it("accepts an item naming no collection at all", () => {
    expect(() => validatePluginMenus([withMenu(undefined)])).not.toThrow();
  });

  it("refuses a slug the plugin does not contribute", () => {
    let caught: unknown;
    try {
      validatePluginMenus([withMenu("pattrens")]);
    } catch (error) {
      caught = error;
    }

    // The reason, not `message`: every plugin resolution error answers
    // `message` with the same sentence, so matching on it would pass for a
    // duplicate admin slug just as readily.
    expect(reasonOf(caught)).toBe("menu-item-unowned-collection");

    // Names the typo AND what it could have been. Neither is recoverable from
    // the other, and a reader looking at their own typo is exactly the reader
    // who cannot see it.
    const logMessage = (caught as { logMessage?: string })?.logMessage ?? "";
    expect(logMessage).toContain("pattrens");
    expect(logMessage).toContain("patterns");
  });

  it("refuses a bad slug on a nested item too", () => {
    // A child is exactly as stranded as a parent, and is the one a walk over
    // the top level alone would let through.
    let caught: unknown;
    try {
      validatePluginMenus([withMenu("pattrens", true)]);
    } catch (error) {
      caught = error;
    }
    expect(reasonOf(caught)).toBe("menu-item-unowned-collection");
  });
});
