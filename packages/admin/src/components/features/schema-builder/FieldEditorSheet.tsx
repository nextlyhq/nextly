// Why: right-side off-canvas editor for a single BuilderField. Shell wires:
// - Sheet primitive at ~560px on desktop, full-width on mobile.
// - Header with field name, type/width subtitle, and (in edit mode) a
//   destructive trash-icon button next to the name. The icon opens an
//   AlertDialog confirm before firing onDelete -- destructive action lives
//   near the entity it deletes (matches WordPress ACF / Directus pattern).
// - 4 tabs (General / Validation / Admin / Advanced) -- left-aligned with
//   w-full + justify-start to match the rest of the admin's tab pattern.
//   Tab content is delegated to per-tab components so this file stays small.
// - Footer that swaps based on mode and readOnly:
//   - Editable: [Cancel] [Apply] (right). Delete moved to header.
//   - readOnly: single [Close] button (right). Used for code-first locked
//     collections so devs can inspect the schema without editing.
//
// State model: the sheet keeps a local draft and emits via onApply on
// commit. Parent owns the field list and the in-memory builder state.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
} from "@nextlyhq/ui";
import { Trash2 } from "lucide-react";
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
   * PR E3: page-computed flag indicating the field being edited is a
   * descendant of a repeating container. Forwarded to AdvancedTab to
   * disable the `unique` switch with explanatory tooltip.
   */
  isInsideRepeatingAncestor?: boolean;
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
  isInsideRepeatingAncestor = false,
}: Props) {
  const [draft, setDraft] = useState<BuilderField>(field);
  const [tab, setTab] = useState<TabKey>("general");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isSystem = field.isSystem === true;
  const widthLabel = field.admin?.width ?? "100%";
  // Delete affordance is only meaningful in edit mode for non-system,
  // non-readOnly fields. In create mode the field hasn't been committed
  // yet, so the right discard action is Cancel.
  const canDelete = !readOnly && !isSystem && mode === "edit";

  return (
    <Sheet open={open} onOpenChange={next => !next && onCancel()}>
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 justify-between">
            {/* Left zone: name + (optional) destructive trash icon.
                The icon sits next to the name so the destructive action is
                visually anchored to the entity it deletes. */}
            <div className="flex items-center gap-1 min-w-0">
              <span className="truncate">
                {mode === "create" ? "New field" : draft.name || "untitled"}
              </span>
              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Delete field"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {/* PR H feedback 2.2: Type and Width on separate labeled
                rows on the right side of the header (was one combined
                chip "text · 100%"). */}
            <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground font-normal shrink-0">
              <span>
                <span className="opacity-60">Type:</span> {draft.type}
              </span>
              <span>
                <span className="opacity-60">Width:</span> {widthLabel}
              </span>
            </div>
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
          <TabsList className="mt-3 px-4 w-full justify-start">
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
                isInsideRepeatingAncestor={isInsideRepeatingAncestor}
                onChange={setDraft}
              />
            </TabsContent>
          </div>
        </Tabs>

        <div className="p-4 border-t border-border flex items-center justify-start gap-2">
          {readOnly ? (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          ) : (
            <>
              {/* Footer order is primary-action-first per Task 7-2 spec:
                  the Add field / Apply button renders to the LEFT of Cancel,
                  with the whole footer left-aligned. */}
              <Button onClick={() => onApply(draft)}>
                {mode === "create" ? "Add field" : "Apply"}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </SheetContent>
      {/* Confirm dialog for the header trash icon. Lives outside <SheetContent>
          so its overlay/portal is independent of the sheet's. */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this field?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-medium">{draft.name}</span>{" "}
              from the schema. The change applies only after you save the
              builder; you can still cancel by leaving without saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onDelete();
              }}
            >
              Delete field
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
