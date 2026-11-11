"use client";

/**
 * The first section of a form's Settings: its name, its ID (the slug the Form
 * block and the API read it by) and, once the form is closed, what it tells a
 * visitor. They sat in a box above the tabs; the name now heads the page and
 * the status sits in the bar, so what is left to type lives here.
 *
 * @module admin/components/builder/FormIdentitySection
 */
import { FieldShell, FormSection, Input, Textarea } from "@nextlyhq/ui";
import type { JSX } from "react";

import { useFormBuilder } from "../../context/FormBuilderContext";

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

export function FormIdentitySection(): JSX.Element {
  const { formData, updateFormData } = useFormBuilder();
  return (
    <FormSection label="Form">
      <div className="flex flex-col gap-5">
        <FieldShell
          label="Name"
          htmlFor="form-name"
          description="Shown in the admin, and as the heading if your site shows one."
        >
          <Input
            type="text"
            value={formData.name}
            onChange={event =>
              updateFormData({
                name: event.target.value,
                slug: followingSlug(
                  formData.slug,
                  formData.name,
                  event.target.value
                ),
              })
            }
            placeholder="e.g., Contact form"
          />
        </FieldShell>
        <FieldShell
          label="Form ID"
          htmlFor="form-slug"
          description="Used by the Form block and the API."
        >
          <Input
            type="text"
            className="font-mono"
            value={formData.slug}
            onChange={event => updateFormData({ slug: event.target.value })}
            placeholder="e.g., contact-form"
          />
        </FieldShell>
        {/* Only once the form is closed: a box that is always there would
            sit empty on the many forms that never close. */}
        {formData.status === "closed" ? (
          <FieldShell
            label="Message when closed"
            htmlFor="form-closed-message"
            width="full"
            description="Shown to anyone who reaches this form now that it is closed. Left empty, they are told only that it is not accepting submissions."
          >
            <Textarea
              value={formData.closedMessage ?? ""}
              onChange={event =>
                updateFormData({ closedMessage: event.target.value })
              }
              placeholder="e.g., Applications closed on 31 March. Thank you to everyone who applied."
              rows={3}
            />
          </FieldShell>
        ) : null}
      </div>
    </FormSection>
  );
}
