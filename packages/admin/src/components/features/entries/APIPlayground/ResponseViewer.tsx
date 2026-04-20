/**
 * Response Viewer Component
 *
 * Displays API response data with formatted JSON, loading states,
 * and error handling. Includes copy functionality.
 *
 * @module components/entries/APIPlayground/ResponseViewer
 * @since 1.0.0
 */

import { Button, toast } from "@revnixhq/ui";
import { useState, useCallback, useMemo } from "react";

import { Copy, Check, Loader2, FileJson } from "@admin/components/icons";
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
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-muted/5">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30 mb-4" />
        <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground/50 animate-pulse">
          Processing Response...
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center bg-destructive/5">
        <div className="h-12 w-12 rounded-none border-2 border-destructive/20 flex items-center justify-center mb-6">
          <span className="text-destructive font-bold text-xl">!</span>
        </div>
        <h3 className="text-[clamp(0.7rem,0.65rem+0.1vw,0.75rem)] font-bold uppercase tracking-[0.15em] text-destructive mb-2">
          Request Failed
        </h3>
        <p className="text-[clamp(0.65rem,0.6rem+0.1vw,0.7rem)] text-muted-foreground font-medium max-w-xs leading-relaxed">
          {error}
        </p>
      </div>
    );
  }

  // Empty state
  if (!jsonString) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center bg-muted/5 group">
        <div className="h-16 w-16 mb-8 relative">
          <div className="absolute inset-0 border border-muted-foreground/10 translate-x-1 translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform" />
          <div className="absolute inset-0 border border-muted-foreground/20 bg-background flex items-center justify-center">
            <FileJson className="h-6 w-6 text-muted-foreground/40" />
          </div>
        </div>
        <h3 className="text-[clamp(0.7rem,0.65rem+0.1vw,0.75rem)] font-bold uppercase tracking-[0.15em] text-muted-foreground/80 mb-3">
          Response Pool
        </h3>
        <p className="text-[clamp(0.65rem,0.6rem+0.1vw,0.7rem)] text-muted-foreground/60 font-medium max-w-[200px] leading-relaxed uppercase tracking-tight">
          Select an action and execute the request to view structured response
          data
        </p>
      </div>
    );
  }

  // Response display
  return (
    <div className="h-full min-h-[400px] flex flex-col bg-background">
      {/* Action Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20">
        <span className="text-[clamp(0.6rem,0.55rem+0.1vw,0.65rem)] font-bold uppercase tracking-widest text-muted-foreground/60">
          Result Data
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-2 px-3 rounded-none text-[10px] font-bold uppercase tracking-tighter hover:bg-background/80"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {/* JSON content */}
      <div className="flex-1 overflow-auto rounded-none border-none p-0 bg-background font-mono text-xs leading-relaxed selection:bg-primary selection:text-primary-foreground">
        <JsonViewer value={jsonString} />
      </div>
    </div>
  );
}
