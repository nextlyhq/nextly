// Why: HooksEditor used to live in BuilderSidebar's tab in the legacy UI.
// The redesign hosts it in a right-side Sheet, opened from the
// BuilderToolbar's Hooks button. This wrapper keeps the existing
// HooksEditor logic untouched (preserves all the hook-config / sortable /
// selector behavior) and just adds the Sheet shell + Close button.
//
// Sheet is wider (640px) than FieldEditorSheet (560px) because hook
// configs are JSON-shaped and benefit from the extra width.
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@revnixhq/ui";

import { HooksEditor } from "./HooksEditor";
import type { EnabledHook } from "./types";

type Props = {
  open: boolean;
  hooks: EnabledHook[];
  /** Field names available for hook field-selector dropdowns. */
  fieldNames: string[];
  onClose: () => void;
  onChange: (hooks: EnabledHook[]) => void;
};

export function HooksEditorSheet({
  open,
  hooks,
  fieldNames,
  onClose,
  onChange,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-[640px] sm:max-w-[640px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle>Hooks</SheetTitle>
          <SheetDescription className="sr-only">
            Configure pre-built hooks for this collection. Hooks run on create,
            update, and delete operations.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <HooksEditor
            hooks={hooks}
            onHooksChange={onChange}
            fieldNames={fieldNames}
            isExpanded
          />
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
