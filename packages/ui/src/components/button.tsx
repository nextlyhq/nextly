import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
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
  "inline-flex items-center justify-center whitespace-nowrap rounded-none text-sm font-medium cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-input hover-unified",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover-unified",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-sm rounded-none",
        md: "h-10 px-4 py-2 text-base rounded-none",
        lg: "h-11 px-5 py-2.5 text-base rounded-none",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-8 w-8 p-0",
        "icon-lg": "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot={`button.${variant}`}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
