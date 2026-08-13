/**
 * The catalogue and an installed plugin can each answer "what icon, what
 * description". These cover which answer wins, and what happens when only one
 * of them has anything to say.
 */
import { describe, expect, it } from "vitest";

import { resolveCataloguePresentation } from "../resolve-catalogue-presentation";
import type { RegistryPlugin } from "../types";

import type { PluginMetadata } from "@admin/types/branding";

const ENTRY: RegistryPlugin = {
  id: "@acme/thing",
  name: "Thing",
  description: "The catalogue's description",
  author: "Acme",
  category: "content",
  // A real barrel export, unlike `PluginGlyph` on the installed side below: a
  // catalogue entry's glyph is type-checked against the icon barrel, while a
  // plugin declares its own as a free string this admin cannot constrain.
  icon: { lucide: "Archive" },
  config: { exportName: "thing", callArgs: "" },
};

function installed(
  appearance: PluginMetadata["appearance"],
  description?: string
): Pick<PluginMetadata, "appearance" | "description"> {
  return { appearance, description };
}

describe("resolveCataloguePresentation", () => {
  it("uses the catalogue when the plugin is not installed", () => {
    const p = resolveCataloguePresentation(ENTRY, undefined);

    expect(p.icon).toEqual({ kind: "lucide", name: "Archive" });
    expect(p.description).toBe("The catalogue's description");
    expect(p.isInstalled).toBe(false);
  });

  it("prefers the installed plugin's own icon and description", () => {
    const p = resolveCataloguePresentation(
      ENTRY,
      installed({ icon: "PluginGlyph" }, "The plugin's own description")
    );

    expect(p.icon).toEqual({ kind: "lucide", name: "PluginGlyph" });
    expect(p.description).toBe("The plugin's own description");
    expect(p.isInstalled).toBe(true);
  });

  /**
   * Per field, not per record. An installed plugin that declares a description
   * and no icon must keep its description; a whole-record choice would discard
   * it because of an unrelated empty field.
   */
  it("falls back per field, so a partial declaration keeps what it did declare", () => {
    const p = resolveCataloguePresentation(
      ENTRY,
      installed(undefined, "The plugin's own description")
    );

    expect(p.description).toBe("The plugin's own description");
    expect(p.icon).toEqual({ kind: "lucide", name: "Archive" });
  });

  it("keeps the catalogue text when an installed plugin declares none", () => {
    const p = resolveCataloguePresentation(ENTRY, installed({ icon: "P" }));

    expect(p.description).toBe("The catalogue's description");
    // The plugin IS installed and IS the source of the icon, so the fallback
    // above is about the description being absent rather than about the join
    // having failed to find the plugin at all.
    expect(p.icon).toEqual({ kind: "lucide", name: "P" });
    expect(p.isInstalled).toBe(true);
  });

  it("treats a whitespace-only description as declaring none", () => {
    const p = resolveCataloguePresentation(ENTRY, installed(undefined, "   "));

    expect(p.description).toBe("The catalogue's description");
  });

  it("prefers an installed asset over the catalogue's glyph", () => {
    const p = resolveCataloguePresentation(
      ENTRY,
      installed({ iconAsset: "/logo.svg" })
    );

    expect(p.icon).toEqual({ kind: "asset", src: "/logo.svg" });
  });

  /**
   * Candidates are exhausted one at a time. A plugin that declares only a
   * glyph is stating which glyph represents it, so it outranks an image the
   * catalogue happens to carry for the same package.
   */
  it("lets an installed glyph outrank a catalogue asset", () => {
    const withAsset: RegistryPlugin = {
      ...ENTRY,
      icon: { lucide: "Archive", asset: "/catalogue.svg" },
    };

    // Positive control: with nothing installed the catalogue asset IS chosen,
    // so the glyph winning below is about precedence rather than about an
    // asset this resolver never returns.
    expect(resolveCataloguePresentation(withAsset, undefined).icon).toEqual({
      kind: "asset",
      src: "/catalogue.svg",
    });
    expect(
      resolveCataloguePresentation(
        withAsset,
        installed({ icon: "PluginGlyph" })
      ).icon
    ).toEqual({ kind: "lucide", name: "PluginGlyph" });
  });

  it("skips every asset for a surface that cannot render one", () => {
    const withAsset: RegistryPlugin = {
      ...ENTRY,
      icon: { lucide: "Archive", asset: "/catalogue.svg" },
    };

    const p = resolveCataloguePresentation(
      withAsset,
      installed({ iconAsset: "/logo.svg" }),
      { allowAsset: false }
    );

    expect(p.icon).toEqual({ kind: "lucide", name: "Archive" });
  });
});
