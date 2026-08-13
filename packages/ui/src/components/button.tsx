import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import * as React from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import type { ButtonProps } from "../types/button";

/**
 * Button Component - Design System Specification
 *
 * Interactive button element for user actions. Supports multiple variants,
 * sizes, and the asChild pattern for composition.
 *
 * Variants:
 * - default/primary: Primary action button (blue background, white text)
 * - secondary: Secondary action button (gray background)
 * - destructive: Destructive action button (red background)
 * - outline: Outlined button (transparent background, border)
 * - ghost: Minimal button (transparent, no border)
 * - link: Link-style button (underlined text)
 *
 * Note: 'primary' is a semantic alias for 'default' variant for better code readability
 * @experimental
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] [&_svg]:text-current",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-transparent hover:opacity-90",
        primary:
          "bg-primary text-primary-foreground border border-transparent hover:opacity-90",
        // Solid fill uses the emphasis token so on-color text stays AA in dark
        // mode (the base token is the readable text color, too light here).
        // Hover darkens to a deeper shade rather than opacity-90, which would
        // composite the fill toward the page and drop the label under 4.5:1.
        // One step, not two: the label is white in light mode and black in
        // dark, so mixing the fill toward black moves it away from the label in
        // one mode and into it in the other. `-600` clears both (5.92:1 light,
        // 5.67:1 dark); `-700` reads at 3.70:1 against the dark label.
        destructive:
          "bg-destructive-solid text-destructive-foreground border border-transparent hover:bg-destructive-600",
        // border-border is the decorative separator token, and it is the right
        // one here: a button is identified by its label and fill, so its edge
        // carries no meaning on its own, unlike border-input, which is the
        // token for controls identified by their boundary (that token is now
        // below 1.4.11's 3:1 in light mode; see contrast/accepted.ts). It is
        // still used in preference to a faint primary alpha, which reads as a
        // tint of the brand colour rather than as an edge.
        outline:
          "border border-border text-foreground hover-unified bg-background",
        secondary:
          "bg-background border border-border text-foreground hover:bg-primary/5",
        ghost: "text-foreground border border-transparent hover-unified",
        link: "text-primary border border-transparent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--nx-control-height)] px-6 py-2",
        sm: "h-[var(--nx-control-height-md)] px-4 text-sm",
        md: "h-[var(--nx-control-height)] px-6 text-sm",
        lg: "h-[var(--nx-control-height-lg)] px-8 text-base",
        icon: "h-[var(--nx-control-height)] w-[var(--nx-control-height)] p-0",
        "icon-sm":
          "h-[var(--nx-control-height-md)] w-[var(--nx-control-height-md)] p-0",
        "icon-lg":
          "h-[var(--nx-control-height-lg)] w-[var(--nx-control-height-lg)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

/** @public */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    // Automatically apply gap-2 if there are multiple children (e.g., icon + text)
    const hasMultipleChildren = React.Children.count(children) > 1;

    return (
      <Comp
        data-slot={`button.${variant}`}
        className={cn(
          buttonVariants({ variant, size, className }),
          hasMultipleChildren && "gap-1.5"
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
