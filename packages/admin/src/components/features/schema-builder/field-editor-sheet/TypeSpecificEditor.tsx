// Why: legacy type-specific editors (SelectOptionsEditor / RelationshipEditor
// / UploadEditor / Array / Group / Component) take per-property props with
// their own onChange callbacks. The new FieldEditorSheet uses a unified
// `BuilderField` + `onChange(next)` contract. This file is the bridge —
// per-type adapter wrappers that translate prop shapes both ways.
//
// PR 2 scope: select / radio / checkbox / relationship / upload / group /
// repeater / component are wired. `blocks` has no dedicated editor in the
// legacy code; skipped here and noted as a PR 3 follow-up.
//
// readOnly is honored everywhere — when true, the legacy editor still
// renders (so devs can inspect) but every onChange callback becomes a
// no-op so values can't change.
import {
  ArrayFieldEditor,
  ComponentFieldEditor,
  GroupFieldEditor,
  RelationshipEditor,
  SelectOptionsEditor,
  UploadEditor,
} from "@admin/components/features/schema-builder";

import type { BuilderField, RelationshipFilter, SelectOption } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
  /**
   * PR D: page-level callback that opens the FieldPickerModal scoped to
   * the parent (this field). Used by the legacy ArrayFieldEditor /
   * GroupFieldEditor below to render an "+ Add field" button.
   */
  onAddNestedField?: (parentFieldId: string) => void;
};

/**
 * No-op variant for readOnly mode. Wrap every adapter callback so that
 * when the legacy editor fires onChange, we swallow it silently. The
 * editor still renders the current values (so devs can read them), they
 * just can't be changed.
 */
function noop() {
  // intentionally empty
}

