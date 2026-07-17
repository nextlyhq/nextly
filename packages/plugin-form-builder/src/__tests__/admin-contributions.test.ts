import { describe, expect, it } from "vitest";

import { submissionsCollection } from "../collections/submissions";
import { formBuilder } from "../plugin";

describe("form-builder contributes.admin (P5 dogfood)", () => {
  it("declares standalone main-rail placement with a single Forms identity", () => {
    const { plugin } = formBuilder();
    // Forms lives in the main rail: standalone placement + appearance, with
    // NO separate menu contribution — "Forms" must exist exactly once.
    expect(plugin.admin).toMatchObject({
      placement: "standalone",
      after: "media",
      appearance: { icon: "FileText", label: "Forms" },
    });
    expect(plugin.contributes?.admin?.menu ?? []).toHaveLength(0);
  });

  it("registers no settings component, custom pages, or beforeList injections", () => {
    // The collection Edit-view override is the single FormBuilderView mount;
    // the old settings-component (a second full builder at /admin/plugins/…),
    // the filter-widget-as-page, and the beforeList injection stay gone.
    const admin = formBuilder().plugin.contributes?.admin;
    expect(admin?.settings).toBeUndefined();
    expect(admin?.pages ?? []).toHaveLength(0);
    expect(admin?.views ?? {}).toEqual({});
  });

  it("overrides the submissions List view and disables admin creation", () => {
    const collection = submissionsCollection(formBuilder().config);
    expect(collection.admin?.components?.views?.List?.Component).toContain(
      "#SubmissionsView"
    );
    expect(collection.admin?.disableCreate).toBe(true);
  });
});
