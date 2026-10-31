"use client";

/**
 * Choosing the time zone a time is read in, as a form field: the zone named
 * with its offset, opening the same searchable list the calendar's zone
 * control opens, with the reader's own zone first.
 *
 * A list rather than a text box, so the only zones on offer are ones the
 * platform can schedule in. A typed `Europe/Berln` is a zone nobody meant.
 *
 * @module components/features/releases/ReleaseZonePicker
 */
import type { JSX } from "react";
import { useMemo, useState } from "react";

import { ChevronDown, Globe } from "@admin/components/icons";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui";

import {
  calendarZoneGroups,
  supportedZones,
  zoneDisplayName,
  zoneOffsetLabel,
} from "./release-calendar-zones";
import { ReleaseZoneList } from "./ReleaseZoneList";

export function ReleaseZonePicker({
  id,
  labelId,
  zone,
  readerZone,
  at,
  onChange,
  describedBy,
}: {
  /** The trigger's id, for the field's label. */
  id: string;
  /** The label's id: the trigger is named by it and by the zone shown. */
  labelId: string;
  zone: string;
  /** The reader's own zone, offered first. */
  readerZone: string;
  /** The instant offsets are read at: the time being chosen. */
  at: Date;
  onChange: (zone: string) => void;
  describedBy?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () =>
      calendarZoneGroups({
        reader: readerZone,
        current: zone,
        scheduled: [],
        supported: supportedZones(),
      }),
    [readerZone, zone]
  );
  const offset = zoneOffsetLabel(zone, at);
  const valueId = `${id}-value`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-[var(--nx-control-height)] w-full justify-between gap-2 px-3 font-normal"
          aria-labelledby={`${labelId} ${valueId}`}
          {...(describedBy === undefined
            ? {}
            : { "aria-describedby": describedBy })}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Globe
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span id={valueId} className="truncate text-foreground">
              {zoneDisplayName(zone)}
              {zone === readerZone ? (
                <span className="sr-only">, your time zone</span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {offset ? (
              <span className="tabular-nums text-xs text-muted-foreground">
                {offset}
              </span>
            ) : null}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <ReleaseZoneList
          groups={groups}
          zone={zone}
          at={at}
          onSelect={choice => {
            onChange(choice);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
