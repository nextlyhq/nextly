"use client";

/**
 * Code Input Component
 *
 * A professional code editor input field with syntax highlighting, linting, and advanced features.
 * Uses CodeMirror 6 for a modern, extensible code editing experience.
 *
 * @module components/entries/fields/text/CodeInput
 * @since 1.0.0
 */

import type { CodeFieldConfig } from "@revnixhq/nextly/config";
import { useTheme } from "next-themes";
import {
  useCallback,
  useState,
  useEffect,
  lazy,
  Suspense,
} from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// Lazy load CodeMirror and its dependencies to avoid SSR issues with Prism
// These libraries reference browser globals that don't exist during SSR
const CodeMirrorEditor = lazy(() =>
  import("./CodeMirrorEditor").then(m => ({ default: m.CodeMirrorEditor }))
);

// ============================================================
// Types
// ============================================================

export interface CodeInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   * Used as the unique identifier for the input.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   * Provides language, editor options, and admin settings.
   */
  field: CodeFieldConfig;

  /**
   * React Hook Form control object.
   * Required for registering the field with the form.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * Disabled editors cannot be edited.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * Read-only editors can be viewed but not edited.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes for the editor container.
   */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * Loading placeholder for CodeMirror editor
 */
function CodeEditorSkeleton({ minHeight }: { minHeight: number }) {
  return (
    <div
      className="flex items-center justify-center bg-primary/5 rounded-none animate-pulse"
      style={{ minHeight: `${minHeight}px` }}
    >
      <span className="text-sm text-muted-foreground">Loading editor...</span>
    </div>
  );
}

/**
 * CodeInput provides a professional code editor with advanced features.
 *
 * Features:
 * - React Hook Form integration via useController
 * - Syntax highlighting for 20+ languages
 * - Real-time linting for JSON, XML/HTML, CSS
 * - Search and replace (Ctrl/Cmd + F)
 * - Multiple cursors (Alt/Option + Click)
 * - Auto-indentation and bracket matching
 * - Code folding
 * - Configurable editor options
 * - Theme integration with next-themes
 * - Accessibility: keyboard navigation, screen reader support
 * - Read-only and disabled states
 *
 * Supported Languages:
 * - JavaScript, TypeScript, JSX, TSX
 * - HTML, CSS, SCSS, LESS
 * - JSON, YAML, XML
 * - Python, SQL, Markdown
 * - And more (see CodeLanguage type)
 *
 * Note: This component renders only the editor element.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example
 * ```tsx
 * <FieldWrapper field={codeField} error={errors.snippet?.message}>
 *   <CodeInput
 *     name="snippet"
 *     field={codeField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example With custom editor options
 * ```tsx
 * <CodeInput
 *   name="config"
 *   field={{
 *     type: 'code',
 *     name: 'config',
 *     admin: {
 *       language: 'json',
 *       editorOptions: {
 *         lineNumbers: true,
 *         minHeight: 300,
 *         maxHeight: 600,
 *         tabSize: 2,
 *         wordWrap: true,
 *       },
 *     },
 *   }}
 *   control={control}
 * />
 * ```
 */
export function CodeInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: CodeInputProps<TFieldValues>) {
  const { theme } = useTheme();

  // SSR guard - only render CodeMirror on the client
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Get default value - handle function default values
  const defaultValue =
    typeof field.defaultValue === "function"
      ? "" // Functions are evaluated at form level, not here
      : (field.defaultValue as string) || "";

  const {
    field: { value, onChange },
    fieldState: { invalid, error },
  } = useController({
    name,
    control,
    defaultValue: defaultValue as TFieldValues[Path<TFieldValues>],
  });

  // Get editor configuration options with defaults
  const editorOptions = field.admin?.editorOptions || {};
  const language = field.admin?.language || "plaintext";
  const minHeight = editorOptions.minHeight || 200;
  const maxHeight = editorOptions.maxHeight;

  // Handle value changes
  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange]
  );

  return (
    <div
      className={cn(
        "relative rounded-none  border border-primary/5 transition-colors",
        invalid ? "border-destructive" : "border-primary/5",
        (disabled || readOnly) && "opacity-60",
        className
      )}
    >
      {/* Language indicator */}
      {language && language !== "plaintext" && (
        <div className="absolute right-2 top-2 z-10 rounded-none bg-primary/5 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {language.toUpperCase()}
        </div>
      )}

      {/* Editor - only render on client to avoid SSR issues with Prism */}
      {isMounted ? (
        <Suspense fallback={<CodeEditorSkeleton minHeight={minHeight} />}>
          <CodeMirrorEditor
            value={value ?? ""}
            onChange={handleChange}
            language={language}
            theme={theme === "dark" ? "dark" : "light"}
            disabled={disabled}
            readOnly={readOnly}
            minHeight={minHeight}
            maxHeight={maxHeight}
            editorOptions={editorOptions}
            placeholder={field.admin?.placeholder}
          />
        </Suspense>
      ) : (
        <CodeEditorSkeleton minHeight={minHeight} />
      )}

      {/* Validation error hint (shown below editor) */}
      {invalid && error?.message && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error.message}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
