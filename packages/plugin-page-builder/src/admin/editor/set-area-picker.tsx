"use client";

/**
 * A header & footer set's "Header" (or "Footer") picker, in its settings on
 * its own screen in the builder: a menu with pictures, like the page's
 * "Header & footer" menu. The published components marked "Use as" for the
 * area come first, then "Other components", then "None".
 *
 * Choosing writes the set form's area, so the canvas draws the choice at
 * once and the set's own Save and Publish store it, as the set's draft. The
 * pictures are read once the menu opens, so the panel never waits for them.
 *
 * @module admin/editor/set-area-picker
 */
import type { LayoutRegion, RegionArea } from "@nextlyhq/blocks-engine";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@nextlyhq/ui";
import { useMemo, useRef, useState, type JSX, type ReactNode } from "react";

import {
  MAX_SET_AREA_CHOICES,
  type SetAreaChoice,
} from "../../set-area-choices-contract";
import { OptionRow, PictureMenuPopover } from "../header-footer-menu";
import { useSetPictures } from "../header-footer-pictures";

import { useSetAreaChoices } from "./set-reads";

/** The value of the "None" row, which names no component. */
const NONE_VALUE = "none";

/** A part of the list set apart from the one above it, as a rule would. */
const PART_APART = "mt-1 border-t pt-1";

/** More choices than this, and the menu offers a search above them. */
const SEARCH_ABOVE = 10;

/** What the area is called in the panel and in its rows. */
const AREA_LABELS: Readonly<Record<RegionArea, string>> = {
  header: "Header",
  footer: "Footer",
};

export interface SetAreaPickerProps {
  readonly area: RegionArea;
  /** The trigger's id, which the field's label names. */
  readonly id: string;
  /** The component the set's area names now, or none. */
  readonly value: string | undefined;
  /** Put a component in the area, or `null` for none. */
  readonly onChoose: (component: string | null) => void;
  readonly disabled: boolean;
}

/** The regions a choice draws in its picture: one instance, or none. */
function regionsOf(
  area: RegionArea,
  component: string | undefined
): LayoutRegion[] {
  return component === undefined ? [] : [{ area, componentId: component }];
}

/** The choices split as the menu lists them. */
function groupsOf(items: readonly SetAreaChoice[]): {
  marked: SetAreaChoice[];
  others: SetAreaChoice[];
} {
  return {
    marked: items.filter(item => item.marked),
    others: items.filter(item => !item.marked),
  };
}

export function SetAreaPicker({
  area,
  id,
  value,
  onChoose,
  disabled,
}: SetAreaPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const listRoot = useRef<HTMLDivElement>(null);
  // The current choice's name and picture, without the list's pictures.
  const current = useSetAreaChoices(area, { selected: value });
  const listed = useSetAreaChoices(area, {
    selected: value,
    pictures: true,
    enabled: open,
  });
  const answer = listed.data ?? current.data;
  const picture = useSetPictures(
    { ...current.data?.meta.definitions, ...listed.data?.meta.definitions },
    listed.data !== undefined
  );
  const chosen = answer?.items.find(item => item.id === value);
  const listId = `${id}-list`;
  const label = AREA_LABELS[area];
  const groups = useMemo(() => groupsOf(answer?.items ?? []), [answer]);
  const choose = (next: string) => {
    setOpen(false);
    const component = next === NONE_VALUE ? null : next;
    if (component !== (value ?? null)) onChoose(component);
  };
  return (
    <PictureMenuPopover
      open={open}
      onOpenChange={setOpen}
      listRoot={listRoot}
      trigger={{ id, disabled, controls: listId }}
      face={
        <>
          <span className="nx-pb-hf-picture" aria-hidden="true">
            {picture(regionsOf(area, chosen?.id))}
          </span>
          <span className="truncate font-medium">
            {triggerWords(value, chosen, answer === undefined)}
          </span>
        </>
      }
    >
      <Command
        ref={listRoot}
        label={`Components to use as the ${area}`}
        defaultValue={chosen === undefined ? NONE_VALUE : rowValue(chosen)}
        className="rounded-md"
        // Filtered by name, which is what each row's value says.
        filter={(rowValue, search) =>
          rowValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
        }
      >
        {(answer?.items.length ?? 0) > SEARCH_ABOVE ? (
          <CommandInput placeholder={`Search ${area}s and components`} />
        ) : null}
        <CommandList
          id={listId}
          label={`Components to use as the ${area}`}
          className="max-h-80 p-1"
        >
          <CommandEmpty>No component matches.</CommandEmpty>
          {/* Groups, not separators, set the parts apart: a list's children
              are options and groups of them. */}
          {groups.marked.length === 0 ? null : (
            <CommandGroup>
              <ChoiceRows
                area={area}
                rows={groups.marked}
                value={value}
                picture={picture}
                onChoose={choose}
              />
            </CommandGroup>
          )}
          {groups.others.length === 0 ? null : (
            <CommandGroup
              heading="Other components"
              className={groups.marked.length === 0 ? undefined : PART_APART}
            >
              <ChoiceRows
                area={area}
                rows={groups.others}
                value={value}
                picture={picture}
                onChoose={choose}
              />
            </CommandGroup>
          )}
          <CommandGroup className={PART_APART}>
            <OptionRow
              option={{
                value: NONE_VALUE,
                label: "None",
                note: `No ${area} in this set`,
                picture: [],
              }}
              current={value === undefined}
              picture={picture([])}
              onSelect={() => choose(NONE_VALUE)}
            />
          </CommandGroup>
        </CommandList>
        <ListNote area={label} answer={answer} failed={listed.error !== null} />
      </Command>
    </PictureMenuPopover>
  );
}

