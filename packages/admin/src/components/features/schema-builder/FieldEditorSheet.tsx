// Why: right-side off-canvas editor for a single BuilderField. Shell wires:
// - Sheet primitive at ~560px on desktop, full-width on mobile.
// - Header with field icon (placeholder), name, and type/width subtitle.
// - 4 tabs (General / Validation / Admin / Advanced) — content is delegated
//   to per-tab components so this file stays small.
// - Footer that swaps based on mode and readOnly:
//   - Editable: [Delete field] (left, hidden for system fields) +
//     [Cancel] [Apply] (right).
//   - readOnly: single [Close] button (right). Used for code-first locked
//     collections so devs can inspect the schema without editing.
//
// State model: the sheet keeps a local draft and emits via onApply on
// commit. Parent owns the field list and the in-memory builder state.
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { useState } from "react";

import { AdvancedTab } from "./field-editor-sheet/AdvancedTab";
import { DisplayTab } from "./field-editor-sheet/DisplayTab";
import { GeneralTab } from "./field-editor-sheet/GeneralTab";
import { ValidationTab } from "./field-editor-sheet/ValidationTab";
import type { BuilderField } from "./types";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  field: BuilderField;
  /**
   * Existing fields in the same parent scope. Used by GeneralTab for
   * name-uniqueness checks AND by DisplayTab's ConditionBuilder for
   * the source-field dropdown. PR E2 (2026-05-03) widened this from
   * `siblingNames: string[]` to `siblingFields: BuilderField[]` so
   * ConditionBuilder can see each sibling's type.
   */
  siblingFields: readonly BuilderField[];
  /** Lock all editing affordances (used for code-first collections). */
  readOnly?: boolean;
  onCancel: () => void;
  onApply: (next: BuilderField) => void;
  onDelete: () => void;
  /**
   * PR D: when editing a `repeater` / `group` field, the legacy
   * ArrayFieldEditor / GroupFieldEditor renders a "+ Add field" button.
   * Clicking it asks the parent page to open the FieldPickerModal scoped
   * to this parent (parentFieldId is the field's id). The parent then
   * commits the new child via builder.handleNestedFieldAdd.
   */
  onAddNestedField?: (parentFieldId: string) => void;
};

type TabKey = "general" | "validation" | "admin" | "advanced";

export function FieldEditorSheet({
  open,
  mode,
  field,
  siblingFields,
  readOnly = false,
  onCancel,
  onApply,
  onDelete,
  onAddNestedField,
}: Props) {
  const [draft, setDraft] = useState<BuilderField>(field);
  const [tab, setTab] = useState<TabKey>("general");

  const isSystem = field.isSystem === true;
  const widthLabel = field.admin?.width ?? "100%";

  return (
    <Sheet open={open} onOpenChange={next => !next && onCancel()}>
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 justify-between">
            {/* PR E1 -- name on the left, type+width chip on the right per
                feedback Section 4. */}
            <span className="truncate">
              {mode === "create" ? "New field" : draft.name || "untitled"}
            </span>
            <span className="text-[10px] text-muted-foreground font-normal border border-border rounded-sm px-1.5 py-0.5 shrink-0">
              {draft.type} &middot; {widthLabel}
            </span>
          </SheetTitle>
          {/* a11y: SheetDescription is always required by Radix Dialog. */}
          <SheetDescription className="sr-only">
            {readOnly
              ? `View settings for the ${draft.name} field. This field is read-only.`
              : `Edit settings for the ${draft.name} field across General, Validation, Admin, and Advanced tabs.`}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={v => setTab(v as TabKey)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="mx-4 mt-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="validation">Validation</TabsTrigger>
            {/* PR E1: renamed "Admin" -> "Display" per feedback Section 4.
                The tab `value` stays "admin" so existing localStorage / state
                keyed on the value (if any) doesn't break; only the
                user-visible label changes. */}
            <TabsTrigger value="admin">Display</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto p-4">
            <TabsContent value="general">
              <GeneralTab
                field={draft}
                siblingNames={siblingFields.map(f => f.name)}
                readOnly={readOnly}
                onChange={setDraft}
                onAddNestedField={onAddNestedField}
              />
            </TabsContent>
            <TabsContent value="validation">
              <ValidationTab
                field={draft}
                readOnly={readOnly}
                onChange={setDraft}
              />
            </TabsContent>
            <TabsContent value="admin">
              <DisplayTab
                field={draft}
                siblingFields={siblingFields}
                readOnly={readOnly}
                onChange={setDraft}
              />
            </TabsContent>
            <TabsContent value="advanced">
              <AdvancedTab
                field={draft}
                readOnly={readOnly}
                onChange={setDraft}
              />
            </TabsContent>
          </div>
        </Tabs>

        <div className="p-4 border-t border-border flex items-center">
          {readOnly ? (
            <div className="ml-auto">
              <Button variant="outline" onClick={onCancel}>
                Close
              </Button>
            </div>
          ) : (
            <>
              {/* Why: Delete only makes sense in edit mode -- in create mode
                  there's no committed field to delete (the draft hasn't been
                  added to the list yet, so the right discard action is
                  Cancel). */}
              {!isSystem && mode === "edit" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={onDelete}
                >
                  Delete field
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button onClick={() => onApply(draft)}>
                  {mode === "create" ? "Add field" : "Apply"}
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
