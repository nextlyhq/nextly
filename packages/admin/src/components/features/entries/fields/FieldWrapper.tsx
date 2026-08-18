"use client";

/**
 * Field Wrapper Component
 *
 * Common wrapper for all data field inputs providing consistent
 * label, description, error display, and layout.
 *
 * @module components/entries/fields/FieldWrapper
 * @since 1.0.0
 */

import { Label } from "@nextlyhq/ui";
import { Globe } from "lucide-react";
import { isFieldLocalized, type FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { useId } from "react";

import { useLabelLandingCheck } from "@admin/lib/forms/label-landing";
import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";
import { UseSourceButton } from "../TranslationMode/UseSourceButton";

import { useFieldElementId } from "./field-id-scope";

// ============================================================
// Types
// ============================================================

export interface FieldWrapperProps {
  /**
   * Field configuration from collection schema.
   * Used to extract label, required status, description, and width.
   */
  field: FieldConfig;

  /**
   * Validation error message to display.
   * When present, the field is styled as invalid.
   */
  error?: string;

  /**
   * The input component to wrap.
   */
  children: ReactNode;

  /**
   * Additional CSS classes for the wrapper.
   */
  className?: string;

  /**
   * Override the field name for htmlFor/id association.
   * Useful for nested fields with path prefixes.
   */
  fieldPath?: string;

  /**
   * Whether the field is in a horizontal layout (e.g., checkbox).
   * When true, label and input are side-by-side.
   * @default false
   */
  horizontal?: boolean;

  /**
   * Whether the editor rendering this field comes from a plugin rather than
   * from the built-in type dispatch.
   *
   * Such a field is exposed as a GROUP, because nothing here can know whether
   * plugin-supplied markup contains a single labelable control — and a
   * `<label for>` aimed at an id no element carries names nothing at all.
   *
   * Classifying by the field's TYPE cannot answer this, which is why it is a
   * prop rather than another entry in {@link GROUP_FIELD_TYPES}: an override
   * replaces the component while leaving the type untouched. Measured — the
   * page builder renders over a `json` field and its label pointed at nothing,
   * while an ordinary `json` field on another collection was labelled
   * correctly.
   *
   * @default false
   */
  editorIsOpaque?: boolean;
}

// ============================================================
// Width Mapping
// ============================================================

/**
 * Maps admin width percentages to Tailwind classes.
 * Uses CSS width for precise percentage control.
 */
const WIDTH_STYLES: Record<string, string> = {
  "25%": "w-1/4",
  "33%": "w-1/3",
  "50%": "w-1/2",
  "66%": "w-2/3",
  "75%": "w-3/4",
  "100%": "w-full",
};

/**
 * Field types whose input renders a GROUP of controls rather than one element an
 * id can attach to.
 *
 * This wrapper renders `{children}` as-is — it never clones — so a `<label for>`
 * only resolves when the input component independently sets a matching `id`.
 * `TextInput` and friends do (`id={name}`); these do not, because there is no
 * single control to put it on: rich text is a contenteditable surface plus a
 * toolbar, relationship is a search box plus a result list plus remove buttons,
 * and upload is a drop zone plus a preview plus actions. Pointing a label at
 * the wrapping `<div>` would resolve the reference while naming something that
 * cannot be focused, which is worse than leaving it dangling.
 *
 * Measured dangling on `/admin/collections/posts/create` in both themes before
 * this list existed: `richText:content`, `relationship:categories`,
 * `relationship:tags`, `upload:featuredImage`.
 *
 * The list covers the types this codebase has evidence for. It is deliberately
 * NOT a guess at the rest: `useFieldLabelLandingCheck` below fires in
 * development for any other type whose label finds no usable target, so a
 * missing entry announces itself the first time the field is opened instead of
 * failing silently.
 */
const GROUP_FIELD_TYPES: ReadonlySet<string> = new Set([
  "richText",
  "relationship",
  "upload",
]);

/**
 * Development-time check that this field's `<label for>` actually found a
 * control that can carry a name.
 *
 * The mechanism lives in `@admin/lib/forms/label-landing` and is shared with
 * the settings rows, which emit their own `<label for>` and can fail in exactly
 * these two ways. This wrapper supplies only the remedies, since what to do
 * about a dangling label differs by where the label came from.
 */
function useFieldLabelLandingCheck(
  enabled: boolean,
  targetId: string,
  label: string,
  fieldType: string
): void {
  useLabelLandingCheck({
    enabled,
    targetId,
    label,
    remedies: {
      absent:
        `Field type "${fieldType}" renders no single control the id can attach to. ` +
        `Add "${fieldType}" to GROUP_FIELD_TYPES in FieldWrapper.tsx so the field is ` +
        `exposed as a group instead.`,
      notLabelable:
        `Field type "${fieldType}" put the id on an element a label cannot name — a ` +
        `wrapper or an editing surface rather than a control. Either move the id onto ` +
        `the field's focusable control, or add "${fieldType}" to GROUP_FIELD_TYPES in ` +
        `FieldWrapper.tsx so the field is exposed as a group.`,
    },
  });
}

// ============================================================
// Component
// ============================================================

/**
 * FieldWrapper provides consistent presentation for all data field inputs.
 *
 * Features:
 * - Label with required indicator
 * - Description/help text
 * - Validation error display
 * - Configurable width from field.admin.width
 * - Horizontal layout option for checkboxes
 * - Accessibility: proper label association, aria attributes
 *
 * @example
 * ```tsx
 * <FieldWrapper field={textField} error={errors.title?.message}>
 *   <Input {...register("title")} />
 * </FieldWrapper>
 * ```
 *
 * @example Horizontal layout for checkbox
 * ```tsx
 * <FieldWrapper field={checkboxField} horizontal>
 *   <Checkbox {...register("isActive")} />
 * </FieldWrapper>
 * ```
 */
export function FieldWrapper({
  field,
  error,
  children,
  className,
  fieldPath,
  horizontal = false,
  editorIsOpaque = false,
}: FieldWrapperProps) {
  // i18n M7: active content-language direction (RTL for Arabic/Hebrew/…).
  const entryLocale = useEntryLocale();
  // Generate unique IDs for accessibility
  const generatedId = useId();
  // Use type guard to safely access name property (not all fields have it, e.g., TabsFieldConfig)
  const fieldName = "name" in field ? (field.name as string) : undefined;
  // Scoped for the same reason the controls are: two renderings of one
  // document on a page would otherwise aim both labels at the first one.
  const fieldId = useFieldElementId(fieldPath || fieldName || generatedId);
  const errorId = `${fieldId}-error`;
  const descriptionId = `${fieldId}-description`;
  // Names the group when the field has no single control to point a label at.
  const groupLabelId = `${fieldId}-group-label`;

  // Extract field properties - cast to common optional properties
  const fieldWithCommonProps = field as {
    label?: string;
    required?: boolean;
    localized?: boolean;
    admin?: {
      description?: string;
      width?: string;
      hidden?: boolean;
      className?: string;
      style?: React.CSSProperties;
    };
  };
  const label =
    fieldWithCommonProps.label || (fieldName ? formatFieldName(fieldName) : "");
  const isRequired = fieldWithCommonProps.required ?? false;
  const description = fieldWithCommonProps.admin?.description;
  const width = fieldWithCommonProps.admin?.width || "100%";
  const isHidden = fieldWithCommonProps.admin?.hidden;
  const _fieldType = field.type as string;

  // A group is named by `aria-labelledby` on a `role="group"` container rather
  // than by a `<label for>`, because there is no single control to point at.
  const isGroup = GROUP_FIELD_TYPES.has(_fieldType) || editorIsOpaque;
  // Only the non-group path claims a control carries the id, so only it is
  // checked. A group makes no such claim and cannot fail this way.
  useFieldLabelLandingCheck(!isGroup && !isHidden, fieldId, label, _fieldType);
  // Announced with the group. The single-control path cannot do this from here:
  // the id lives on an element this component never touches.
  const groupDescribedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // i18n M7: is this field translatable (a per-language value) or shared across all languages?
  // Uses the same classifier as storage generation (nextly/config) so the editor and the DB
  // agree. For non-localized collections this is always false and everything below is inert.
  const isLocalizedField = isFieldLocalized(
    {
      type: _fieldType,
      name: fieldName ?? "",
      localized: fieldWithCommonProps.localized,
    },
    entryLocale.collectionLocalized
  );
  // Flip inputs right-to-left only for translatable fields in an RTL language — a shared field's
  // value is language-neutral and stays LTR.
  const rtlField = entryLocale.rtl && isLocalizedField;
  // Subtle marker on shared fields in a multilingual collection: their value applies to every
  // language and has no per-language draft state (spec §7), so editing one changes all — surface
  // it so editors aren't surprised. Only meaningful for real (named) data fields.
  //
  // Only while editing a NON-default language: on the default language every
  // field behaves normally and the distinction has no consequence yet, so the
  // badge on every shared field was noise on the ordinary editing path. The
  // surprise it guards against — "editing this changes other languages too" —
  // only exists once another language is the one being edited.
  const sharedHint =
    entryLocale.collectionLocalized &&
    entryLocale.isNonDefaultLocale &&
    !isLocalizedField &&
    fieldName != null ? (
      // The whole fact is written out rather than abbreviated to "Shared"
      // behind a `title` tooltip. A tooltip is unreachable by touch and
      // awkward by keyboard — the same objection this file already records
      // against putting description text behind a hover target.
      <span className="inline-flex w-fit items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-muted-foreground">
        <Globe className="size-3" aria-hidden="true" />
        Shared across languages
      </span>
    ) : null;

  // i18n M7: while translating a non-default language, show the default-language value inline on
  // a translatable field so the translator always has the source text (spec §10 — the validated,
  // cheap alternative to a full side-by-side editor). Only primitive (text/number) sources render;
  // structural values (relationships, richText objects) are skipped.
  const rawSource =
    isLocalizedField && entryLocale.isNonDefaultLocale && fieldName != null
      ? entryLocale.sourceValues?.[fieldName]
      : undefined;
  const sourceText =
    typeof rawSource === "string" && rawSource.trim() !== ""
      ? rawSource
      : typeof rawSource === "number"
        ? String(rawSource)
        : null;
  const sourceHint = sourceText ? (
    <p
      dir="auto"
      className="text-xs leading-relaxed text-muted-foreground border-l-2 border-muted pl-2"
    >
      <span className="font-medium">Default:</span> {sourceText}
    </p>
  ) : null;

  // In translation mode the source is already on screen in its own pane, so the
  // field offers the ACTION rather than repeating the text: fill this one field
  // from the source. Renders nothing outside the mode, and nothing on the source
  // pane's own fields — that pane sits outside the context this reads.
  const useSourceAction =
    isLocalizedField && fieldName != null ? (
      <UseSourceButton fieldName={fieldName} fieldLabel={label} />
    ) : null;

  // Don't render if hidden
  if (isHidden) {
    return null;
  }

  // Get width class
  const widthClass = WIDTH_STYLES[width] || "w-full";

  // Horizontal layout (for checkboxes)
  if (horizontal) {
    return (
      <div
        className={cn(
          "flex items-start gap-3",
          widthClass,
          fieldWithCommonProps.admin?.className,
          className
        )}
        style={fieldWithCommonProps.admin?.style}
        data-field={fieldName}
        data-field-type={field.type}
        // i18n M7: render the field right-to-left when a translatable field is edited in an RTL language.
        {...(rtlField ? { dir: "rtl" as const } : {})}
      >
        <div className="pt-0.5">{children}</div>
        <div className="grid gap-1.5 leading-none">
          {/* Outside the label, for the reason given in the vertical layout. */}
          {sharedHint}
          <Label
            htmlFor={fieldId}
            className={cn(
              "flex items-center gap-2 text-sm font-medium text-foreground",
              error && "text-destructive"
            )}
          >
            {label}
            {isRequired && (
              <span className="text-destructive-500 ml-1" aria-hidden="true">
                *
              </span>
            )}
          </Label>
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              className="text-sm text-destructive-500! font-medium"
              role="alert"
            >
              {error}
            </p>
          )}
          {/* show the default-language source hint in the horizontal
              (checkbox) layout too — it was only rendered in the vertical layout. */}
          {sourceHint}

          {/* And the source-fill action beside it, for the same reason. A
              checkbox is not localized by default, but only `password` can
              NEVER be — so a schema author who declares `localized: true` on one
              gets a field that showed its source and offered no way to take it,
              which is the layout branch disagreeing with itself rather than a
              decision about checkboxes. */}
          {useSourceAction && (
            <div className="flex justify-end">{useSourceAction}</div>
          )}
        </div>
      </div>
    );
  }

  // Default vertical layout
  return (
    <div
      className={cn(
        "grid gap-2",
        widthClass,
        fieldWithCommonProps.admin?.className,
        className
      )}
      style={fieldWithCommonProps.admin?.style}
      data-field={fieldName}
      data-field-type={field.type}
      // i18n M7: render the field right-to-left when a translatable field is edited in an RTL
      // language (Arabic, Hebrew, …). Shared / non-localized editors are unaffected.
      {...(rtlField ? { dir: "rtl" as const } : {})}
      // A field with no single focusable control is exposed as a named group.
      {...(isGroup
        ? {
            role: "group" as const,
            "aria-labelledby": groupLabelId,
            ...(groupDescribedBy
              ? { "aria-describedby": groupDescribedBy }
              : {}),
          }
        : {})}
    >
      {/* Language status sits ABOVE the label, not inside it. Anything inside a
          <label> joins the field's accessible name, so rendering the badge there
          made a screen reader announce the field as "Title Shared" — describing
          the field with a word that is not part of what it is called. */}
      {sharedHint}

      {isGroup ? (
        <span
          id={groupLabelId}
          className={cn(
            "flex items-center gap-2 text-sm font-medium text-foreground",
            error && "text-destructive"
          )}
        >
          {label}
          {isRequired && (
            <span className="text-destructive-500 ml-1" aria-hidden="true">
              *
            </span>
          )}
        </span>
      ) : (
        <Label
          htmlFor={fieldId}
          className={cn(
            "flex items-center gap-2 text-sm font-medium text-foreground",
            error && "text-destructive"
          )}
        >
          {label}
          {isRequired && (
            <span className="text-destructive-500 ml-1" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}

      {/* i18n M7: the default language's value, shown while translating another
          language. It sits ABOVE the input because it is what the translator
          reads FROM: source first, then the box they type the translation into.
          Below the input it read as a footnote about the field rather than as
          the text being translated. */}
      {sourceHint}

      {useSourceAction && (
        <div className="flex justify-end">{useSourceAction}</div>
      )}

      {/* Input (children) */}
      {children}

      {/* Description / helper text — always visible below the input, rather
          than behind a tooltip on an info icon. Help that only appears on
          hover is unreachable by touch and easy to miss by keyboard, and it
          arrives after the user has already decided what to type. */}
      {description && (
        <p
          id={descriptionId}
          className="text-xs text-muted-foreground leading-relaxed"
        >
          {description}
        </p>
      )}

      {/* Error message */}
      {error && (
        <p
          id={errorId}
          className="text-sm text-destructive-500! font-medium"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

/**
 * Formats a field name into a human-readable label.
 * Converts camelCase and snake_case to Title Case.
 *
 * @example
 * formatFieldName('firstName') // 'First Name'
 * formatFieldName('user_email') // 'User Email'
 * formatFieldName('isActive') // 'Is Active'
 */
function formatFieldName(name: string): string {
  if (!name) return "";

  return (
    name
      // Insert space before capitals (camelCase)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Replace underscores and hyphens with spaces
      .replace(/[_-]/g, " ")
      // Capitalize first letter of each word
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim()
  );
}

// ============================================================
// Exports
// ============================================================
