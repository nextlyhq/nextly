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
 * Filter is a list of conditions, each a chip ("Status is Draft ✕"), joined
 * with AND and written as the query's `where`.
 */
import { Button } from "@nextlyhq/ui";
import {
  MAX_CHOSEN_FIELDS,
  type ContentSetting,
  type PublishedContentSource,
  type SelectFieldConfig,
} from "nextly/config";
import type { JSX } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useController, useWatch } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { ConditionRow, type ConditionValue } from "@admin/components/field-ui";
import { fieldLabel } from "@admin/lib/field-label";

import {
  chipText,
  conditionsToWhere,
  conditionTypeOf,
  filterOperatorsFor,
  whereToConditions,
} from "./content-filter";
import { fieldFits, sameSettingValue } from "./content-settings";
import { useReportPendingRow } from "./pending-rows";

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
 * than left as a value the select cannot show or return to. A card's quick
 * popover offers the same choices.
 */
export function collectionOptions(
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

/** The row's description of each field the reader may filter by. */
function conditionSources(fields: readonly Field[]) {
  return fields.map(source => ({
    name: source.name,
    label: labelOf(source),
    type: conditionTypeOf(source),
    ...(source.choices === undefined
      ? {}
      : {
          // A blank value is dropped: the select reserves the empty value for
          // clearing, and an item carrying one throws.
          options: source.choices
            .filter(choice => choice.value.trim() !== "")
            .map(choice => ({ value: choice.value, label: choice.label })),
        }),
  }));
}

/** What a chip says for `condition`, every name in the reader's words. */
function chipFor(condition: ConditionValue, fields: readonly Field[]): string {
  const fieldNamed = (name: string) =>
    fields.find(candidate => candidate.name === name);
  return chipText(
    condition,
    name => {
      const found = fieldNamed(name);
      return found === undefined ? name : labelOf(found);
    },
    (name, value) =>
      fieldNamed(name)?.choices?.find(choice => choice.value === value)
        ?.label ?? value
  );
}

/** Whether a condition can be written yet: a chip says only what a complete one filters on. */
function isComplete(condition: ConditionValue | undefined): boolean {
  return conditionsToWhere([condition]) !== undefined;
}

function FilterControl({
  setting,
  fields,
}: {
  setting: Extract<ContentSetting, { type: "filter" }>;
  fields: readonly Field[];
}) {
  // A row begun and not finished (added and left blank, or a field chosen and its value not yet
  // given) writes nothing, so Done would keep the card without it while the panel shows it:
  // refused instead, until it is finished or removed. Read through a ref, since the rule is asked when the form is checked.
  const unfinished = useRef(false);
  const { field, fieldState } = useController({
    name: setting.name,
    rules: {
      validate: () =>
        unfinished.current ? "Finish this filter, or remove it." : true,
    },
  });
  const labelId = useId();

  // The chips as a person is building them, kept here rather than read back from the form: a
  // condition with a field and an operator but no value yet writes no `where`, so reading the
  // list from the form would drop a chip the moment its field was chosen. The form holds only
  // what can be written; this holds the rest until it can.
  const [conditions, setConditions] = useState<(ConditionValue | undefined)[]>(
    () => whereToConditions(field.value, typesOf(fields)) ?? []
  );
  // Every row not yet complete, a row added and left blank included: each writes nothing.
  unfinished.current = conditions.some(condition => !isComplete(condition));
  // Writing nothing, the row leaves the panel's draft as it was: said to the panel, so it counts
  // the row as a change, and its Save and leave prompts ask about it rather than drop it unseen.
  useReportPendingRow(setting.name, unfinished.current);
  // The chip open for editing, by its place in the list, or none.
  const [editing, setEditing] = useState<number | undefined>(undefined);
  // What the chips last wrote, so a change made elsewhere -- a reset, another collection, the
  // panel reopening -- is told apart from their own writes and redraws them from the form.
  const written = useRef<unknown>(field.value);
  useEffect(() => {
    if (sameSettingValue(field.value, written.current)) return;
    written.current = field.value;
    setConditions(whereToConditions(field.value, typesOf(fields)) ?? []);
    setEditing(undefined);
  }, [field.value, fields]);

  /** Keep the chips as built, and write what of them can be written. */
  const write = (next: (ConditionValue | undefined)[]) => {
    setConditions(next);
    const where = conditionsToWhere(next) ?? "";
    written.current = where;
    field.onChange(where);
  };

  // A stored filter the chips cannot show (an `or`, or an operator they have no name for) still
  // filters the card. Said so, with a way to clear it, rather than drawn as no chips over a
  // filter that applies.
  const unshown = whereToConditions(field.value, typesOf(fields)) === undefined;
  const label = setting.label ?? setting.name;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      // Refused, the group says so and can take focus, so the panel can bring the reader to it.
      aria-invalid={fieldState.error === undefined ? undefined : true}
      tabIndex={fieldState.error === undefined ? undefined : -1}
      className="flex flex-col gap-1.5"
    >
      <span id={labelId} className="text-sm font-medium">
        {label}
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
            onClick={() => write([])}
          >
            Clear filter
          </Button>
        </div>
      ) : (
        <FilterChips
          conditions={conditions}
          editing={editing}
          fields={fields}
          onEdit={setEditing}
          onChange={write}
        />
      )}
      {fieldState.error?.message === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {fieldState.error.message}
        </p>
      )}
    </div>
  );
}

