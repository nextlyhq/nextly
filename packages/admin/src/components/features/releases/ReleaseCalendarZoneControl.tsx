"use client";

/**
 * The calendar's time-zone control: which zone decides the day a release is
 * on, which day is today, and the "+N more" counts.
 *
 * Compact, and named on screen rather than only applied: two colleagues
 * comparing the page need to see they are reading the same grid. A searchable
 * list rather than a native select of four hundred zones, grouped so the
 * zones that matter are at the top: the reader's own, then the ones the
 * releases on screen were scheduled in.
 *
 * @module components/features/releases/ReleaseCalendarZoneControl
 */
import { useMemo, useState } from "react";

import { Check, ChevronDown, Globe } from "@admin/components/icons";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import {
  calendarZoneGroups,
  supportedZones,
  zoneDisplayName,
  zoneOffsetLabel,
} from "./release-calendar-zones";

export function ReleaseCalendarZoneControl({
  zone,
  readerZone,
  scheduledZones,
  at,
  onChange,
}: {
  /** The zone the calendar is drawn in. */
  zone: string;
  /** The reader's own zone, offered first. */
  readerZone: string;
  /** The zones the releases on screen were scheduled in. */
  scheduledZones: readonly string[];
  /** The instant offsets are read at: a day of the month shown. */
  at: Date;
  onChange: (zone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () =>
      calendarZoneGroups({
        reader: readerZone,
        current: zone,
        scheduled: scheduledZones,
        supported: supportedZones(),
      }),
    [readerZone, zone, scheduledZones]
  );
  // Read only while the list is open: one formatter per zone is a few hundred
  // of them, which the closed control has no reason to pay for.
  const offsets = useMemo(() => {
    if (!open) return new Map<string, string>();
    return new Map(
      groups.flatMap(group =>
        group.zones.map(z => [z, zoneOffsetLabel(z, at)] as const)
      )
    );
  }, [open, groups, at]);

  const offset = zoneOffsetLabel(zone, at);
  const isReaderZone = zone === readerZone;
  // The trigger's name is its visible text, so a speech user can say what
  // they see; whether it is their own zone is added only for a reader who
  // cannot see the grid's note saying so.

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-full gap-2 font-normal"
        >
          <Globe
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">
            <span className="text-muted-foreground">Times in </span>
            <span className="font-medium text-foreground">
              {zoneDisplayName(zone)}
            </span>
          </span>
          {isReaderZone ? (
            <span className="sr-only">, your time zone</span>
          ) : null}
          {offset ? (
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {offset}
            </span>
          ) : null}
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[22rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search time zones" />
          <CommandList className="max-h-72">
            <CommandEmpty>No time zone matches.</CommandEmpty>
            {groups.map(group => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.zones.map(choice => (
                  <CommandItem
                    key={choice}
                    // The offset is searchable too, so "GMT+5" finds Karachi.
                    value={`${choice} ${zoneDisplayName(choice)} ${offsets.get(choice) ?? ""}`}
                    onSelect={() => {
                      onChange(choice);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      aria-hidden
                      className={cn(
                        "size-4 shrink-0",
                        choice === zone ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {zoneDisplayName(choice)}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {offsets.get(choice)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
