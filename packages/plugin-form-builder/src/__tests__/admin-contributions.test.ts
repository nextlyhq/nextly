import { describe, expect, it } from "vitest";

import { submissionsCollection } from "../collections/submissions";
import { formBuilder } from "../plugin";

describe("form-builder contributes.admin (P5 dogfood)", () => {
  it("declares a sidebar menu item linking to the forms collection", () => {
    const admin = formBuilder().plugin.contributes?.admin;
    expect(admin?.menu?.[0]).toMatchObject({
      label: "Forms",
      icon: "file-text",
    });
    expect(admin?.menu?.[0]?.to).toContain("/admin/collections/");
    expect(admin?.menu?.[0]?.requiredPermission).toMatch(/^read-/);
  });

  it("declares a settings component", () => {
    const admin = formBuilder().plugin.contributes?.admin;
    expect(admin?.settings?.component).toContain("#FormBuilderView");
  });

  it("registers no custom pages or beforeList injections", () => {
    // The submissions experience lives in the List-view override; the old
    // filter-widget-as-page and beforeList registrations must stay gone.
    const admin = formBuilder().plugin.contributes?.admin;
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
