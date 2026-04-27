/**
 * BuilderPageTemplate — Shared UI composition for all builder pages.
 *
 * Provides the three-panel layout (FieldList + BuilderSidebar) wrapped in
 * DndContext + FormProvider + QueryErrorBoundary. Each builder page (collection,
 * component, single — create and edit) passes its mode-specific settings panel
 * via `settingsSlot` and wires up save/cancel behaviour.
 *
 * Layout:
 * - Left:  Breadcrumb, page title, action buttons, FieldList canvas
 * - Right: BuilderSidebar — Field Palette | Settings (settingsSlot) | Field Editor
 */

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Button, Spinner } from "@revnixhq/ui";
import React, { type ReactNode } from "react";
import { FormProvider, type FieldValues } from "react-hook-form";

import {
  BuilderSettings,
  BuilderSidebar,
  FieldEditor,
  FieldList,
  FieldPalette,
  type FieldListDragData,
  type PaletteDragData,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import type { UseFieldBuilderReturn } from "@admin/hooks/useFieldBuilder";
import { nestedFieldPriorityCollision } from "@admin/lib/builder";

// ---------------------------------------------------------------------------
// DragOverlayContent — shared preview rendered while dragging
// ---------------------------------------------------------------------------

const OVERLAY_FIELD_TYPE_ICONS: Record<string, string> = {
  text: "Type",
  textarea: "AlignLeft",
  richText: "Edit",
  email: "Mail",
  password: "Lock",
  code: "Code",
  number: "Hash",
  checkbox: "CheckSquare",
  date: "Calendar",
  select: "List",
  radio: "Circle",
  upload: "Upload",
  relationship: "Link2",
  array: "Layers",
  repeater: "Layers",
  group: "FolderOpen",
  json: "Braces",
  component: "Puzzle",
};

type IconMap = Record<string, React.ComponentType<{ className?: string }>>;
const iconMap = Icons as unknown as IconMap;

function DragOverlayContent({
  data,
}: {
  data: PaletteDragData | FieldListDragData;
}) {
  if (data.source === "palette") {
    const IconComponent = iconMap[data.icon] ?? Icons.FileText;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-primary bg-background shadow-lg">
        <IconComponent className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground">
          {data.label}
        </span>
      </div>
    );
  }

  const field = data.field;
  const iconName = OVERLAY_FIELD_TYPE_ICONS[field.type] ?? "FileText";
  const IconComponent = iconMap[iconName] ?? Icons.FileText;
  const isRequired = field.validation?.required;

  return (
    <div
      className="flex items-center gap-3 py-3 px-4 bg-background border border-border/60 rounded-xl shadow-lg cursor-grabbing"
      style={{ minWidth: 320 }}
    >
      <div className="p-1.5 shrink-0">
        <Icons.GripVertical className="h-4 w-4 text-primary" />
      </div>
      <div
        className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80 mr-1"
        style={{
          borderRadius: "6px",
          border: "1px solid hsl(var(--primary) / 0.25)",
        }}
      >
        <IconComponent className="h-4 w-4" />
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-sm font-medium text-foreground truncate">
          {field.label || field.name || "Unnamed Field"}
        </span>
        <span className="text-muted-foreground/40 text-xs shrink-0">•</span>
        <span className="text-[10px] font-medium shrink-0 px-2 py-0 leading-5 rounded-full border border-border/60 bg-muted text-muted-foreground capitalize">
          {field.type}
        </span>
        {isRequired && (
          <span className="text-[10px] px-2 py-0 leading-5 bg-red-50 text-red-600 font-normal rounded-full border border-red-200 shrink-0">
            Required
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
  href?: string;
  label: string;
  icon?: ReactNode;
}

export interface BuilderPageTemplateProps<T extends FieldValues = FieldValues> {
  /** All state and handlers from useFieldBuilder */
  builder: UseFieldBuilderReturn<T>;

  /** Breadcrumb trail leading up to the current page */
  breadcrumbItems: BreadcrumbItem[];
  /** Current page label shown at the end of the breadcrumb */
  breadcrumbCurrentLabel: string;

  /** Page title (h1) */
  headerTitle: string;
  /** Page subtitle */
  headerDescription: string;
  /** Optional icon badge shown before the title (used by edit pages) */
  headerIcon?: ReactNode;

  /** Async save action — typically calls a mutation */
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  /** Label for the save button — defaults to "Save" */
  saveLabel?: string;

  /** Entity type — controls BuilderSettings label */
  entityType: "collection" | "component" | "single";

  /**
   * Mode-specific settings panel injected into the sidebar Settings tab.
   * Typically: <CollectionSettings /> + <HooksEditor />, or <ComponentSettings />, etc.
   */
  settingsSlot: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuilderPageTemplate<T extends FieldValues = FieldValues>({
  builder,
  breadcrumbItems,
  breadcrumbCurrentLabel,
  headerTitle,
  headerDescription,
  headerIcon,
  onSave,
  onCancel,
  isSaving,
  saveLabel = "Save",
  entityType,
  settingsSlot,
}: BuilderPageTemplateProps<T>) {
  const {
    form,
    fields,
    selectedField,
    siblingFields,
    searchQuery,
    setSearchQuery,
    sidebarTab,
    setSidebarTab,
    activeDragData,
    sensors,
    handleDragStart,
    handleDragEnd,
    handleFieldAdd,
    handleFieldSelect,
    handleFieldsReorder,
    handleFieldDelete,
    handleFieldUpdate,
    handleEditorClose,
    setActiveContainerId,
  } = builder;

  const isDraggingFromPalette = activeDragData?.source === "palette";

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <FormProvider {...form}>
        <DndContext
          sensors={sensors}
          collisionDetection={nestedFieldPriorityCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="h-full bg-background flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
              {/* Left Column — main canvas */}
              <div className="flex-1 min-h-[500px] lg:h-full lg:overflow-y-auto admin-page-container [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                <div className="w-full py-6 sm:py-8 px-4 sm:px-6 lg:px-8">
                  <div className="space-y-8 mb-8">
                    {/* Breadcrumb */}
                    <nav
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                      aria-label="Breadcrumb"
                    >
                      {breadcrumbItems.map((item, index) => (
                        <React.Fragment key={index}>
                          {index > 0 && (
                            <Icons.ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                          )}
                          {item.href ? (
                            <Link
                              href={item.href}
                              className="flex items-center gap-1.5 hover:text-foreground transition-colors duration-150"
                            >
                              {item.icon}
                              <span>{item.label}</span>
                            </Link>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              {item.icon}
                              <span>{item.label}</span>
                            </span>
                          )}
                        </React.Fragment>
                      ))}
                      <Icons.ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                      <span className="text-foreground font-medium">
                        {breadcrumbCurrentLabel}
                      </span>
                    </nav>

                    {/* Page Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div
                        className={
                          headerIcon ? "flex items-center gap-3" : undefined
                        }
                      >
                        {headerIcon && (
                          <div className="p-2 sm:p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
                            {headerIcon}
                          </div>
                        )}
                        <div>
                          <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            {headerTitle}
                          </h1>
                          <p className="text-base text-muted-foreground mt-2">
                            {headerDescription}
                          </p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button
                          variant="outline"
                          onClick={onCancel}
                          disabled={isSaving}
                          className="flex-1 sm:flex-initial gap-2 bg-background"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={onSave}
                          disabled={isSaving}
                          className="flex-1 sm:flex-initial gap-2"
                        >
                          {isSaving ? (
                            <>
                              <Spinner size="sm" className="mr-2" />
                              Saving...
                            </>
                          ) : (
                            saveLabel
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* FieldList canvas */}
                  <div className="space-y-8">
                    <div className="min-h-[400px] flex flex-col">
                      <div className="p-0 flex-1">
                        <FieldList
                          fields={fields}
                          selectedFieldId={builder.selectedFieldId}
                          onFieldSelect={handleFieldSelect}
                          onFieldsReorder={handleFieldsReorder}
                          onFieldDelete={handleFieldDelete}
                          onFieldAdd={() => setSidebarTab("add")}
                          isDropping={isDraggingFromPalette}
                          onPlaceholderClick={parentFieldId => {
                            setActiveContainerId(parentFieldId ?? null);
                            setSidebarTab("add");
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Sidebar */}
              <div className="w-full lg:w-[400px] shrink-0 border-t lg:border-t-0 lg:border-l-[1px] border-border bg-background lg:h-full z-20">
                <BuilderSidebar
                  activeTab={sidebarTab}
                  onTabChange={setSidebarTab}
                  palette={
                    <FieldPalette
                      onFieldAdd={handleFieldAdd}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                    />
                  }
                  settings={
                    <BuilderSettings
                      isSaving={isSaving}
                      entityType={entityType}
                    >
                      {settingsSlot}
                    </BuilderSettings>
                  }
                  editor={
                    <FieldEditor
                      field={selectedField}
                      onFieldUpdate={handleFieldUpdate}
                      onClose={handleEditorClose}
                      siblingFields={siblingFields}
                    />
                  }
                />
              </div>
            </div>
          </div>

          {/* DragOverlay */}
          <DragOverlay
            dropAnimation={{
              duration: 200,
              easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
            }}
          >
            {activeDragData ? (
              <DragOverlayContent data={activeDragData} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </FormProvider>
    </QueryErrorBoundary>
  );
}
