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
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-none text-sm font-medium cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] [&_svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-primary/5 hover-unified bg-background",
        secondary:
          "bg-background border border-primary/5 text-foreground hover:bg-primary/5",
        ghost: "text-foreground hover-unified",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-9 px-4 text-[13px]",
        md: "h-10 px-6 text-sm",
        lg: "h-11 px-8 text-base",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-9 w-9 p-0",
        "icon-lg": "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

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
          hasMultipleChildren && "gap-2"
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
