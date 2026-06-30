import { describe, expect, it } from "vitest";

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

  it("declares a custom page gated by export-submissions", () => {
    const admin = formBuilder().plugin.contributes?.admin;
    expect(admin?.pages?.[0]).toMatchObject({
      path: "submissions",
      requiredPermission: "export-submissions",
    });
  });

  it("declares a submissions beforeList view override", () => {
    const { plugin, config } = formBuilder();
    const slug = config.formSubmissionOverrides.slug;
    expect(plugin.contributes?.admin?.views?.[slug]?.beforeList).toContain(
      "#SubmissionsFilter"
    );
  });

  it("respects a renamed submissions slug for the view key", () => {
    const { plugin, config } = formBuilder({
      formSubmissionOverrides: { slug: "leads" },
    });
    expect(config.formSubmissionOverrides.slug).toBe("leads");
    expect(plugin.contributes?.admin?.views?.leads?.beforeList).toContain(
      "#SubmissionsFilter"
    );
  });
});
