import { AlertCircle, Loader2, FileQuestion } from "lucide-react";

/**
 * Props for TableError component
 */
export interface TableErrorProps {
  /** Error message to display */
  message?: string;
}

/**
 * Error state component for tables
 */
export function TableError({
  message = "An error occurred. Please try again.",
}: TableErrorProps) {
  return (
    <div className="flex items-center gap-2">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Loading state component for tables
 */
export function TableLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-12 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin text-primary/80" />
      <span className="text-sm font-medium">Loading data...</span>
    </div>
  );
}

/**
 * Props for TableEmpty component
 */
export interface TableEmptyProps {
  /** Custom message to display when no data */
  message?: string;
}

/**
 * Empty state component for tables
 */
export function TableEmpty({ message = "No records found" }: TableEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-16 text-center text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-none bg-primary/5">
        <FileQuestion className="h-6 w-6" />
      </div>
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}
