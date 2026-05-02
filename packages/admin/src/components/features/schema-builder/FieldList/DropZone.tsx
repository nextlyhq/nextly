/**
 * DropZone Component
 *
 * Root-level schema drop target shown at the bottom of the field list.
 */

import * as Icons from "@admin/components/icons";

interface DropZoneProps {
  isOver: boolean;
  hasFields: boolean;
  onPlaceholderClick?: (parentFieldId?: string) => void;
}

export function DropZone({
  isOver,
  hasFields,
  onPlaceholderClick,
}: DropZoneProps) {
  if (!hasFields) return null;

  return (
    <button
      type="button"
      onClick={() => onPlaceholderClick?.()}
      className={`
        mt-4 w-full rounded-none border-2 border-dashed transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        ${
          isOver
            ? "border-primary bg-primary/15 dark:bg-primary/20"
            : "border-primary/60 dark:border-primary/40 bg-primary/[0.04] dark:bg-primary/[0.08] hover:bg-primary/[0.06] hover:border-primary cursor-pointer"
        }
      `}
      aria-label="Add field to schema"
    >
      <div className="flex flex-col items-center justify-center gap-1.5 px-5 py-5">
        <Icons.ArrowDown
          className={`h-4 w-4 shrink-0 transition-all duration-200 ${
            isOver ? "text-primary translate-y-0.5" : "text-primary/40"
          }`}
        />
        <p
          className={`text-[12px] font-medium text-center leading-tight transition-colors duration-200 ${
            isOver ? "text-primary font-semibold" : "text-primary/60"
          }`}
        >
          {isOver ? "Release to add Field" : "Add Field"}
        </p>
      </div>
    </button>
  );
}
