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

import { AdminTab } from "./field-editor-sheet/AdminTab";
import { AdvancedTab } from "./field-editor-sheet/AdvancedTab";
import { GeneralTab } from "./field-editor-sheet/GeneralTab";
import { ValidationTab } from "./field-editor-sheet/ValidationTab";
import type { BuilderField } from "./types";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  field: BuilderField;
  /** Existing field names in the same parent scope — for uniqueness checks. */
  siblingNames: readonly string[];
  /** Lock all editing affordances (used for code-first collections). */
  readOnly?: boolean;
  onCancel: () => void;
  onApply: (next: BuilderField) => void;
  onDelete: () => void;
};

type TabKey = "general" | "validation" | "admin" | "advanced";

export function FieldEditorSheet({
  open,
  mode,
  field,
  siblingNames,
  readOnly = false,
  onCancel,
  onApply,
  onDelete,
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
          <SheetTitle className="flex items-center gap-2">
            <span>{mode === "create" ? "New field" : draft.name}</span>
            <span className="text-xs text-muted-foreground font-normal">
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
            <TabsTrigger value="admin">Admin</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto p-4">
            <TabsContent value="general">
              <GeneralTab
                field={draft}
                siblingNames={siblingNames}
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
              <AdminTab field={draft} readOnly={readOnly} onChange={setDraft} />
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
