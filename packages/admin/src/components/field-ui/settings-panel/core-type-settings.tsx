/**
 * What each built-in field type shows of its own settings in the panel.
 *
 * Keyed by every built-in type, so a type added to the union does not compile
 * until it says what its settings are; a type with none says so with an empty
 * entry. A type found here is a core type; any other is a plugin's, which
 * describes its settings itself.
 *
 * The editors each type uses take one prop per setting with a callback each;
 * the adapters below turn the panel's one `field` + `onChange` into those.
 * Read-only is honoured in every adapter: the editor still renders, so the
 * values can be read, and its callbacks change nothing.
 *
 * Each editor is imported from its own module rather than through the
 * feature's barrel: the barrel re-exports the Builder's host of this panel,
 * so reaching back through it makes a cycle.
 */
import { isFieldGroupFieldType } from "nextly/field-group-type";
import type { JSX } from "react";

import { ComponentFieldEditor } from "@admin/components/features/schema-builder/ComponentFieldEditor";
import { GroupFieldEditor } from "@admin/components/features/schema-builder/GroupFieldEditor";
import { RelationshipEditor } from "@admin/components/features/schema-builder/RelationshipEditor";
import { RepeaterFieldEditor } from "@admin/components/features/schema-builder/RepeaterFieldEditor";
import { SelectOptionsEditor } from "@admin/components/features/schema-builder/SelectOptionsEditor";
import type {
  BuilderField,
  SelectOption,
} from "@admin/components/features/schema-builder/types";
import { UploadEditor } from "@admin/components/features/schema-builder/UploadEditor";
import type { FieldPrimitiveType } from "@admin/types/collection";

import { BlocksSettings } from "./BlocksSettings";
import type { FieldSettingsControlProps, FieldTypeSettings } from "./types";

/**
 * The three ways a setting is written: on the field itself, under its
 * validation, or under its admin options. Each returns a callback that changes
 * nothing while the panel is read-only.
 *
 * Writes made in one event build on each other: an editor that sets two
 * settings for one choice (a field group's mode clears one list and sets
 * another) calls two callbacks in a row, before the host has re-rendered with
 * the first. Each write therefore starts from the last one written, not from
 * the field this render was given, or the second would undo the first.
 */
function patchers({ field, readOnly, onChange }: FieldSettingsControlProps) {
  let latest = field;
  const guard =
    <A extends unknown[]>(
      write: (from: BuilderField, ...args: A) => BuilderField
    ) =>
    (...args: A) => {
      if (readOnly) return;
      latest = write(latest, ...args);
      onChange(latest);
    };
  return {
    patch: <K extends keyof BuilderField>(key: K) =>
      guard((from, value: BuilderField[K]) => ({ ...from, [key]: value })),
    patchValidation: <K extends keyof NonNullable<BuilderField["validation"]>>(
      key: K
    ) =>
      guard((from, value: NonNullable<BuilderField["validation"]>[K]) => ({
        ...from,
        validation: { ...(from.validation ?? {}), [key]: value },
      })),
    patchAdmin: <K extends keyof NonNullable<BuilderField["admin"]>>(key: K) =>
      guard((from, value: NonNullable<BuilderField["admin"]>[K]) => ({
        ...from,
        admin: { ...(from.admin ?? {}), [key]: value },
      })),
  };
}

/** A dropdown's, radio group's or checkbox group's options and how it picks. */
function OptionsSettings(props: FieldSettingsControlProps): JSX.Element {
  const { field } = props;
  const { patch, patchAdmin } = patchers(props);
  const options: SelectOption[] = (field.options ?? []).map((opt, idx) => ({
    id: opt.id ?? `opt-${idx}-${opt.value}`,
    label: opt.label,
    value: opt.value,
  }));
  return (
    <SelectOptionsEditor
      options={options}
      onOptionsChange={patch("options")}
      hasMany={field.hasMany}
      onHasManyChange={patch("hasMany")}
      fieldType={field.type === "radio" ? "radio" : "select"}
      isClearable={field.admin?.isClearable}
      onIsClearableChange={patchAdmin("isClearable")}
      placeholder={field.admin?.placeholder}
      onPlaceholderChange={patchAdmin("placeholder")}
      layout={field.admin?.layout}
      onLayoutChange={patchAdmin("layout")}
    />
  );
}

/** What a link points to, how many, and how it is picked. */
function RelationshipSettings(props: FieldSettingsControlProps): JSX.Element {
  const { field } = props;
  const { patch, patchAdmin } = patchers(props);
  return (
    <RelationshipEditor
      relationTo={field.relationTo}
      onRelationToChange={patch("relationTo")}
      hasMany={field.hasMany}
      onHasManyChange={patch("hasMany")}
      maxDepth={field.maxDepth}
      onMaxDepthChange={patch("maxDepth")}
      allowCreate={field.allowCreate}
      onAllowCreateChange={patch("allowCreate")}
      allowEdit={field.allowEdit}
      onAllowEditChange={patch("allowEdit")}
      isSortable={field.isSortable}
      onIsSortableChange={patch("isSortable")}
      filterOptions={field.relationshipFilter}
      onFilterOptionsChange={patch("relationshipFilter")}
      appearance={field.admin?.appearance}
      onAppearanceChange={patchAdmin("appearance")}
    />
  );
}

