/**
 * What owners declare about their templates beside the text: when each is
 * sent, and whether it carries a secret.
 *
 * Every template core registers says when it is sent, and core marks its
 * password reset, email verification and welcome as carrying a secret, so no
 * copy can ever be added to them. A plugin marks its own; only an explicit
 * mark counts, and a mark stored from an owner that is no longer running
 * still counts.
 */
import { describe, expect, it } from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import {
  buildTemplateOwnerRegistry,
  carriesSecret,
  type TemplateOwnerRegistry,
} from "../template-ownership";

const plugin = (
  slug: string,
  extra: Partial<PluginEmailTemplate> = {}
): PluginEmailTemplate => ({
  slug,
  name: slug,
  subject: "Hi",
  htmlContent: "<p>Hi</p>",
  ...extra,
});

function registryWith(
  templates: PluginEmailTemplate[] = []
): TemplateOwnerRegistry {
  return buildTemplateOwnerRegistry({
    builtIns: BUILT_IN_TEMPLATES,
    plugins: [{ name: "@acme/plugin-shop", templates }],
    complete: true,
  }).registry;
}

describe("core's templates", () => {
  it("each say when they are sent", () => {
    const registry = registryWith();
    const core = [...registry.owned.values()].filter(
      entry => entry.owner.kind === "core"
    );
    // The positive control: the registry is not empty, so the check below
    // reads every one of core's templates rather than none.
    expect(core.map(entry => entry.slug).sort()).toEqual(
      BUILT_IN_TEMPLATES.map(template => template.slug).sort()
    );
    for (const entry of core) {
      expect(
        entry.defaults.description?.trim(),
        `${entry.slug} has no description`
      ).toBeTruthy();
    }
  });

  it("mark the password reset, email verification and welcome as carrying a secret, and nothing else", () => {
    const registry = registryWith();
    const marked = [...registry.owned.values()]
      .filter(entry => entry.carriesSecret)
      .map(entry => entry.slug)
      .sort();
    expect(marked).toEqual(["email-verification", "password-reset", "welcome"]);
  });

  it("keep the mark out of the row they insert", () => {
    // The mark is the owner's declaration, written to its own column; it is
    // never part of what an override copies or a create accepts.
    const entry = registryWith().owned.get("password-reset");
    expect(entry?.defaults).not.toHaveProperty("carriesSecret");
  });
});

describe("a plugin's mark", () => {
  it("counts only when the plugin says true", () => {
    const registry = registryWith([
      plugin("shop-sign-in", { carriesSecret: true }),
      plugin("shop-receipt"),
      // A plugin is plain JavaScript at runtime.
      plugin("shop-odd", { carriesSecret: "yes" as unknown as boolean }),
    ]);
    expect(registry.owned.get("shop-sign-in")?.carriesSecret).toBe(true);
    expect(registry.owned.get("shop-receipt")?.carriesSecret).toBe(false);
    expect(registry.owned.get("shop-odd")?.carriesSecret).toBe(false);
  });

  it("is read from the running owner, or from what was stored when the owner is gone", () => {
    const running = registryWith([
      plugin("shop-sign-in", { carriesSecret: true }),
    ]);
    const gone = registryWith([]);
    expect(carriesSecret("shop-sign-in", null, running)).toBe(true);
    expect(carriesSecret("shop-sign-in", true, gone)).toBe(true);
    expect(carriesSecret("shop-sign-in", null, gone)).toBe(false);
    // A site's own template carries no mark.
    expect(carriesSecret("newsletter", null, running)).toBe(false);
  });
});

describe("a plugin's Reply-To", () => {
  it("is what its template starts with", () => {
    const registry = registryWith([
      plugin("shop-order", { replyTo: "{{ shopContact }}" }),
    ]);
    expect(registry.owned.get("shop-order")?.defaults.replyTo).toBe(
      "{{ shopContact }}"
    );
  });
});
