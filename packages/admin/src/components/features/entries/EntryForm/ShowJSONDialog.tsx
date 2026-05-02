"use client";

/**
 * Show JSON Dialog Component
 *
 * Displays the raw JSON API response for an entry with configurable
 * relationship depth. Includes copy-to-clipboard and open-in-new-tab
 * functionality for developer convenience.
 *
 * @module components/entries/EntryForm/ShowJSONDialog
 * @since 1.0.0
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@revnixhq/ui";
import { useState, useEffect } from "react";

import {
  Code,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { useEntryJSON, MAX_DEPTH } from "@admin/hooks/useEntryJSON";

// ============================================================================
// Types
// ============================================================================

export interface ShowJSONDialogProps {
  /** Collection slug */
  collectionSlug: string;
  /** Entry ID to display */
  entryId: string;
  /** Custom trigger element (defaults to Code icon button) */
  trigger?: React.ReactNode;
  /** Initial depth for relationship population (default: 0) */
  initialDepth?: number;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ShowJSONDialog - Modal for viewing raw JSON API response
 *
 * Displays entry data as formatted JSON with options to:
 * - Adjust relationship population depth (0-5)
 * - Copy JSON to clipboard
 * - Open API URL in new browser tab
 *
 * JSON inspection dialog for developer use.
 *
 * @example
 * ```tsx
 * // In entry form header dropdown
 * <ShowJSONDialog
 *   collectionSlug="posts"
 *   entryId={entry.id}
 * />
 *
 * // With custom trigger
 * <ShowJSONDialog
 *   collectionSlug="posts"
 *   entryId={entry.id}
 *   trigger={<Button>View JSON</Button>}
 * />
 * ```
 */
export function ShowJSONDialog({
  collectionSlug,
  entryId,
  trigger,
  initialDepth = 0,
}: ShowJSONDialogProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    data,
    isLoading,
    error,
    depth,
    setDepth,
    refetch,
    apiUrl,
    jsonString,
  } = useEntryJSON({
    collectionSlug,
    entryId,
    initialDepth,
    fetchOnMount: false,
  });

  // Fetch data when dialog opens
  useEffect(() => {
    if (open && !data && !isLoading && !error) {
      void refetch();
    }
  }, [open, data, isLoading, error, refetch]);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(
        () => setCopied(false),
        UI.COPY_FEEDBACK_TIMEOUT_MS
      );
      return () => clearTimeout(timer);
    }
  }, [copied]);

  /**
   * Copy JSON to clipboard
   */
  const handleCopy = async () => {
    if (!jsonString) return;

    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      toast.success("Copied to clipboard!");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  /**
   * Open API URL in new browser tab
   */
  const handleOpenInNewTab = () => {
    // Build full URL from current origin
    const fullUrl = `${window.location.origin}${apiUrl}`;
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  };

  /**
   * Handle depth change
   */
  const handleDepthChange = (value: string) => {
    const newDepth = parseInt(value, 10);
    setDepth(newDepth);
    // Refetch with new depth
    setTimeout(() => { void refetch(); }, 0);
  };

  // Generate depth options (0 to MAX_DEPTH)
  const depthOptions = Array.from({ length: MAX_DEPTH + 1 }, (_, i) => i);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="gap-2">
            <Code className="h-4 w-4" />
            Show JSON
          </Button>
        )}
      </DialogTrigger>

      <DialogContent size="xl" className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>API Response</DialogTitle>
          <DialogDescription className="sr-only">
            View the raw JSON API response for this entry
          </DialogDescription>
        </DialogHeader>

        {/* Controls bar */}
        <div className="flex items-center gap-4 py-2 border-b border-border">
          {/* Depth selector */}
          <div className="flex items-center gap-2">
            <Label htmlFor="json-depth" className="text-sm font-medium">
              Depth:
            </Label>
            <Select value={depth.toString()} onValueChange={handleDepthChange}>
              <SelectTrigger id="json-depth" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {depthOptions.map(d => (
                  <SelectItem key={d} value={d.toString()}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API URL display */}
          <code className="flex-1 text-xs text-muted-foreground truncate font-mono bg-primary/5 px-2 py-1 rounded-none">
            GET {apiUrl}
          </code>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInNewTab}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleCopy(); }}
              disabled={!jsonString || isLoading}
              className="gap-2"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        {/* JSON content area */}
        <div className="flex-1 overflow-auto min-h-[300px] rounded-none border border-border bg-primary/5">
          {isLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : jsonString ? (
            <pre className="p-4 text-sm font-mono whitespace-pre overflow-x-auto text-foreground">
              {jsonString}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No data available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
