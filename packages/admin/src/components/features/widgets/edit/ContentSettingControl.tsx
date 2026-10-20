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
import { Button } from "@nextlyhq/ui";
import type {
  ContentSetting,
  PublishedContentSource,
  SelectFieldConfig,
} from "nextly/config";
import { useEffect, useRef, useState } from "react";
import { useController, useWatch } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { ConditionRow, type ConditionValue } from "@admin/components/field-ui";

import {
  conditionToWhere,
  conditionTypeOf,
  filterOperatorsFor,
  whereToCondition,
} from "./content-filter";
import { fieldFits, sameSettingValue } from "./content-settings";

export interface ContentSettingControlProps {
  setting: ContentSetting;
  sources: readonly PublishedContentSource[];
}

type Field = PublishedContentSource["fields"][number];

const labelOf = (field: Field) => field.label ?? field.name;

/**
 * A select field with these options, for `FieldRenderer` to draw. Clearable
 * where no choice at all is a valid answer, so one setting can be emptied
 * without Reset emptying every other preference in the sheet with it.
 */
function selectOf(
  setting: ContentSetting,
  options: { label: string; value: string }[],
  clearable = false
): SelectFieldConfig {
  const admin = {
    ...setting.admin,
    ...(clearable ? { isClearable: true } : {}),
  };
  return {
    name: setting.name,
    type: "select",
    ...(setting.label === undefined ? {} : { label: setting.label }),
    ...(Object.keys(admin).length === 0 ? {} : { admin }),
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
        field={selectOf(setting, collectionOptions(setting, sources))}
        mode="edit"
      />
    );
  }
  if (setting.type === "groupBy") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          // Only keys the read will group by: a field offered to filter and
          // sort may still be one it refuses as a group key.
          fields
            .filter(field => fieldFits(setting, field))
            .map(field => ({ label: labelOf(field), value: field.name })),
          true
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
          ]),
          true
        )}
        mode="edit"
      />
    );
  }
  // Keyed by the collection, so choosing another one starts the row afresh:
  // a half-built condition names a field of the collection it was begun on,
  // and nothing the form holds says so once it has written nothing.
  return (
    <FilterControl key={String(collection)} setting={setting} fields={fields} />
  );
}

/**
 * A Collection setting's choices: the collections the server sent, and its
 * own default when that names none of them. A widget may declare a default
 * that is not a collection (one meaning every collection, say); it is what
 * the card uses until the reader chooses, so it is offered by name rather
 * than left as a value the select cannot show or return to.
 */
function collectionOptions(
  setting: Extract<ContentSetting, { type: "collection" }>,
  sources: readonly PublishedContentSource[]
): { label: string; value: string }[] {
  const options = sources.map(source => ({
    label: source.label,
    value: source.collection,
  }));
  const fallback = setting.defaultValue;
  if (
    fallback === undefined ||
    fallback === "" ||
    options.some(option => option.value === fallback)
  ) {
    return options;
  }
  return [{ label: "Default", value: fallback }, ...options];
}

/** The row's type for each field, by name, for reading a stored `where`. */
function typesOf(fields: readonly Field[]) {
  return (name: string) => {
    const found = fields.find(candidate => candidate.name === name);
    return found === undefined ? undefined : conditionTypeOf(found);
  };
}

function FilterControl({
  setting,
  fields,
}: {
  setting: Extract<ContentSetting, { type: "filter" }>;
  fields: readonly Field[];
}) {
  const { field } = useController({ name: setting.name });

  // The row a person is building, kept here rather than read back from the
  // form: a condition with a field and an operator but no value yet writes no
  // `where`, so reading the row from the form would clear the field the moment
  // it was chosen. The form holds only what can be written; this holds the
  // rest of the row until it can.
  const [draft, setDraft] = useState<ConditionValue | undefined>(() =>
    whereToCondition(field.value, typesOf(fields))
  );
  // What this row last wrote, so a change made elsewhere -- a reset, another
  // collection, the sheet reopening -- is told apart from the row's own
  // writes and redraws the row from the form.
  const written = useRef<unknown>(field.value);
  useEffect(() => {
    if (sameSettingValue(field.value, written.current)) return;
    written.current = field.value;
    setDraft(whereToCondition(field.value, typesOf(fields)));
  }, [field.value, fields]);

  /**
   * Keep the row as built, and write what of it can be written: an incomplete
   * row stores nothing, so the card keeps reading every row until the
   * condition is complete.
   */
  const write = (next: ConditionValue | undefined) => {
    setDraft(next);
    const where = conditionToWhere(next) ?? "";
    written.current = where;
    field.onChange(where);
  };

  // A stored filter the one row cannot show (several conditions, or an
  // operator it has no name for) still filters the card. Said so, with a way
  // to clear it, rather than drawn as an empty row over a filter that applies.
  const unshown =
    draft === undefined &&
    typeof field.value === "object" &&
    field.value !== null &&
    Object.keys(field.value).length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {setting.label ?? setting.name}
      </span>
      {/* Drawn here as `FieldRenderer` draws it for the other settings, which
          this custom control does not go through. */}
      {setting.admin?.description === undefined ? null : (
        <p className="text-sm text-muted-foreground">
          {setting.admin.description}
        </p>
      )}
      {unshown ? (
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            This card has a filter that can&apos;t be shown here.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => write(undefined)}
          >
            Clear filter
          </Button>
        </div>
      ) : (
        <ConditionRow
          condition={draft}
          sources={fields.map(source => ({
            name: source.name,
            label: labelOf(source),
            type: conditionTypeOf(source),
            ...(source.choices === undefined
              ? {}
              : {
                  // A blank value is dropped: the select reserves the empty
                  // value for clearing, and an item carrying one throws.
                  options: source.choices
                    .filter(choice => choice.value.trim() !== "")
                    .map(choice => ({
                      value: choice.value,
                      label: choice.label,
                    })),
                }),
          }))}
          operatorsFor={filterOperatorsFor}
          onChange={write}
        />
      )}
    </div>
  );
}
