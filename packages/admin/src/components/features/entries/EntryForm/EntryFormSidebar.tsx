"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";
import { ChevronDown } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";
import { cn } from "@admin/lib/utils";

import { EntryFormContent } from "./EntryFormContent";
import type { EntryFormMode, EntryData } from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormSidebarProps {
  /** Form mode - 'create' or 'edit' */
  mode: EntryFormMode;
  /** Entry data with timestamps */
  entry?: EntryData | null;
  /** Whether sidebar should be hidden (embedded mode) */
  hidden?: boolean;
  /** Sidebar specific fields configured via admin.position = 'sidebar' */
  fields?: FieldConfig[];
  /** Explicitly extracted slug field */
  slugField?: FieldConfig;
  /** Explicitly extracted seo field group */
  seoField?: FieldConfig;
  /** Action buttons (Save, Cancel, Delete, etc.) */
  actions?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryFormSidebar - Tabless sidebar with actions, slug, sidebar fields, SEO and metadata
 */
export function EntryFormSidebar({
  mode,
  entry,
  hidden = false,
  fields = [],
  slugField,
  seoField,
  actions,
}: EntryFormSidebarProps) {
  const isCreateMode = mode === "create";
  const [isDocInfoOpen, setIsDocInfoOpen] = useState(true);
  const { formatDate } = useAdminDateFormatter();

  const createdAt =
    (entry?.createdAt) ??
    (entry?.created_at as string | undefined) ??
    undefined;
  const updatedAt =
    (entry?.updatedAt) ??
    (entry?.updated_at as string | undefined) ??
    undefined;

  const formatDocumentDate = (dateString: string | undefined) => {
    if (!dateString) return "—";
    return formatDate(
      dateString,
      {
        dateStyle: "medium",
        timeStyle: "short",
      },
      dateString
    );
  };

  if (hidden) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-y-auto">
      {/* Action Buttons */}
      {actions && (
        <div className="px-6 py-4 border-b border-border bg-background shrink-0">
          {actions}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Slug field */}
        {slugField && (
          <div className="px-6 py-4 border-b border-border">
            <EntryFormContent fields={[slugField]} />
          </div>
        )}

        {/* Sidebar-positioned component fields — accordion, full-bleed */}
        {fields.length > 0 && (
          <div className="flex flex-col">
            <EntryFormContent fields={fields} className="space-y-0" />
          </div>
        )}

        {/* SEO section */}
        {seoField && (
          <div className="px-6 py-4 border-b border-border">
            <EntryFormContent fields={[seoField]} />
          </div>
        )}

        {/* Document Info — edit mode only */}
        {!isCreateMode && (
          <div>
            <div
              onClick={() => setIsDocInfoOpen(!isDocInfoOpen)}
              className="w-full flex items-center justify-between bg-primary/10 text-primary px-6 py-3 transition-all duration-200 cursor-pointer border-y border-primary/20 hover:border-primary/50 relative z-10"
            >
              <h3 className="text-sm font-medium">Document Info</h3>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  isDocInfoOpen ? "rotate-0" : "-rotate-90"
                )}
              />
            </div>

            {isDocInfoOpen && (
              <div className="space-y-4 px-6 pt-6 pb-6 border-b border-primary/20 z-0">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-1">
                    Document ID
                  </dt>
                  <dd className="text-sm font-mono text-foreground break-all">
                    {entry?.id}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-1">
                    Created
                  </dt>
                  <dd className="text-sm text-foreground">
                    {formatDocumentDate(createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground mb-1">
                    Last Updated
                  </dt>
                  <dd className="text-sm text-foreground">
                    {formatDocumentDate(updatedAt)}
                  </dd>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
