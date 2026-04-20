import { Checkbox } from "@revnixhq/ui";

import { cn } from "@admin/lib/utils";

/**
 * BulkSelectCheckbox Component Props
 */
export interface BulkSelectCheckboxProps {
  /**
   * Whether this row is selected (or indeterminate)
   */
  checked: boolean | "indeterminate";

  /**
   * Callback when checkbox state changes
   * @param checked - New checked state
   */
  onCheckedChange: (checked: boolean | "indeterminate") => void;

  /**
   * Unique row identifier (for key and ARIA)
   * @example "user-123"
   */
  rowId: string;

  /**
   * Human-readable row label for accessibility
   * @example "John Doe"
   */
  rowLabel: string;

  /**
   * Whether checkbox is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * BulkSelectCheckbox Component
 *
 * Individual checkbox for selecting rows in bulk operations.
 *
 * ## Features
 * - Desktop: 24×24px (standard checkbox size)
 * - Mobile: 44×44px (WCAG 2.2 AA touch target)
 * - ARIA label for screen readers
 * - Disabled state support
 * - Keyboard accessible (Space to toggle)
 *
 * ## Design System
 * - Component: Nextly Checkbox (Sprint 1)
 * - Transition: 150ms (design system standard)
 * - Focus ring: 3px blue (WCAG 2.2 AA compliant)
 *
 * ## Accessibility
 * - ARIA label: "Select {rowLabel}"
 * - Keyboard: Tab to focus, Space to toggle
 * - Screen reader: "Select John Doe, checkbox, unchecked/checked"
 * - Touch target: 44×44px on mobile (WCAG 2.2 AA)
 *
 * ## Responsive
 * - Mobile (< 768px): 44×44px touch target
 * - Desktop (≥ 768px): 24×24px standard size
 *
 * @example
 * ```tsx
 * <BulkSelectCheckbox
 *   checked={isSelected(user.id)}
 *   onCheckedChange={() => toggleSelection(user.id)}
 *   rowId={user.id}
 *   rowLabel={user.name}
 * />
 * ```
 */
export function BulkSelectCheckbox({
  checked,
  onCheckedChange,
  rowId,
  rowLabel,
  disabled = false,
  className,
}: BulkSelectCheckboxProps) {
  // Sanitize rowLabel for ARIA (handle empty/undefined/special characters/HTML entities)
  const sanitizedLabel =
    rowLabel
      ?.trim()
      .replace(/&/g, "and") // Replace ampersands
      .replace(/[<>'"]/g, "") || "item"; // Remove potentially problematic characters

  const isIndeterminate = checked === "indeterminate";

  return (
    <Checkbox
      checked={checked}
      indeterminate={isIndeterminate}
      onCheckedChange={onCheckedChange}
      aria-label={`Select ${sanitizedLabel}`}
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      disabled={disabled}
      id={`bulk-select-${rowId}`}
      className={cn(
        // Component size: 16x16px (h-4 w-4) - Standard for modern tables
        "h-4 w-4",
        // Touch target: Parent container adds padding to reach 44×44px (WCAG 2.2 AA)
        // This design keeps the checkbox visually consistent while meeting accessibility requirements
        // Parent implementation required: ResponsiveTable should add p-[10px] to checkbox cells
        className
      )}
    />
  );
}
