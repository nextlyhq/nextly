"use client";

/**
 * API Playground Component
 *
 * Interactive API testing interface for collection endpoints.
 * Allows developers to build and execute API requests, view responses,
 * and test query parameters without leaving the admin panel.
 *
 * @module components/entries/APIPlayground/APIPlayground
 * @since 1.0.0
 */

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@nextlyhq/ui";
import { useState, useCallback, useMemo, useEffect } from "react";

import {
  Play,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  RotateCcw,
} from "@admin/components/icons";
import { UI } from "@admin/constants/ui";
import { cn } from "@admin/lib/utils";

import { QueryBuilder } from "./QueryBuilder";
import { ResponseViewer } from "./ResponseViewer";

// ============================================================================
// Types
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Available endpoint actions for collection entries */
export type EndpointAction =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "count"
  | "bulk-delete"
  | "bulk-update"
  | "duplicate";

export interface APIPlaygroundProps {
  /** Collection slug */
  collectionSlug: string;
  /** Base URL for API requests (defaults to current origin) */
  baseUrl?: string;
  /** Is this playground for a Single? */
  isSingle?: boolean;
}

export interface QueryParams {
  depth?: string;
  limit?: string;
  page?: string;
  sort?: string;
  search?: string;
  where?: string;
  select?: string;
}

export interface APIResponse {
  /** HTTP status code */
  status: number;
  /** Status text (e.g., "OK", "Not Found") */
  statusText: string;
  /** Response data */
  data: unknown;
  /** Response time in milliseconds */
  time: number;
}

// ============================================================================
// Constants
// ============================================================================

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-primary font-bold",
  POST: "text-foreground font-bold",
  PATCH: "text-muted-foreground font-bold",
  DELETE: "text-destructive font-bold",
};

/** Configuration for each endpoint action */
const ENDPOINT_ACTIONS: {
  value: EndpointAction;
  label: string;
  description: string;
  method: HttpMethod;
  requiresEntryId: boolean;
  pathSuffix?: string;
}[] = [
  {
    value: "list",
    label: "List Entries",
    description: "Get all entries with pagination",
    method: "GET",
    requiresEntryId: false,
  },
  {
    value: "get",
    label: "Get Entry",
    description: "Get a single entry by ID",
    method: "GET",
    requiresEntryId: true,
  },
  {
    value: "create",
    label: "Create Entry",
    description: "Create a new entry",
    method: "POST",
    requiresEntryId: false,
  },
  {
    value: "update",
    label: "Update Entry",
    description: "Update an existing entry",
    method: "PATCH",
    requiresEntryId: true,
  },
  {
    value: "delete",
    label: "Delete Entry",
    description: "Delete an entry by ID",
    method: "DELETE",
    requiresEntryId: true,
  },
  {
    value: "count",
    label: "Count Entries",
    description: "Get total entry count",
    method: "GET",
    requiresEntryId: false,
    pathSuffix: "/count",
  },
  {
    value: "bulk-delete",
    label: "Bulk Delete",
    description: "Delete multiple entries by IDs",
    method: "POST",
    requiresEntryId: false,
    pathSuffix: "/bulk-delete",
  },
  {
    value: "bulk-update",
    label: "Bulk Update",
    description: "Update multiple entries by IDs",
    method: "POST",
    requiresEntryId: false,
    pathSuffix: "/bulk-update",
  },
  {
    value: "duplicate",
    label: "Duplicate Entry",
    description: "Create a copy of an entry",
    method: "POST",
    requiresEntryId: true,
    pathSuffix: "/duplicate",
  },
];

// ============================================================================
// Component
// ============================================================================

/**
 * APIPlayground - Interactive API testing interface
 *
 * Provides a Postman-like interface for testing collection API endpoints
 * with support for:
 * - Structured endpoint builder with action selection
 * - Entry ID input for single-entry operations
 * - Query parameter builder
 * - Request body editor for POST/PATCH
 * - Response viewer with status, timing, and formatted JSON
 *
 * @example
 * ```tsx
 * <APIPlayground collectionSlug="posts" />
 * ```
 */
