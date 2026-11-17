"use client";

/**
 * "Use a component ▾" on the card of a header or footer that is still the
 * site's starter: the published components marked "Use as" for that area,
 * each with its picture, and the one chosen put in the set the starter comes
 * from, so every page using that set shows it.
 *
 * Offered only to someone who may update and publish sets, as the list's
 * read says; the write itself still judges the set. The pictures are read
 * once the menu opens, so the card never waits for them, and a row whose
 * picture is still on its way shows a quiet placeholder. The rows read as
 * the page's "Header & footer" menu's do: the same row, picture and check.
 *
 * @module admin/editor/use-a-component
 */
import type { LayoutRegion, RegionArea } from "@nextlyhq/blocks-engine";
import {
  Button,
  Command,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type JSX } from "react";

import { MAX_AREA_COMPONENTS } from "../../layout-area-contract";
import { OptionRow } from "../header-footer-menu";
import { useSetPictures } from "../header-footer-pictures";
import { putComponentInArea, useAreaComponents } from "../layout-area-client";
import { useAskChoicesAgain } from "../page-layout";

/** The area as the "Use as" field labels it. */
const USE_AS: Readonly<Record<RegionArea, string>> = {
  header: "Header",
  footer: "Footer",
};

/** What a refused write says: core's own words, or a plain fallback. */
function refusalOf(error: unknown, area: RegionArea): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : `The ${area} could not be changed. Try again.`;
}

export interface UseAComponentProps {
  readonly area: RegionArea;
  /** The set the starter comes from, which the chosen component goes in. */
  readonly setId: string;
  /** The component the area shows now: the starter. */
  readonly current: string;
}

export function UseAComponent({
  area,
  setId,
  current,
}: UseAComponentProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRoot = useRef<HTMLDivElement>(null);
  const listId = useId();
  const list = useAreaComponents(area);
  const withPictures = useAreaComponents(area, {
    enabled: open,
    pictures: true,
  });
  const askChoicesAgain = useAskChoicesAgain();
  const picture = useSetPictures(
    withPictures.data?.meta.definitions ?? {},
    withPictures.data !== undefined
  );
  const answer = withPictures.data ?? list.data;
  if (answer === undefined || !answer.meta.mayChoose) return null;

  const choose = async (component: string) => {
    setOpen(false);
    if (component === current) return;
    setBusy(true);
    try {
      const written = await putComponentInArea(setId, area, component);
      toast.success(
        `${written.component.title} is now the ${area} of every page that uses the ${written.set.title} header & footer.`
      );
      askChoicesAgain();
    } catch (error) {
      toast.error(refusalOf(error, area));
    } finally {
      setBusy(false);
    }
  };

  const others = answer.items.some(item => item.id !== current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={busy}
          className="gap-1"
        >
          Use a component
          <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onOpenAutoFocus={event => {
          // Into the list, so the arrow keys move through it at once.
          event.preventDefault();
          listRoot.current?.focus();
        }}
      >
        <Command
          ref={listRoot}
          shouldFilter={false}
          label={`Components to use as the ${area}`}
          defaultValue={current}
          className="rounded-md"
        >
          <CommandList
            id={listId}
            label={`Components to use as the ${area}`}
            className="max-h-80 p-1"
          >
            {answer.items.map(item => {
              const regions: LayoutRegion[] = [{ area, componentId: item.id }];
              return (
                <OptionRow
                  key={item.id}
                  option={{
                    value: item.id,
                    label: item.title,
                    picture: regions,
                  }}
                  current={item.id === current}
                  picture={picture(regions)}
                  onSelect={() => void choose(item.id)}
                />
              );
            })}
          </CommandList>
          <MenuNote area={area} others={others} more={answer.meta.more} />
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A line under the list: how to offer another, or that the list is cut. */
function MenuNote({
  area,
  others,
  more,
}: {
  area: RegionArea;
  others: boolean;
  more: boolean;
}): JSX.Element | null {
  const note = !others
    ? `No other component is marked “Use as: ${USE_AS[area]}” yet. Mark one in Components to choose it here.`
    : more
      ? `Showing the first ${String(MAX_AREA_COMPONENTS)} by name.`
      : null;
  if (note === null) return null;
  return (
    <p className="border-t px-3 py-2 text-xs text-muted-foreground">{note}</p>
  );
}