/** Which files an upload takes, how large, and how many. */
function UploadSettings(props: FieldSettingsControlProps): JSX.Element {
  const { field } = props;
  const { patch, patchAdmin } = patchers(props);
  return (
    <UploadEditor
      hasMany={field.hasMany}
      onHasManyChange={patch("hasMany")}
      mimeTypes={field.mimeTypes}
      onMimeTypesChange={patch("mimeTypes")}
      maxFileSize={field.maxFileSize}
      onMaxFileSizeChange={patch("maxFileSize")}
      allowCreate={field.admin?.allowCreate}
      onAllowCreateChange={patchAdmin("allowCreate")}
    />
  );
}

/** How a group is drawn in the entry form. */
function GroupSettings(props: FieldSettingsControlProps): JSX.Element {
  const { patchAdmin } = patchers(props);
  return (
    <GroupFieldEditor
      hideGutter={props.field.admin?.hideGutter}
      onHideGutterChange={patchAdmin("hideGutter")}
    />
  );
}

/** How repeating rows are labelled, ordered and first shown. */
function RepeaterSettings(props: FieldSettingsControlProps): JSX.Element {
  const { field } = props;
  const { patch } = patchers(props);
  return (
    <RepeaterFieldEditor
      labels={field.labels}
      onLabelsChange={patch("labels")}
      initCollapsed={field.initCollapsed}
      onInitCollapsedChange={patch("initCollapsed")}
      isSortable={field.isSortable}
      onIsSortableChange={patch("isSortable")}
      rowLabelField={field.rowLabelField}
      onRowLabelFieldChange={patch("rowLabelField")}
      nestedFields={field.fields}
    />
  );
}

/** Which field group a field uses, and whether it repeats. */
function FieldGroupSettings(props: FieldSettingsControlProps): JSX.Element {
  const { field } = props;
  const { patch, patchValidation } = patchers(props);
  return (
    <ComponentFieldEditor
      component={field.component}
      onComponentChange={patch("component")}
      components={field.components}
      onComponentsChange={patch("components")}
      repeatable={field.repeatable}
      onRepeatableChange={patch("repeatable")}
      minRows={field.validation?.minRows}
      onMinRowsChange={patchValidation("minRows")}
      maxRows={field.validation?.maxRows}
      onMaxRowsChange={patchValidation("maxRows")}
      initCollapsed={field.initCollapsed}
      onInitCollapsedChange={patch("initCollapsed")}
      isSortable={field.isSortable}
      onIsSortableChange={patch("isSortable")}
    />
  );
}

const OPTIONS: FieldTypeSettings = { defining: OptionsSettings };

/**
 * Every built-in type's own settings. `blocks` is listed beside the primitives
 * because it reaches the Builder as a stored type without being one the picker
 * offers.
 */
/**
 * The built-in types only some surfaces offer (forms and user fields): plain
 * inputs with no settings of their own, listed so the panel knows them as
 * built in rather than waiting for, or failing to find, a plugin that declares
 * them.
 */
type SurfaceOnlyType = "url" | "phone" | "time" | "hidden" | "file";

const CORE_FIELD_TYPE_SETTINGS: Readonly<
  Record<FieldPrimitiveType | "blocks" | SurfaceOnlyType, FieldTypeSettings>
> = {
  text: {},
  textarea: {},
  richText: {},
  email: {},
  password: {},
  code: {},
  icon: {},
  number: {},
  date: {},
  json: {},
  chips: {},
  checkbox: OPTIONS,
  select: OPTIONS,
  radio: OPTIONS,
  upload: { defining: UploadSettings },
  relationship: { defining: RelationshipSettings },
  repeater: { tabs: { display: RepeaterSettings } },
  group: { tabs: { display: GroupSettings } },
  component: { defining: FieldGroupSettings },
  blocks: { defining: BlocksSettings },
  url: {},
  phone: {},
  time: {},
  hidden: {},
  file: {},
};

/**
 * A built-in type's own settings, or `undefined` for a type that is not
 * built in. Either stored spelling of the field-group type finds the
 * field-group entry, so a migrated definition gets the same controls.
 */
export function coreFieldTypeSettings(
  type: string
): FieldTypeSettings | undefined {
  if (isFieldGroupFieldType(type)) return CORE_FIELD_TYPE_SETTINGS.component;
  return Object.prototype.hasOwnProperty.call(CORE_FIELD_TYPE_SETTINGS, type)
    ? CORE_FIELD_TYPE_SETTINGS[type as keyof typeof CORE_FIELD_TYPE_SETTINGS]
    : undefined;
}
