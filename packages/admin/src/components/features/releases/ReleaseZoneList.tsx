"use client";

/**
 * The searchable list of time zones, grouped as `calendarZoneGroups` groups
 * them, each with its offset on the day that matters.
 *
 * Shared by the calendar's zone control and the schedule dialog's zone
 * picker, so a zone is found, named and offset the same way wherever one is
 * chosen. Drawn only while its popover is open, so the few hundred offset
 * readings are paid for only then.
 *
 * @module components/features/releases/ReleaseZoneList
 */
import type { JSX } from "react";
import { useMemo } from "react";

import { Check } from "@admin/components/icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import {
  zoneDisplayName,
  zoneOffsetLabel,
  type CalendarZoneGroup,
} from "./release-calendar-zones";

export function ReleaseZoneList({
  groups,
  zone,
  at,
  onSelect,
}: {
  groups: readonly CalendarZoneGroup[];
  /** The zone chosen now, which carries the check. */
  zone: string;
  /** The instant offsets are read at. */
  at: Date;
  onSelect: (zone: string) => void;
}): JSX.Element {
  const offsets = useMemo(
    () =>
      new Map(
        groups.flatMap(group =>
          group.zones.map(z => [z, zoneOffsetLabel(z, at)] as const)
        )
      ),
    [groups, at]
  );
  return (
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
                onSelect={() => onSelect(choice)}
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
  );
}
