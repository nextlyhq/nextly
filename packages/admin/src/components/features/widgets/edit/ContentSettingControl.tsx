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
import {
  MAX_CHOSEN_FIELDS,
  type ContentSetting,
  type PublishedContentSource,
  type SelectFieldConfig,
} from "nextly/config";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useController, useWatch } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { ConditionRow, type ConditionValue } from "@admin/components/field-ui";
import { fieldLabel } from "@admin/lib/field-label";

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
  /**
   * Whether the card can be asked of a collection, for a Collection setting:
   * a collection it could not be asked of is not offered. Absent, every
   * collection the server sent is.
   */
  offers?: (collection: string) => boolean;
}

type Field = PublishedContentSource["fields"][number];

// A field as every control names it: its declared label, or its name made readable, the way the
// card's own column headings read, so a choice reads the same in the sheet and on the card.
const labelOf = (field: Field) => fieldLabel(field);

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
  offers,
}: ContentSettingControlProps): JSX.Element {
  // The collection a dependent setting works over, as the form holds it now,
  // so its choices follow a change made in the same sheet.
  const collection = useWatch({
    name: setting.type === "collection" ? setting.name : setting.of,
  }) as unknown;
  // This setting's own value, read for a Fields setting's cap.
  const current = useWatch({ name: setting.name }) as unknown;
  const source = sources.find(candidate => candidate.collection === collection);
  const fields = source?.fields ?? [];

  if (setting.type === "collection") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          collectionOptions(
            setting,
            offers === undefined
              ? sources
              : sources.filter(candidate => offers(candidate.collection))
          )
        )}
        mode="edit"
      />
    );
  }
  if (setting.type === "groupBy" || setting.type === "field") {
    return (
      <FieldRenderer
        field={selectOf(
          setting,
          // Group by offers only keys the read will group by: a field offered
          // to filter and sort may still be one it refuses as a group key. A
          // Field setting offers every field the collection offers the reader.
          fields
            .filter(field => fieldFits(setting, field))
            .map(field => ({ label: labelOf(field), value: field.name })),
          true
        )}
        mode="edit"
      />
    );
  }
  if (setting.type === "fields") {
    const chosen = Array.isArray(current) ? current : [];
    // At the cap, only what is chosen is offered, so nothing more can be
    // added, and the description says why.
    const full = chosen.length >= MAX_CHOSEN_FIELDS;
    const declared = selectOf(
      setting,
      fields
        .filter(field => fieldFits(setting, field, source?.titleField))
        .filter(field => !full || chosen.includes(field.name))
        .map(field => ({ label: labelOf(field), value: field.name })),
      true
    );
    return (
      <FieldRenderer
        field={{
          // The fields each row shows after its title, in the order picked: from
          // the ones this reader is offered and a row can print, never the
          // title itself. Cleared, the card shows its own.
          ...declared,
          admin: {
            ...declared.admin,
            description: `Up to ${MAX_CHOSEN_FIELDS} fields, shown after the title, in the order you pick them.`,
          },
          hasMany: true,
        }}
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
          // The sheet is narrow at every screen width, so the row is laid out
          // for the sheet, not the screen: the field across the whole row,
          // where "Choose a field…" fits on one line, and the operator and
          // value side by side beneath it.
          className="grid grid-cols-2 gap-2 [&>*:first-child]:col-span-2"
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
