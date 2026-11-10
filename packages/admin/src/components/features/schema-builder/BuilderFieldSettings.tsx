"use client";

/**
 * The Schema Builder's host for the shared settings panel.
 *
 * It finds the field being edited and where it sits, says whether it has been
 * saved, and hands every change straight to the Builder's draft: the panel has
 * no Apply, so an edit is kept the moment it is made and survives switching to
 * another field. The Builder's own settings (Unique and Localized, which are
 * about its database columns) join the Advanced tab through the surface
 * configuration. Deleting a field asks first, naming it.
 *
 * On a wide screen the panel is docked beside the field list; on a narrow one,
 * where there is no room beside it, it opens as a sheet over the list. Only
 * one of the two is rendered, so its inputs are never announced twice.
 */
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
  SheetFooter,
  SheetTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";

import {
  FieldSettingsPanel,
  type FieldSettingsSurface,
  type FieldSettingsSurfaceControlProps,
} from "@admin/components/field-ui/settings-panel";
import { Trash2 } from "@admin/components/icons";
import { useMediaQuery } from "@admin/hooks/useMediaQuery";
import { toSnakeName } from "@admin/lib/builder";
import { findFieldPlacement } from "@admin/lib/builder/field-placement";
import { isRepeatingContainer } from "@admin/lib/builder/is-inside-repeating-ancestor";

import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";
import { AdvancedTab } from "./builder-field-settings/AdvancedTab";
import type { BuilderField } from "./types";

/** The Builder's Advanced settings for one kind, which its help text names. */
function builderAdvancedSettings(kind: BuilderKind) {
  return function BuilderAdvancedSettings({
    field,
    readOnly,
    onChange,
    ancestors,
  }: FieldSettingsSurfaceControlProps): JSX.Element {
    return (
      <AdvancedTab
        field={field}
        kind={kind}
        readOnly={readOnly}
        isInsideRepeatingAncestor={ancestors.some(isRepeatingContainer)}
        onChange={onChange}
      />
    );
  };
}

function builderSurface(kind: BuilderKind): FieldSettingsSurface {
  return {
    surface: "entries",
    deriveName: toSnakeName,
    conditions: "sibling",
    extraSettings: { advanced: builderAdvancedSettings(kind) },
  };
}

/**
 * One configuration per kind, made once, so the panel's Advanced settings keep
 * their identity across renders rather than remounting on every keystroke.
 */
const BUILDER_SURFACES: Readonly<Record<BuilderKind, FieldSettingsSurface>> = {
  collection: builderSurface("collection"),
  single: builderSurface("single"),
  "field-group": builderSurface("field-group"),
};

type Props = {
  kind: BuilderKind;
  fields: readonly BuilderField[];
  fieldId: string;
  /** Fields saved before; see `useBuilderEntityState`. */
  savedFieldIds: ReadonlySet<string>;
  /** A code-first entity: every setting shown, none changeable. */
  readOnly: boolean;
  onFieldChange: (next: BuilderField) => void;
  onFieldDelete: (fieldId: string) => void;
  onClose: () => void;
};

export function BuilderFieldSettings({
  kind,
  fields,
  fieldId,
  savedFieldIds,
  readOnly,
  onFieldChange,
  onFieldDelete,
  onClose,
}: Props): JSX.Element | null {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const placement = findFieldPlacement(fields, fieldId);
  if (!placement) return null;

  const { field, ancestors, siblings } = placement;
  // A field a plugin or code owns is shown read-only, like a code-first entity.
  const fieldReadOnly = readOnly || field.locked === true;
  const canDelete = !fieldReadOnly && field.isSystem !== true;
  const fieldTitle = field.label || "Untitled field";

  const panel = (
    <FieldSettingsPanel
      surface={BUILDER_SURFACES[kind]}
      field={field}
      ancestors={ancestors}
      siblings={siblings}
      saved={savedFieldIds.has(field.id)}
      readOnly={fieldReadOnly}
      onChange={onFieldChange}
      onClose={onClose}
      actions={
        canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete field"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )
      }
    />
  );

  return (
    <>
      {wide ? (
        <aside className="sticky top-16 flex max-h-[calc(100vh-4rem)] w-[420px] shrink-0 flex-col border-l border-border">
          {panel}
        </aside>
      ) : (
        <Sheet open onOpenChange={open => !open && onClose()}>
          <SheetContent
            side="right"
            // Full width on a phone, so the sheet's edge never clips; the cap
            // is re-stated in the sm variant group so it wins over the
            // sheet's own default there.
            className="w-full sm:max-w-[560px] p-0 flex flex-col [&>button]:hidden"
          >
            <SheetTitle className="sr-only">Field settings</SheetTitle>
            <SheetDescription className="sr-only">
              {`Settings of the ${fieldTitle} field.`}
            </SheetDescription>
            <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
            {/* Within thumb reach on a phone, and saying why there is no
                Apply: every change is already in the draft. */}
            <SheetFooter className="items-center gap-2 border-t border-border p-4 sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Each change is kept as you make it.
              </p>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this field?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Names the kind the field is removed from, as every Builder
                  message that refers to one does. */}
              This removes <span className="font-medium">{fieldTitle}</span>{" "}
              from the {BUILDER_KIND_NOUN[kind]}. The change applies only after
              you save; you can still cancel by leaving without saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Red because deleting a field deletes its stored values. */}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onFieldDelete(field.id);
              }}
            >
              Delete field
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
