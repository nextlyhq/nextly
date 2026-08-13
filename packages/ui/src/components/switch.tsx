"use client";

import {
  Root as SwitchRoot,
  Thumb as SwitchThumb,
} from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

/**
 * A pill track carrying a circular thumb is how a toggle is recognised, so both
 * parts use `rounded-full` and stay outside the `--radius` scale: at any theme
 * radius the switch must still read as a switch and not as a small checkbox.
 * @public
 */
function Switch({ className, ...props }: ComponentProps<typeof SwitchRoot>) {
  return (
    <SwitchRoot
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full  border border-border transition-all outline-none focus-visible:border-primary aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive! disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary!",
        // An unchecked switch is a track and a thumb and nothing else -- no
        // label inside it, no value, no glyph -- so 1.4.11 applies to both the
        // track against the page and the thumb against the track. `bg-input`
        // cannot serve here: it is the FIELD border weight, deliberately below
        // the minimum, and at that value the pill and its thumb both vanish
        // into a light page. The control token is the same answer used for the
        // checkbox and radio boundary, for the same reason.
        "data-[state=unchecked]:bg-control-border data-[state=unchecked]:border-control-border dark:data-[state=unchecked]:bg-control-border/80",
        className
      )}
      {...props}
    >
      <SwitchThumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchRoot>
  );
}

export { Switch };
