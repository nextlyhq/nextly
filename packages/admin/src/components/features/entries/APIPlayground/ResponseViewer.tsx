"use client";

/**
 * Response Viewer Component
 *
 * Displays API response data with formatted JSON, loading states,
 * and error handling. Includes copy functionality.
 *
 * @module components/entries/APIPlayground/ResponseViewer
 * @since 1.0.0
 */

import { Button, toast } from "@nextlyhq/ui";
import { useState, useCallback, useMemo } from "react";

import {
  Copy,
  Check,
  Loader2,
  FileJson,
  AlertCircle,
} from "@admin/components/icons";
import { UI } from "@admin/constants/ui";

import { JsonViewer } from "./JsonViewer";

// ============================================================================
// Types
// ============================================================================

export interface ResponseViewerProps {
  /** Response data to display */
  data: unknown;
  /** Whether the request is loading */
  isLoading?: boolean;
  /** Error message if request failed */
  error?: string | null;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ResponseViewer - Formatted JSON response display
 *
 * Displays API response data with:
 * - Loading spinner during requests
 * - Error display for failed requests
 * - Formatted JSON with proper indentation
 * - Copy to clipboard functionality
 *
 * @example
 * ```tsx
 * <ResponseViewer
 *   data={response?.data}
 *   isLoading={isLoading}
 *   error={error}
 * />
 * ```
 */
export function ResponseViewer({
  data,
  isLoading = false,
  error = null,
}: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);

  /**
   * Format data as JSON string
   */
  const jsonString = useMemo(() => {
    if (data === undefined || data === null) return "";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(data);
    }
  }, [data]);

  /**
   * Copy JSON to clipboard
   */
  const handleCopy = useCallback(async () => {
    if (!jsonString) return;

    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      toast.success("Response copied to clipboard");
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy response");
    }
  }, [jsonString]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60 mb-4" />
        <p className="text-sm text-muted-foreground">Sending request…</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-center bg-destructive/5">
        <div className="h-12 w-12 rounded-none bg-destructive/10 flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <h3 className="text-base font-semibold text-destructive mb-2">
          Request failed
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          {error}
        </p>
      </div>
    );
  }

  // Empty state
  if (!jsonString) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-center bg-muted/30">
        <div className="h-14 w-14 mb-4 rounded-none bg-card border border-border flex items-center justify-center">
          <FileJson className="h-6 w-6 text-muted-foreground/60" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-foreground mb-1">
          No response yet
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          Select an action and execute the request to see the structured
          response here.
        </p>
      </div>
    );
  }

  // Response display
  return (
    <div className="h-full min-h-[400px] flex flex-col bg-card">
      {/* Action Header */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-muted/30">
        <span className="text-sm font-medium text-foreground">
          Structured result
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void handleCopy();
          }}
          className="gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>

      {/* JSON content */}
      <div className="flex-1 overflow-auto rounded-none border-none p-0 bg-background font-mono text-xs leading-relaxed selection:bg-primary selection:text-primary-foreground">
        <JsonViewer value={jsonString} />
      </div>
    </div>
  );
}
