/**
 * The control for one content setting: Collection, Filter, Sort or Group by.
 *
 * Its choices come from what the server sent for this reader
 * (`widgetSources`): the collections whose own card the reader may see, and
 * for each, only the fields no read rule can refuse. So a field a person may
 * not read is never one they can pick, whatever the widget declares.
 *
 * Collection, Sort and Group by are drawn as ordinary select fields through
 * `FieldRenderer`, the same input every other setting uses: a select setting
 * is a field definition, and building one keeps a reader on inputs they know.
 * Filter is one condition row, written as the query's `where`.
 */
import type {
  ContentSetting,
  PublishedContentSource,
  WidgetSetting,
} from "nextly/config";
import { useController, useWatch } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { ConditionRow } from "@admin/components/field-ui";

import {
  conditionToWhere,
  conditionTypeOf,
  filterOperatorsFor,
  whereToCondition,
} from "./content-filter";

export interface ContentSettingControlProps {
  setting: ContentSetting;
  sources: readonly PublishedContentSource[];
}

type Field = PublishedContentSource["fields"][number];

const labelOf = (field: Field) => field.label ?? field.name;

/** A select setting with these options, for `FieldRenderer` to draw. */
function selectOf(
  setting: ContentSetting,
  options: { label: string; value: string }[]
): WidgetSetting {
  return {
    name: setting.name,
    type: "select",
    ...(setting.label === undefined ? {} : { label: setting.label }),
    ...(setting.admin === undefined ? {} : { admin: setting.admin }),
    options,
  };
}

export function ContentSettingControl({
  setting,
  sources,
}: ContentSettingControlProps) {
  // The collection a dependent setting works over, as the form holds it now,
  // so its choices follow a change made in the same sheet.
  const collection = useWatch({
    name: setting.type === "collection" ? setting.name : setting.of,
  }) as unknown;
  const fields =
    sources.find(source => source.collection === collection)?.fields ?? [];

  if (setting.type === "collection") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          sources.map(source => ({
            label: source.label,
            value: source.collection,
          }))
        )}
        mode="edit"
      />
    );
  }
  if (setting.type === "groupBy") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          fields.map(field => ({ label: labelOf(field), value: field.name }))
        )}
        mode="edit"
      />
    );
  }
  if (setting.type === "sort") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          fields.flatMap(field => [
            { label: `${labelOf(field)}, ascending`, value: field.name },
            { label: `${labelOf(field)}, descending`, value: `-${field.name}` },
          ])
        )}
        mode="edit"
      />
    );
  }
  return <FilterControl setting={setting} fields={fields} />;
}

function FilterControl({
  setting,
  fields,
}: {
  setting: Extract<ContentSetting, { type: "filter" }>;
  fields: readonly Field[];
}) {
  const { field } = useController({ name: setting.name });
  const typeOf = (name: string) => {
    const found = fields.find(candidate => candidate.name === name);
    return found === undefined ? undefined : conditionTypeOf(found);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {setting.label ?? setting.name}
      </span>
      <ConditionRow
        condition={whereToCondition(field.value, typeOf)}
        sources={fields.map(source => ({
          name: source.name,
          label: labelOf(source),
          type: conditionTypeOf(source),
          ...(source.choices === undefined
            ? {}
            : {
                options: source.choices.map(choice => ({
                  value: choice.value,
                  label: choice.label,
                })),
              }),
        }))}
        operatorsFor={filterOperatorsFor}
        // An incomplete row stores nothing, so the card keeps reading every
        // row until the condition can be written.
        onChange={next => field.onChange(conditionToWhere(next) ?? "")}
      />
    </div>
  );
}
