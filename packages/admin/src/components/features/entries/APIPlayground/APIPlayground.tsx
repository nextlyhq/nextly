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
} from "@revnixhq/ui";
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
   * Get status color based on status code
   */
  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return "text-green-600";
    if (status >= 400 && status < 500) return "text-yellow-600";
    if (status >= 500) return "text-red-600";
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full min-h-[600px]">
      {/* Request Builder Panel - 5 columns */}
      <Card className="lg:col-span-5 flex flex-col rounded-none border-border shadow-none bg-card overflow-hidden">
        <CardHeader className="p-8 pb-4" noBorder>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-[11px] font-black uppercase tracking-[0.25em] text-muted-foreground/80">
                Request Configuration
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-2 h-8 px-4 rounded-none text-[10px] uppercase font-bold tracking-widest text-primary/60 hover:text-primary transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-8 px-8 pb-8">
          {/* Base Path (read-only) */}
          <div className="space-y-3 group">
            <Label className="text-[10px] uppercase font-bold tracking-widest text-primary/50 ml-1 group-hover:text-primary transition-colors">
              Base Endpoint
            </Label>
            <div className="flex items-center gap-2 p-4 bg-muted/10 border border-border/20 rounded-none font-mono text-xs transition-colors">
              <span className="text-muted-foreground">
                {isSingle ? "/admin/api/singles/" : "/admin/api/collections/"}
              </span>
              <span className="font-bold text-foreground">
                {collectionSlug}
              </span>
              {!isSingle && (
                <span className="text-muted-foreground">/entries</span>
              )}
            </div>
          </div>

          {/* Action Selector */}
          <div className="space-y-3 group">
            <Label className="text-[10px] uppercase font-bold tracking-widest text-primary/50 ml-1 group-hover:text-primary transition-colors">
              Endpoint Action
            </Label>
            <Select
              value={action}
              onValueChange={v => setAction(v as EndpointAction)}
              disabled={isSingle}
            >
              <SelectTrigger className="rounded-none border-border/40 h-12 bg-muted/5 focus:ring-2 focus:ring-primary/10 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border/60 shadow-xl">
                {ENDPOINT_ACTIONS.filter(a =>
                  isSingle ? ["get", "update"].includes(a.value) : true
                ).map(a => (
                  <SelectItem
                    key={a.value}
                    value={a.value}
                    className="rounded-none"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.5 bg-muted border border-border/50 ${METHOD_COLORS[a.method]}`}
                      >
                        {a.method}
                      </span>
                      <span className="text-xs font-medium">{a.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground ml-1 italic font-medium">
              {currentAction.description}
            </p>
          </div>

          {/* Entry ID Input (conditional) */}
          {!isSingle && currentAction.requiresEntryId && (
            <div className="space-y-3 group">
              <Label className="text-[10px] uppercase font-bold tracking-widest text-primary/50 ml-1 group-hover:text-primary transition-colors">
                Entry ID <span className="text-destructive">*</span>
              </Label>
              <Input
                value={entryId}
                onChange={e => setEntryId(e.target.value)}
                placeholder="Enter entry ID (e.g., abc123)"
                className="font-mono text-xs rounded-none border-border/40 h-12 bg-muted/5 focus-visible:ring-2 focus-visible:ring-primary/10 transition-all"
              />
              {entryIdMissing && (
                <p className="text-[10px] text-destructive font-medium ml-1">
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
            <TabsList className="bg-muted/10 border-none p-1 w-full justify-start rounded-none h-11">
              <TabsTrigger
                value="params"
                className="flex-1 rounded-none font-bold text-[10px] uppercase tracking-widest data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
              >
                Query Params
              </TabsTrigger>
              <TabsTrigger
                value="body"
                className="flex-1 rounded-none font-bold text-[10px] uppercase tracking-widest data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
              >
                Body
              </TabsTrigger>
            </TabsList>

            <TabsContent value="params" className="mt-6">
              <QueryBuilder
                params={queryParams}
                onChange={setQueryParams}
                collectionSlug={collectionSlug}
                isSingle={isSingle}
              />
            </TabsContent>

            <TabsContent value="body" className="mt-6 flex-1 min-h-0">
              <div className="space-y-4 h-full flex flex-col">
                <Label className="text-[10px] uppercase font-bold tracking-widest text-primary/50 ml-1">
                  Request Body (JSON)
                </Label>
                <textarea
                  value={requestBody}
                  onChange={e => setRequestBody(e.target.value)}
                  className="w-full flex-1 font-mono text-xs p-4 border border-border/40 rounded-none bg-muted/5 resize-none focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/5 transition-all"
                  placeholder={getBodyPlaceholder()}
                  disabled={!actionRequiresBody}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Request URL Display */}
          <div className="pt-8 border-t border-border/10">
            <Label className="text-[10px] uppercase font-bold tracking-widest text-primary/50 ml-1">
              Full Request URL
            </Label>
            <div className="flex items-center gap-2 mt-4 group">
              <code className="flex-1 text-[10px] bg-muted/10 p-4 border border-border/10 rounded-none break-all font-mono transition-colors">
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
                  className="shrink-0 h-9 w-9 rounded-none border-border/40 hover:bg-primary/5 hover:text-primary transition-all"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleOpenInNewTab}
                  className="shrink-0 h-9 w-9 rounded-none border-border/40 hover:bg-primary/5 hover:text-primary transition-all"
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
            className="w-full gap-3 h-14 rounded-none text-[11px] font-black uppercase tracking-[0.2em] active:scale-[0.98] transition-all bg-primary hover:opacity-90"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
            {isLoading ? "Sending Request..." : "Send Request"}
          </Button>
        </CardContent>
      </Card>

      {/* Response Panel - 7 columns */}
      <Card className="lg:col-span-7 flex flex-col rounded-none border-border shadow-none bg-card overflow-hidden">
        <CardHeader className="p-8 pb-4" noBorder>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-[11px] font-black uppercase tracking-[0.25em] text-muted-foreground/80">
                API Response
              </CardTitle>
            </div>
            {response && (
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-[8px] text-muted-foreground/40 font-black uppercase tracking-wider mb-1">
                    Status
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        response.status < 300 ? "bg-emerald-500" : "bg-rose-500"
                      )}
                    />
                    <span
                      className={cn(
                        "font-mono text-[11px] font-bold",
                        getStatusColor(response.status)
                      )}
                    >
                      {response.status}
                    </span>
                  </div>
                </div>
                <div className="h-8 w-px bg-border/10" />
                <div className="flex flex-col items-end">
                  <span className="text-[8px] text-muted-foreground/40 font-black uppercase tracking-wider mb-1">
                    Latency
                  </span>
                  <span className="text-foreground font-mono text-[11px] font-bold">
                    {response.time}ms
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
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
