/**
 * Props for SearchBar component
 */
export type SearchBarProps = {
  /** Current search value */
  value?: string;
  /** Callback when search value changes (debounced) */
  onChange: (value: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Debounce delay in milliseconds (default: 300ms) */
  debounceDelay?: number;
  /** Loading state indicator (shows spinner) */
  isLoading?: boolean;
  /** Optional custom className for the container */
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "type" | "size"
>;
