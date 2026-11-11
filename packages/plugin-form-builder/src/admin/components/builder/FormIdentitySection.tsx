"use client";

/**
 * The first section of a form's Settings: its name, its ID (the slug the Form
 * block and the API read it by), and a note for people in the admin.
 *
 * @module admin/components/builder/FormIdentitySection
 */
import { FormSection, Input, Textarea } from "@nextlyhq/ui";
import type { JSX } from "react";

import {
  useFieldBookkeeping,
  useFormBuilder,
} from "../../context/FormBuilderContext";

import { descriptionIdOf, SettingRow } from "./settings-rows";

/** A name as an ID: lowercase words joined by dashes. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The ID a renamed form should take: one that still follows the name (empty,
 * or what the old name gave) follows the new one; one a person typed stays.
 */
function followingSlug(slug: string, oldName: string, newName: string): string {
  return slug === "" || slug === slugify(oldName) ? slugify(newName) : slug;
}

/**
 * Why a form's ID no longer changes once the form has been live: the site's
 * pages and any integration read the form by it.
 */
export const FIXED_FORM_ID_REASON =
  "Fixed once the form has been live: pages and integrations read the form by this ID.";

export function FormIdentitySection(): JSX.Element {
  const { formData, settings, updateFormData, updateSettings } =
    useFormBuilder();
  // Once live, the site may have read it by its ID, even if it has since
  // been closed or set back to draft.
  const { formIdFixed: idFixed } = useFieldBookkeeping();
  return (
    <FormSection label="Form">
      <SettingRow
        label="Name"
        htmlFor="form-name"
        description="Shown in the admin, and as the heading if your site shows one."
      >
        <Input
          id="form-name"
          type="text"
          className="w-full sm:w-72"
          aria-describedby={descriptionIdOf("form-name")}
          value={formData.name}
          onChange={event =>
            updateFormData({
              name: event.target.value,
              ...(idFixed
                ? {}
                : {
                    slug: followingSlug(
                      formData.slug,
                      formData.name,
                      event.target.value
                    ),
                  }),
            })
          }
          placeholder="e.g., Contact form"
        />
      </SettingRow>
      <SettingRow
        label="Form ID"
        htmlFor="form-slug"
        description={
          idFixed
            ? FIXED_FORM_ID_REASON
            : "Used by the Form block and the API. Fixed once the form is live."
        }
      >
        <Input
          id="form-slug"
          type="text"
          className="w-full font-mono sm:w-72"
          aria-describedby={descriptionIdOf("form-slug")}
          value={formData.slug}
          // Disabled as the field panel draws a fixed name, with the reason
          // it cannot change as its description.
          disabled={idFixed}
          onChange={event => updateFormData({ slug: event.target.value })}
          placeholder="e.g., contact-form"
        />
      </SettingRow>
      <SettingRow
        label="Internal note"
        htmlFor="form-internal-note"
        description="Only people in the admin see this."
        stack
      >
        <Textarea
          id="form-internal-note"
          aria-describedby={descriptionIdOf("form-internal-note")}
          value={settings.internalNote ?? ""}
          onChange={event =>
            updateSettings({ internalNote: event.target.value || undefined })
          }
          rows={3}
        />
      </SettingRow>
    </FormSection>
  );
}