/** A row's value in the list: its name, which the search matches, and id. */
function rowValue(row: SetAreaChoice): string {
  return `${row.title} ${row.id}`;
}

/** What the trigger says: the choice's name, or what stands in for it. */
function triggerWords(
  value: string | undefined,
  chosen: SetAreaChoice | undefined,
  pending: boolean
): string {
  if (value === undefined) return "None";
  if (chosen !== undefined) return chosen.title;
  // A component the author can't read published, or one still on its way.
  return pending ? "Loading…" : "A component you can't see";
}

/** The rows of one group, each with its picture and its check. */
function ChoiceRows({
  area,
  rows,
  value,
  picture,
  onChoose,
}: {
  area: RegionArea;
  rows: readonly SetAreaChoice[];
  value: string | undefined;
  picture: (regions: readonly LayoutRegion[]) => ReactNode;
  onChoose: (value: string) => void;
}): JSX.Element {
  return (
    <>
      {rows.map(row => {
        const regions = regionsOf(area, row.id);
        return (
          <OptionRow
            key={row.id}
            // Matched by name in the search; chosen by id below.
            option={{
              value: rowValue(row),
              label: row.title,
              picture: regions,
            }}
            current={row.id === value}
            picture={picture(regions)}
            onSelect={() => onChoose(row.id)}
          />
        );
      })}
    </>
  );
}

/** A line under the list: a read that failed, that it is cut, or none marked. */
function ListNote({
  area,
  answer,
  failed,
}: {
  area: string;
  answer:
    | {
        readonly items: readonly SetAreaChoice[];
        readonly meta: { readonly more: boolean };
      }
    | undefined;
  failed: boolean;
}): JSX.Element | null {
  const note = listNote(area, answer, failed);
  if (note === null) return null;
  return (
    <p className="border-t px-3 py-2 text-xs text-muted-foreground">{note}</p>
  );
}

/** The words of {@link ListNote}, or none. */
function listNote(
  area: string,
  answer:
    | {
        readonly items: readonly SetAreaChoice[];
        readonly meta: { readonly more: boolean };
      }
    | undefined,
  failed: boolean
): string | null {
  if (answer === undefined) {
    return failed
      ? "Couldn't load the components. Close this menu and open it again to try again."
      : null;
  }
  if (answer.meta.more) {
    return `Showing the first ${String(MAX_SET_AREA_CHOICES)} components by name.`;
  }
  if (!answer.items.some(item => item.marked)) {
    return `No component is marked “Use as: ${area}” yet, so every published component is listed under Other components.`;
  }
  return null;
}