/**
 * The chips, the one open for editing as a condition row beneath them, and "+ Add filter". A
 * chip being built, which writes nothing yet, is drawn as its row alone.
 */
function FilterChips({
  conditions,
  editing,
  fields,
  onEdit,
  onChange,
}: {
  conditions: readonly (ConditionValue | undefined)[];
  editing: number | undefined;
  fields: readonly Field[];
  onEdit: (index: number | undefined) => void;
  onChange: (next: (ConditionValue | undefined)[]) => void;
}) {
  const open = editing === undefined ? undefined : conditions[editing];
  return (
    <>
      {conditions.some(isComplete) ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {conditions.map((condition, index) =>
            condition === undefined || !isComplete(condition) ? null : (
              <li
                key={index}
                className="inline-flex items-center rounded-full border border-border bg-muted text-sm text-foreground"
              >
                <button
                  type="button"
                  className="rounded-l-full px-2.5 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-pressed={editing === index}
                  onClick={() => onEdit(editing === index ? undefined : index)}
                >
                  {chipFor(condition, fields)}
                </button>
                <button
                  type="button"
                  aria-label={`Remove filter: ${chipFor(condition, fields)}`}
                  className="rounded-r-full px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    onEdit(undefined);
                    onChange(conditions.filter((_, at) => at !== index));
                  }}
                >
                  <span aria-hidden>✕</span>
                </button>
              </li>
            )
          )}
        </ul>
      ) : null}
      {editing === undefined ? null : (
        <ConditionRow
          // One row per chip: another chip opened starts its own row.
          key={editing}
          // The panel is narrow at every screen width, so the row is laid out for the panel, not
          // the screen: the field across the whole row, where "Choose a field…" fits on one
          // line, and the operator and value side by side beneath it.
          className="grid grid-cols-2 gap-2 [&>*:first-child]:col-span-2"
          condition={open}
          sources={conditionSources(fields)}
          operatorsFor={filterOperatorsFor}
          onChange={next =>
            onChange(
              conditions.map((condition, at) =>
                at === editing ? next : condition
              )
            )
          }
        />
      )}
      {editing === undefined || isComplete(open) ? null : (
        // A chip being built has no ✕ of its own yet, so it is removed here.
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onEdit(undefined);
              onChange(conditions.filter((_, at) => at !== editing));
            }}
          >
            Remove this filter
          </Button>
        </div>
      )}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onEdit(conditions.length);
            onChange([...conditions, undefined]);
          }}
        >
          + Add filter
        </Button>
      </div>
    </>
  );
}
