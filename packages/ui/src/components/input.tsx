import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentProps } from "react";

import { cn } from "../lib/utils";

/**
 * Input Component - Design System Specification
 *
 * Text input fields for collecting user data. Supports various types (text,
 * email, password, number) and three size variants.
 *
 * Accessibility:
 * - Full keyboard navigation support
 * - Proper focus indicators (2px ring with offset)
 * - Error state support via aria-invalid
 * - Label association via htmlFor/id
 * - Placeholder text for guidance (not a replacement for labels)
 *
 * Design Specs:
 * - Height: sm=32px, default=40px, lg=44px
 * - Padding: Horizontal varies by size (sm=10px, default=12px, lg=16px)
 * - Border radius: 0px (rounded-none)
 * - Border: 1px solid, changes on focus/error
 * - Transition: 150ms (consistent with design system)
 * - Font size: sm/default=14px (text-sm), lg=16px (text-base)
 *
 * Size Variants:
 * - sm: Height 32px (h-8) - Compact forms, filters
 * - default: Height 40px (h-10) - Standard forms
 * - lg: Height 44px (h-11) - Prominent inputs, marketing forms
 *
 * Supported Types:
 * - text: General text input
 * - email: Email validation
 * - password: Hidden text input
 * - number: Numeric input with steppers
 * - tel: Phone number input
 * - url: URL validation
 * - search: Search input with clear button
 */
const inputVariants = cva(
  "file:text-foreground placeholder:text-muted-foreground placeholder:opacity-50 selection:bg-primary selection:text-primary-foreground w-full min-w-0 rounded-none border border-primary/5 bg-background text-sm transition-all duration-150 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-0 focus:ring-offset-0 focus:outline-none focus:!border-primary focus-visible:!border-primary aria-invalid:border-destructive aria-invalid:focus:!border-destructive data-[invalid=true]:border-destructive data-[invalid=true]:focus:!border-destructive",
  {
    variants: {
      size: {
        sm: "h-8 px-2.5 py-2 text-sm",
        default: "h-10 px-3 py-2.5 text-sm",
        lg: "h-11 px-4 py-3 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

export interface InputProps
  extends Omit<ComponentProps<"input">, "size">,
    VariantProps<typeof inputVariants> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(inputVariants({ size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input, inputVariants };
