import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";

const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    indeterminate?: boolean;
  }
>(({ className, indeterminate, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      // Unchecked outline uses primary/50: measured 3.95:1 on the light row and
      // 5.32:1 on the dark one. WCAG 1.4.11 asks 3:1 of a control's boundary and
      // the earlier values did not reach it — primary/40 came out at 2.85, close
      // enough to look deliberate and still short. Callers must not override the
      // border: passing `border-border` puts the divider token here, which
      // measured 1.35:1 and 1.14:1, and a divider is meant to go unnoticed.
      // Checked and indeterminate share the filled appearance; declaring both
      // here keeps the control self-sufficient without host overrides.
      //
      // The box stays 16px and the target does not: `before` stretches an
      // invisible 24px square from the centre, which is WCAG 2.5.8's floor.
      // The exemption for a bare browser checkbox does not cover a styled one,
      // and this is styled. Growing the box instead would make every dense
      // table heavier for a rule about pointers, so the box and the thing you
      // can hit are allowed to differ.
      "peer relative h-4 w-4 shrink-0 rounded-none border border-primary/50 ring-offset-background before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus:border-primary! focus-visible:border-primary! focus:outline-none focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:border-destructive! aria-invalid:focus-visible:border-destructive! disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary transition-all duration-200",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" />
      ) : (
        <Check className="h-3 w-3" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));

Checkbox.displayName = "Checkbox";

export { Checkbox };