export function APIPlayground({
  collectionSlug,
  baseUrl = "",
  isSingle = false,
}: APIPlaygroundProps) {
  // Structured endpoint state
  const [action, setAction] = useState<EndpointAction>(
    isSingle ? "get" : "list"
  );
  const [entryId, setEntryId] = useState("");
  const [queryParams, setQueryParams] = useState<QueryParams>({});
  const [requestBody, setRequestBody] = useState("");

  // Response state
  const [response, setResponse] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);

  /**
   * Get the current action configuration
   */
  const currentAction = useMemo(() => {
    return (
      ENDPOINT_ACTIONS.find(a => a.value === action) ?? ENDPOINT_ACTIONS[0]
    );
  }, [action]);

  /**
   * The HTTP method is derived from the action
   */
  const method = currentAction.method;

  /**
   * Build the endpoint path from structured components
   */
  const endpointPath = useMemo(() => {
    if (isSingle) {
      return `/admin/api/singles/${collectionSlug}`;
    }

    const basePath = `/admin/api/collections/${collectionSlug}/entries`;

    // For actions that require an entry ID
    if (currentAction.requiresEntryId && entryId) {
      if (currentAction.pathSuffix) {
        // e.g., /api/collections/posts/entries/123/duplicate
        return `${basePath}/${entryId}${currentAction.pathSuffix}`;
      }
      // e.g., /api/collections/posts/entries/123
      return `${basePath}/${entryId}`;
    }

    // For actions with a path suffix but no entry ID
    if (currentAction.pathSuffix) {
      // e.g., /api/collections/posts/entries/count
      return `${basePath}${currentAction.pathSuffix}`;
    }

    // Default: just the base path
    return basePath;
  }, [collectionSlug, currentAction, entryId, isSingle]);

  /**
   * Build the full API URL from current state
   */
  const apiUrl = useMemo(() => {
    // Build query string
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value && value.trim()) {
        params.set(key, value.trim());
      }
    });

    const queryString = params.toString();
    return queryString ? `${endpointPath}?${queryString}` : endpointPath;
  }, [endpointPath, queryParams]);

  /**
   * Full URL including origin
   */
  const fullUrl = useMemo(() => {
    const origin =
      baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return `${origin}${apiUrl}`;
  }, [baseUrl, apiUrl]);

  /**
   * Generate placeholder request body based on action
   */
  const getBodyPlaceholder = useCallback(() => {
    switch (action) {
      case "create":
      case "update":
        return `{\n  "title": "Example Entry",\n  "status": "draft"\n}`;
      case "bulk-delete":
        return `{\n  "ids": ["id1", "id2", "id3"]\n}`;
      case "bulk-update":
        return `{\n  "ids": ["id1", "id2"],\n  "data": {\n    "status": "published"\n  }\n}`;
      default:
        return `{\n  "key": "value"\n}`;
    }
  }, [action]);

  /**
   * Clear entry ID when switching to an action that doesn't require it
   */
  useEffect(() => {
    if (!currentAction.requiresEntryId) {
      setEntryId("");
    }
  }, [currentAction.requiresEntryId]);

  /**
   * Execute the API request
   */
  const executeRequest = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const startTime = performance.now();

    try {
      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Include cookies for authentication
      };

      // Add body for POST/PATCH requests
      if (["POST", "PATCH"].includes(method) && requestBody.trim()) {
        try {
          // Validate JSON before sending
          JSON.parse(requestBody);
          options.body = requestBody;
        } catch {
          throw new Error("Invalid JSON in request body");
        }
      }

      const res = await fetch(fullUrl, options);
      const endTime = performance.now();

      let data: unknown;
      const contentType = res.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        data,
        time: Math.round(endTime - startTime),
      });
    } catch (err) {
      const endTime = performance.now();
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setResponse({
        status: 0,
        statusText: "Error",
        data: { error: message },
        time: Math.round(endTime - startTime),
      });
    } finally {
      setIsLoading(false);
    }
  }, [method, fullUrl, requestBody]);

  /**
   * Reset the playground to initial state
   */
  const handleReset = useCallback(() => {
    setAction(isSingle ? "get" : "list");
    setEntryId("");
    setQueryParams({});
    setRequestBody("");
    setResponse(null);
    setError(null);
  }, [isSingle]);

  /**
   * Copy URL to clipboard
   */
  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy URL");
    }
  }, [fullUrl]);

  /**
   * Open URL in new tab
   */
  const handleOpenInNewTab = useCallback(() => {
    window.open(fullUrl, "_blank", "noopener,noreferrer");
  }, [fullUrl]);

  /**
   * Colour a response by what its status class means.
   *
   * Tokens rather than palette classes, so the hues track the theme and stay
   * legible in dark mode. A 4xx is the caller's mistake and a 5xx is the
   * server's, so they read as warning and error respectively.
   */
  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return "text-success";
    if (status >= 300 && status < 400) return "text-muted-foreground";
    if (status >= 400 && status < 500) return "text-warning";
    if (status >= 500) return "text-destructive";
    return "text-muted-foreground";
  };

  /**
   * Check if the current action requires a request body
   */
  const actionRequiresBody = [
    "create",
    "update",
    "bulk-delete",
    "bulk-update",
  ].includes(action);

  /**
   * Check if entry ID is missing when required
   */
  const entryIdMissing =
    !isSingle && currentAction.requiresEntryId && !entryId.trim();

  return (
    // Fills the height it is given rather than demanding a minimum: the panes
    // below scroll on their own, so the page never grows past the panel and
    // the request's Send button and the response's status stay put.
    // Stacked on narrow screens, where two scroll panes side by side would
    // leave neither usable, so the page scrolls there instead.
    <div className="grid h-full min-h-0 grid-cols-1 gap-8 lg:grid-cols-12">
      {/* Request Builder Panel - 5 columns */}
      <Card className="lg:col-span-5 flex flex-col min-h-0 rounded-none border-border shadow-none bg-card overflow-hidden">
        <CardHeader className="p-6 pb-4" noBorder>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">
              Request configuration
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-6 px-6 pb-6">
          {/* Base Path (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Base endpoint
            </Label>
            <div className="flex items-center gap-1 px-3 py-2 bg-muted/30 border border-border rounded-none font-mono text-xs">
              <span className="text-muted-foreground">
                {isSingle ? "/admin/api/singles/" : "/admin/api/collections/"}
              </span>
              <span className="font-semibold text-foreground">
                {collectionSlug}
              </span>
              {!isSingle && (
                <span className="text-muted-foreground">/entries</span>
              )}
            </div>
          </div>

          {/* Action Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Endpoint action
            </Label>
            <Select
              value={action}
              onValueChange={v => setAction(v as EndpointAction)}
              disabled={isSingle}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENDPOINT_ACTIONS.filter(a =>
                  isSingle ? ["get", "update"].includes(a.value) : true
                ).map(a => (
                  <SelectItem key={a.value} value={a.value}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-sm ${METHOD_COLORS[a.method]}`}
                      >
                        {a.method}
                      </span>
                      <span className="text-sm">{a.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {currentAction.description}
            </p>
          </div>

          {/* Entry ID Input (conditional) */}
          {!isSingle && currentAction.requiresEntryId && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                Entry ID <span className="text-destructive">*</span>
              </Label>
              <Input
                value={entryId}
                onChange={e => setEntryId(e.target.value)}
                placeholder="Enter entry ID (e.g., abc123)"
                className="font-mono text-xs"
              />
              {entryIdMissing && (
                <p className="text-xs text-destructive">
                  Entry ID is required for this action
                </p>
              )}
            </div>
          )}

          {/* Tabs for Query Params and Body */}
          <Tabs
            defaultValue="params"
            className="flex-1 flex flex-col min-h-0 pt-2"
          >
            <TabsList className="w-full justify-start">
              <TabsTrigger value="params">Query params</TabsTrigger>
              <TabsTrigger value="body">Body</TabsTrigger>
            </TabsList>

            <TabsContent value="params" className="mt-4">
              <QueryBuilder
                params={queryParams}
                onChange={setQueryParams}
                collectionSlug={collectionSlug}
                isSingle={isSingle}
              />
            </TabsContent>

            <TabsContent value="body" className="mt-4 flex-1 min-h-0">
              <div className="space-y-2 h-full flex flex-col">
                <Label className="text-sm font-medium text-foreground">
                  Request body (JSON)
                </Label>
                <textarea
                  value={requestBody}
                  onChange={e => setRequestBody(e.target.value)}
                  className="w-full flex-1 font-mono text-xs px-3 py-2.5 border border-input rounded-none bg-background resize-none focus:outline-none focus:border-primary transition-all"
                  placeholder={getBodyPlaceholder()}
                  disabled={!actionRequiresBody}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Request URL Display */}
          <div className="pt-6 border-t border-border space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Full request URL
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted/30 px-3 py-2 border border-border rounded-none break-all font-mono">
                <span className={METHOD_COLORS[method]}>{method}</span>{" "}
                {fullUrl}
              </code>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void handleCopyUrl();
                  }}
                  className="shrink-0 h-9 w-9"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleOpenInNewTab}
                  className="shrink-0 h-9 w-9"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Execute Button */}
          <Button
            onClick={() => {
              void executeRequest();
            }}
            disabled={isLoading || entryIdMissing}
            className="w-full gap-2 h-11 text-sm font-semibold"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            {isLoading ? "Sending request..." : "Send request"}
          </Button>
        </CardContent>
      </Card>

      {/* Response Panel - 7 columns */}
      <Card className="lg:col-span-7 flex flex-col min-h-0 rounded-none border-border shadow-none bg-card overflow-hidden">
        <CardHeader className="p-6 pb-4" noBorder>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">
              API response
            </CardTitle>
            {response && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      response.status < 300 ? "bg-emerald-500" : "bg-rose-500"
                    )}
                  />
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      getStatusColor(response.status)
                    )}
                  >
                    {response.status}
                  </span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Latency</span>
                  <span className="text-foreground font-mono text-sm font-semibold">
                    {response.time}ms
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
          <ResponseViewer
            data={response?.data}
            isLoading={isLoading}
            error={error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
