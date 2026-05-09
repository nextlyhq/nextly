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
} from "@nextlyhq/ui";
import { useState, useEffect } from "react";

import {
  ArrowRight,
  Code,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import { useEntryJSON, MAX_DEPTH } from "@admin/hooks/useEntryJSON";

import { JsonViewer } from "../APIPlayground/JsonViewer";

// ============================================================================
// Types
// ============================================================================

export interface ShowJSONDialogProps {
  /**
   * Resource scope. Determines the API URL pattern and which fetch hook
   * runs underneath. Defaults to `"collection"` for backwards compatibility
   * with the original collection-entry call sites.
   */
  scope?: "collection" | "single";
  /** Collection or Single slug. */
  collectionSlug: string;
  /** Entry ID to display. Required when `scope` is `"collection"`; ignored
   *  when `"single"` (singles are keyed only by slug). */
  entryId?: string;
  /** Custom trigger element (defaults to Code icon button) */
  trigger?: React.ReactNode;
  /** Initial depth for relationship population (default: 1).
   *  Why 1: the most useful peek shows immediate relations expanded
   *  (so a Post shows its Categories, not a list of category UUIDs).
   *  Depth 0 is intentionally not exposed in the UI dropdown — devs
   *  who want raw IDs can call the API with `?depth=0` directly. */
  initialDepth?: number;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ShowJSONDialog - Modal for viewing raw JSON API response
 *
 * Displays entry data as formatted JSON with options to:
 * - Adjust relationship population depth (1-5; depth=0 is intentionally
 *   not in the UI dropdown — see `initialDepth` prop docs)
 * - Copy JSON to clipboard
 * - Open API URL in new browser tab
 * - Crosslink to the per-collection / per-single API Playground page
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
  scope = "collection",
  collectionSlug,
  entryId,
  trigger,
  initialDepth = 1,
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
    scope,
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
    setTimeout(() => {
      void refetch();
    }, 0);
  };

  // Generate depth options 1..MAX_DEPTH. Why no 0: the dialog is a peek,
  // and a peek that hides relation contents (showing IDs only) is rarely
  // what the user wants. Devs who genuinely need depth=0 can hit the API
  // directly with `?depth=0`.
  const depthOptions = Array.from({ length: MAX_DEPTH }, (_, i) => i + 1);

  // Why: this dialog is the quick-glance view. The full per-collection /
  // per-single API Playground page lives at /admin/{collections,singles}/
  // {slug}/api and lets the user pick method, set query params/body, run
  // multiple operations, etc. Surface the link so devs who outgrew the
  // peek don't have to hunt for the playground.
  const playgroundHref =
    scope === "single"
      ? buildRoute(ROUTES.SINGLE_API, { slug: collectionSlug })
      : buildRoute(ROUTES.COLLECTION_ENTRY_API, { slug: collectionSlug });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="md">
            <Code className="h-4 w-4" />
            Show JSON
          </Button>
        )}
      </DialogTrigger>

      <DialogContent size="xl" className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>JSON Preview</DialogTitle>
          <DialogDescription className="sr-only">
            Quick peek at the JSON this entry returns over the API. For building
            or testing full requests, use the API Playground.
          </DialogDescription>
        </DialogHeader>

        {/* Controls bar */}
        <div className="flex items-center gap-4 py-2  border-b border-primary/5">
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
              size="md"
              onClick={handleOpenInNewTab}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                void handleCopy();
              }}
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
        <div className="flex-1 overflow-auto min-h-[300px] rounded-none  border border-primary/5 bg-primary/5">
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
            <JsonViewer value={jsonString} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No data available
            </div>
          )}
        </div>

        {/* Crosslink footer — graduate from the peek to the full tester. */}
        <div className="flex justify-end pt-2 text-xs text-muted-foreground">
          <Link
            href={playgroundHref}
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            Need more than a peek? Open in API Playground
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
