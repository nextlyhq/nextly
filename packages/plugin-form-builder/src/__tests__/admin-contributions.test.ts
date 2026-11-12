import { describe, expect, it } from "vitest";

import { select, text } from "nextly";

import {
  submissionExtensionFields,
  submissionsCollection,
} from "../collections/submissions";
import { formBuilder } from "../plugin";

/**
 * The editor as the admin registers it, spelled out rather than imported, so
 * a declaration naming any other component fails here.
 */
const FORM_EDITOR_VIEW = "@nextlyhq/plugin-form-builder/admin#FormBuilderView";

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
    // the filter-widget-as-page, and the beforeList injection stay gone. The
    // forms collection's only view entry gives the editor's own pages their
    // addresses, each drawing that same editor.
    const admin = formBuilder().plugin.contributes?.admin;
    expect(admin?.settings).toBeUndefined();
    expect(admin?.pages ?? []).toHaveLength(0);
    expect(admin?.views ?? {}).toEqual({
      forms: {
        documentViews: [
          { path: "preview", label: "Preview", component: FORM_EDITOR_VIEW },
          { path: "settings", label: "Settings", component: FORM_EDITOR_VIEW },
          {
            path: "notifications",
            label: "Notifications",
            component: FORM_EDITOR_VIEW,
          },
          {
            path: "submissions",
            label: "Submissions",
            component: FORM_EDITOR_VIEW,
          },
        ],
      },
    });
  });

  it("overrides the submissions List view and disables admin creation", () => {
    const collection = submissionsCollection(formBuilder().config);
    expect(collection.admin?.components?.views?.List?.Component).toContain(
      "#SubmissionsView"
    );
    expect(collection.admin?.disableCreate).toBe(true);
  });

  it("emits a curated form.submission.created instead of the PII-bearing entry.* events", () => {
    // Submission records hold submitted answers plus visitor metadata
    // (ipAddress, userAgent). The default entry.* events stay suppressed
    // (record: false) so none of that reaches the outbox; a curated
    // form.submission.created carries only safe metadata (form, submittedAt,
    // status) so subscribers still learn a submission arrived.
    const collection = submissionsCollection(formBuilder().config);
    expect(collection.webhooks).toEqual({
      record: false,
      emit: {
        event: "form.submission.created",
        fields: ["form", "submittedAt", "status"],
      },
    });
  });
});

describe("the fields a host adds to submissions", () => {
  it("are the collection's fields that are not the plugin's own", () => {
    const { config } = formBuilder({
      formSubmissionOverrides: {
        fields: [
          select({
            name: "priority",
            label: "Priority",
            options: [
              { label: "Low", value: "low" },
              { label: "High", value: "high" },
            ],
          }),
          text({ name: "source" }),
        ],
      },
    });
    expect(submissionExtensionFields(config)).toEqual([
      { name: "priority", label: "Priority", type: "select" },
      { name: "source", label: "source", type: "text" },
    ]);
  });

  it("are none on a plain install", () => {
    expect(submissionExtensionFields(formBuilder().config)).toEqual([]);
  });
});
