import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import type { ElementRef, ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";

/**
 * RadioGroup Component - Design System Specification
 *
 * Radio buttons allow users to select a single option from a set of mutually
 * exclusive options. They should be used when only one selection is allowed.
 *
 * Accessibility:
 * - Full keyboard navigation support (Arrow keys, Tab, Space)
 * - Proper ARIA attributes provided by Radix UI
 * - Focus indicators for keyboard users
 * - Disabled state support
 *
 * Design Specs:
 * - Size: 16px (h-4 w-4) - Fixed size matching Checkbox
 * - Border: 1px solid, expands to 5px when checked (visual indicator)
 * - Border radius: `rounded-full`. Round means "pick one" and square means
 *   "pick many"; a square radio would announce the wrong behaviour, so the
 *   shape is fixed and deliberately outside the `--radius` scale. Checkbox
 *   keeps the derived radius for the same reason.
 * - Transition: 150ms (consistent with design system)
 * - Focus ring: 2px ring with 2px offset
 *
 * Implementation Notes:
 * - Uses Radix UI primitives for robust accessibility
 * - Visual "checked" state achieved via  border border-border expansion (border-[5px])
 * - No inner indicator needed -  border border-border expansion provides clear visual feedback
 * - Hover state changes  border border-border color for better interactivity
 * @public
 */
const RadioGroup = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
      data-slot="radio-group"
    />
  );
});

RadioGroup.displayName = "RadioGroup";

/** @public */
const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="radio-group-item"
      className={cn(
        // Unchecked outline uses primary/40 (clearly visible) instead of primary/5
        // (~5% opacity, effectively invisible); hover strengthens above the resting state.
        // Resting border uses border-control-border, NOT border-input. An
        // unchecked radio is only its ring, with nothing else to identify it,
        // so it is held to 1.4.11's 3:1 -- which border-input deliberately no
        // longer meets. The checked state switches to border-primary below.
        // rounded-full is fixed rather than derived from --radius: the circle is
        // what tells the user only one option can be chosen. The thick checked
        // border leaves a background-coloured core, and because the border's
        // inner edge is curved too that core reads as a round dot.
        "peer h-4 w-4 shrink-0 rounded-full border border-control-border bg-background cursor-pointer transition-all duration-150 focus:border-primary! focus-visible:border-primary! focus:outline-none focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:border-destructive! aria-invalid:focus-visible:border-destructive! disabled:cursor-not-allowed disabled:opacity-50 hover:border-primary/70 data-[state=checked]:border-primary data-[state=checked]:border-[5px]",
        className
      )}
      {...props}
    >
      {/* The indicator carries no marker of its own: the expanded border plus
          the circular background core already render the selected dot. */}
      <RadioGroupPrimitive.Indicator className="block size-full rounded-full" />
    </RadioGroupPrimitive.Item>
  );
});

RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
