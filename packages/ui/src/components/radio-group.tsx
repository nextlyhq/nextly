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
 * - Border radius: Full (rounded-none)
 * - Transition: 150ms (consistent with design system)
 * - Focus ring: 2px ring with 2px offset
 *
 * Implementation Notes:
 * - Uses Radix UI primitives for robust accessibility
 * - Visual "checked" state achieved via  border border-primary/5 expansion (border-[5px])
 * - No inner indicator needed -  border border-primary/5 expansion provides clear visual feedback
 * - Hover state changes  border border-primary/5 color for better interactivity
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

const RadioGroupItem = forwardRef<
  ElementRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      data-slot="radio-group-item"
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-none border border-primary/5 bg-background cursor-pointer transition-all duration-150 focus:!border-primary focus-visible:!border-primary focus:outline-none focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:!border-destructive aria-invalid:focus-visible:!border-destructive disabled:cursor-not-allowed disabled:opacity-50 hover:border-primary/30 data-[state=checked]:border-primary data-[state=checked]:border-[5px]",
        className
      )}
      {...props}
    >
      {/* No inner indicator needed -  border border-primary/5 expansion provides visual feedback */}
      <RadioGroupPrimitive.Indicator />
    </RadioGroupPrimitive.Item>
  );
});

RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
