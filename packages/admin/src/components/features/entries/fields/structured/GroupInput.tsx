/**
 * Group Input Component
 *
 * A field component for rendering nested field groups. Supports both named groups
 * (rendered as Card with header) and unnamed groups (inline rendering for visual grouping).
 *
 * Groups are used to organize related fields together in a form, providing visual
 * hierarchy and logical structure. They can be nested to create complex form layouts.
 *
 * @module components/entries/fields/structured/GroupInput
 * @since 1.0.0
 */

import type { GroupFieldConfig, FieldConfig } from "@revnixhq/nextly/config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
import { useState } from "react";

import { ChevronDown, ChevronRight } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { FieldRenderer } from "../FieldRenderer";

// ============================================================================
// Types
// ============================================================================

export interface GroupInputProps {
  /**
   * Field name for React Hook Form registration.
   * For nested groups, this is the full path (e.g., "metadata" or "settings.advanced").
   */
  name: string;

  /**
   * Group field configuration from collection schema.
   */
  field: GroupFieldConfig;

  /**
   * Base path for nested fields.
   * Used to construct full field paths for sub-fields.
   * @example "metadata" or "items.0"
   */
  basePath?: string;

  /**
   * Whether the entire group is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the group is read-only.
   * @default false
   */
  readOnly?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * GroupInput - Renders a nested field group
 *
 * Groups organize related fields together with two rendering modes:
 *
 * ## Named Groups (field.name exists)
 * Rendered as a Card with optional header showing label and description.
 * Sub-fields are nested under this group's path.
 *
 * @example
 * ```tsx
 * // Field config:
 * {
 *   name: 'metadata',
 *   type: 'group',
 *   label: 'Metadata',
 *   fields: [
 *     { name: 'title', type: 'text' },
 *     { name: 'description', type: 'textarea' }
 *   ]
 * }
 * // Renders as Card with fields "metadata.title" and "metadata.description"
 * ```
 *
 * ## Unnamed Groups (no field.name)
 * Rendered inline without a card wrapper, used for visual grouping only.
 * Sub-fields remain at the same nesting level.
 *
 * @example
 * ```tsx
 * // Field config:
 * {
 *   type: 'group',
 *   fields: [
 *     { name: 'firstName', type: 'text' },
 *     { name: 'lastName', type: 'text' }
 *   ]
 * }
 * // Renders inline with fields "firstName" and "lastName" (not nested)
 * ```
 *
 * ## Nested Groups
 * Groups can be nested to create hierarchical form structures:
 *
 * @example
 * ```tsx
 * {
 *   name: 'settings',
 *   type: 'group',
 *   fields: [
 *     {
 *       name: 'advanced',
 *       type: 'group',
 *       fields: [
 *         { name: 'apiKey', type: 'text' }
 *       ]
 *     }
 *   ]
 * }
 * // Results in field path: "settings.advanced.apiKey"
 * ```
 *
 * @param props - GroupInput props
 * @returns Rendered group with nested fields
 */
export function GroupInput({
  _name,
  field,
  basePath = "",
  disabled,
  readOnly,
}: GroupInputProps) {
  const [isOpen, setIsOpen] = useState(
    !(field as GroupFieldConfig & { admin?: { initCollapsed?: boolean } }).admin
      ?.initCollapsed
  );

  // Compute the path for nested fields
  // For named groups: basePath + field.name
  // For unnamed groups: just basePath (no nesting)
  const groupPath = field.name
    ? basePath
      ? `${basePath}.${field.name}`
      : field.name
    : basePath;

  // =========================================
  // Unnamed Group - Inline Rendering
  // =========================================
  // Used for visual grouping without nesting field paths
  if (!field.name) {
    return (
      <div className={cn("space-y-4", field.admin?.className)}>
        {field.fields?.map((subField, idx) => (
          <FieldRenderer
            key={(subField as { name?: string }).name || idx}
            field={subField as unknown as FieldConfig}
            basePath={basePath}
            disabled={disabled}
            readOnly={readOnly}
          />
        ))}
      </div>
    );
  }

  // =========================================
  // Named Group - Collapsible Card Rendering
  // =========================================
  return (
    <Card
      className={cn(
        "shadow-none border border-slate-200 dark:border-slate-800 overflow-hidden",
        field.admin?.className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Card Header - Collapsible trigger */}
        {field.label && (
          <CardHeader
            className="pb-3 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-800/60 p-4"
            noBorder
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 w-full text-left",
                  "rounded px-1 py-0.5",
                  "hover-unified focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                )}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {field.label}
                </CardTitle>
              </button>
            </CollapsibleTrigger>
            {field.admin?.description && isOpen && (
              <p className="text-xs text-slate-500 mt-1 pl-7">
                {field.admin.description}
              </p>
            )}
          </CardHeader>
        )}

        {/* Card Content - Nested fields */}
        <CollapsibleContent>
          <CardContent className={cn("space-y-6 p-5", !field.label && "pt-5")}>
            {field.fields?.map((subField, idx) => (
              <FieldRenderer
                key={(subField as { name?: string }).name || idx}
                field={subField as unknown as FieldConfig}
                basePath={groupPath}
                disabled={disabled}
                readOnly={readOnly}
              />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
