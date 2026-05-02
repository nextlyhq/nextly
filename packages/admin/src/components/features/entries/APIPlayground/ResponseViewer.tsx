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

import { Button, toast } from "@revnixhq/ui";
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
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-primary/5">
        <div className="relative mb-6">
          <Loader2 className="h-10 w-10 animate-spin text-primary/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-none bg-primary animate-pulse" />
          </div>
        </div>
        <p className="text-[10px] uppercase font-black tracking-[0.3em] text-primary/40 animate-pulse">
          Processing...
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-center bg-rose-500/2">
        <div className="h-14 w-14 rounded-none bg-rose-500/10 flex items-center justify-center mb-6">
          <AlertCircle className="h-6 w-6 text-rose-500" />
        </div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-500/80 mb-3">
          Request Failed
        </h3>
        <p className="text-xs text-muted-foreground/60 font-medium max-w-xs leading-relaxed">
          {error}
        </p>
      </div>
    );
  }

  // Empty state
  if (!jsonString) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-center bg-primary/5 group">
        <div className="h-20 w-20 mb-10 relative">
          <div className="absolute inset-0 bg-primary/5 rounded-none scale-90 blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
          <div className="absolute inset-0 bg-card border border-border/40 rounded-none flex items-center justify-center shadow-none group-hover:-translate-y-1 transition-transform duration-500">
            <FileJson className="h-8 w-8 text-primary/30 group-hover:text-primary/60 transition-colors" />
          </div>
        </div>
        <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-muted-foreground/80 mb-4">
          Response Pool
        </h3>
        <p className="text-[10px] text-muted-foreground/40 font-black max-w-[240px] leading-loose uppercase tracking-[0.1em]">
          Select an action and execute the request to view structured response
          data
        </p>
      </div>
    );
  }

  // Response display
  return (
    <div className="h-full min-h-[400px] flex flex-col bg-card">
      {/* Action Header */}
      <div className="flex items-center justify-between px-8 py-3 border-b border-border/10 bg-primary/5">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/40">
          Structured Result
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void handleCopy();
          }}
          className="h-8 gap-2 px-4 rounded-none text-[10px] font-bold uppercase tracking-widest text-primary/60 hover:text-primary transition-all"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
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
