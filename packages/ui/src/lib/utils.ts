import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility function to merge class names with Tailwind CSS support.
 *
 * Combines clsx for conditional class names with tailwind-merge
 * to properly handle Tailwind CSS class conflicts.
 *
 * @example
 * ```typescript
 * cn('px-2 py-1', 'px-4') // => 'py-1 px-4'
 * cn('text-muted-foreground', condition && 'text-foreground')
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