export function TypeSpecificEditor({
  field,
  readOnly = false,
  onChange,
  onAddNestedField,
}: Props) {
  // Patch helper — every adapter mutates `field` immutably through here.
  const patch = (changes: Partial<BuilderField>) => {
    if (readOnly) return;
    onChange({ ...field, ...changes });
  };
  const patchValidation = (
    changes: Partial<NonNullable<BuilderField["validation"]>>
  ) => {
    if (readOnly) return;
    onChange({
      ...field,
      validation: { ...(field.validation ?? {}), ...changes },
    });
  };
  const patchAdmin = (changes: Partial<NonNullable<BuilderField["admin"]>>) => {
    if (readOnly) return;
    onChange({
      ...field,
      admin: { ...(field.admin ?? {}), ...changes },
    });
  };

  // Select / radio / checkbox — all share the options-list shape.
  if (
    field.type === "select" ||
    field.type === "radio" ||
    field.type === "checkbox"
  ) {
    // FieldOption.id is optional in storage but the legacy editor needs
    // a non-empty id for drag/drop. Synthesize one for any option that
    // lacks one — same convention the legacy FieldEditor uses on load.
    const optionsForEditor: SelectOption[] = (field.options ?? []).map(
      (opt, idx) => ({
        id: opt.id ?? `opt-${idx}-${opt.value}`,
        label: opt.label,
        value: opt.value,
      })
    );
    return (
      <SelectOptionsEditor
        options={optionsForEditor}
        onOptionsChange={
          readOnly ? noop : (opts: SelectOption[]) => patch({ options: opts })
        }
        hasMany={field.hasMany}
        onHasManyChange={
          readOnly ? noop : (v: boolean) => patch({ hasMany: v })
        }
        // Legacy editor expects "select" | "radio" — checkbox is multi-select
        // so it shares the select layout (multi-checkbox).
        fieldType={field.type === "radio" ? "radio" : "select"}
      />
    );
  }

  if (field.type === "relationship") {
    return (
      <RelationshipEditor
        relationTo={field.relationTo}
        onRelationToChange={
          readOnly
            ? noop
            : (r: string | string[] | undefined) => patch({ relationTo: r })
        }
        hasMany={field.hasMany}
        onHasManyChange={
          readOnly ? noop : (v: boolean) => patch({ hasMany: v })
        }
        maxDepth={field.maxDepth}
        onMaxDepthChange={
          readOnly ? noop : (d: number | undefined) => patch({ maxDepth: d })
        }
        allowCreate={field.allowCreate}
        onAllowCreateChange={
          readOnly ? noop : (v: boolean) => patch({ allowCreate: v })
        }
        allowEdit={field.allowEdit}
        onAllowEditChange={
          readOnly ? noop : (v: boolean) => patch({ allowEdit: v })
        }
        isSortable={field.isSortable}
        onIsSortableChange={
          readOnly ? noop : (v: boolean) => patch({ isSortable: v })
        }
        filterOptions={field.relationshipFilter}
        onFilterOptionsChange={
          readOnly
            ? noop
            : (f: RelationshipFilter | undefined) =>
                patch({ relationshipFilter: f })
        }
      />
    );
  }

  if (field.type === "upload") {
    return (
      <UploadEditor
        relationTo={field.relationTo}
        onRelationToChange={
          readOnly
            ? noop
            : (r: string | string[] | undefined) => patch({ relationTo: r })
        }
        hasMany={field.hasMany}
        onHasManyChange={
          readOnly ? noop : (v: boolean) => patch({ hasMany: v })
        }
        mimeTypes={field.mimeTypes}
        onMimeTypesChange={
          readOnly ? noop : (m: string | undefined) => patch({ mimeTypes: m })
        }
        maxFileSize={field.maxFileSize}
        onMaxFileSizeChange={
          readOnly ? noop : (s: number | undefined) => patch({ maxFileSize: s })
        }
        allowCreate={field.allowCreate}
        onAllowCreateChange={
          readOnly ? noop : (v: boolean) => patch({ allowCreate: v })
        }
        allowEdit={field.allowEdit}
        onAllowEditChange={
          readOnly ? noop : (v: boolean) => patch({ allowEdit: v })
        }
        isSortable={field.isSortable}
        onIsSortableChange={
          readOnly ? noop : (v: boolean) => patch({ isSortable: v })
        }
        displayPreview={field.displayPreview}
        onDisplayPreviewChange={
          readOnly ? noop : (v: boolean) => patch({ displayPreview: v })
        }
      />
    );
  }

  if (field.type === "group") {
    return (
      <GroupFieldEditor
        hideGutter={field.admin?.hideGutter}
        onHideGutterChange={
          readOnly ? noop : (v: boolean) => patchAdmin({ hideGutter: v })
        }
        nestedFields={field.fields}
        onAddField={
          readOnly || !onAddNestedField
            ? undefined
            : () => onAddNestedField(field.id)
        }
      />
    );
  }

  if (field.type === "repeater") {
    return (
      <ArrayFieldEditor
        labels={field.labels}
        onLabelsChange={
          readOnly
            ? noop
            : (l: BuilderField["labels"] | undefined) => patch({ labels: l })
        }
        initCollapsed={field.initCollapsed}
        onInitCollapsedChange={
          readOnly ? noop : (v: boolean) => patch({ initCollapsed: v })
        }
        isSortable={field.isSortable}
        onIsSortableChange={
          readOnly ? noop : (v: boolean) => patch({ isSortable: v })
        }
        rowLabelField={field.rowLabelField}
        onRowLabelFieldChange={
          readOnly
            ? noop
            : (n: string | undefined) => patch({ rowLabelField: n })
        }
        nestedFields={field.fields}
        onAddField={
          readOnly || !onAddNestedField
            ? undefined
            : () => onAddNestedField(field.id)
        }
      />
    );
  }

  if (field.type === "component") {
    return (
      <ComponentFieldEditor
        component={field.component}
        onComponentChange={
          readOnly ? noop : (c: string | undefined) => patch({ component: c })
        }
        components={field.components}
        onComponentsChange={
          readOnly
            ? noop
            : (cs: string[] | undefined) => patch({ components: cs })
        }
        repeatable={field.repeatable}
        onRepeatableChange={
          readOnly ? noop : (v: boolean) => patch({ repeatable: v })
        }
        minRows={field.validation?.minRows}
        onMinRowsChange={
          readOnly
            ? noop
            : (n: number | undefined) => patchValidation({ minRows: n })
        }
        maxRows={field.validation?.maxRows}
        onMaxRowsChange={
          readOnly
            ? noop
            : (n: number | undefined) => patchValidation({ maxRows: n })
        }
        initCollapsed={field.initCollapsed}
        onInitCollapsedChange={
          readOnly ? noop : (v: boolean) => patch({ initCollapsed: v })
        }
        isSortable={field.isSortable}
        onIsSortableChange={
          readOnly ? noop : (v: boolean) => patch({ isSortable: v })
        }
      />
    );
  }

  // blocks — no dedicated legacy editor; PR 3 follow-up.
  return null;
}
