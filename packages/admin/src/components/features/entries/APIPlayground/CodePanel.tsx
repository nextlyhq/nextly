"use client";

/**
 * The request, as code you can take with you.
 *
 * Three flavours because there are three places this call ends up: a terminal,
 * the browser, and server code. The SDK one is the point — on a server it
 * skips HTTP entirely, so a page or route handler should use it rather than
 * fetching back into its own app.
 *
 * @module components/entries/APIPlayground/CodePanel
 */

import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@nextlyhq/ui";
import { useState, useCallback } from "react";

import { Check, Copy } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";

import type { CodeBlockLanguage } from "./CodeBlock";
import { CodeBlock } from "./CodeBlock";
import type { CodeSnippets } from "./generate-code";

const FLAVOURS: {
  value: keyof CodeSnippets;
  label: string;
  hint: string;
  language: CodeBlockLanguage;
}[] = [
  {
    value: "sdk",
    label: "Nextly",
    hint: "Server code — no HTTP round trip.",
    language: "typescript",
  },
  {
    value: "fetch",
    label: "fetch",
    hint: "The REST API, from the browser.",
    language: "javascript",
  },
  {
    value: "curl",
    label: "cURL",
    hint: "A terminal or a CI job.",
    language: "shell",
  },
];

export interface CodePanelProps {
  code: CodeSnippets;
}

export function CodePanel({ code }: CodePanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(async (key: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedKey(key);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopiedKey(null), UI.COPY_FEEDBACK_TIMEOUT_MS);
    } catch {
      toast.error("Failed to copy code");
    }
  }, []);

  return (
    // The SDK first: it is the one that belongs in the app being built, and
    // the default should be the answer rather than the fallback.
    <Tabs defaultValue="sdk" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-2">
        <TabsList className="h-7 bg-transparent p-0">
          {FLAVOURS.map(f => (
            <TabsTrigger key={f.value} value={f.value} className="text-xs">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {FLAVOURS.map(f => (
        <TabsContent
          key={f.value}
          value={f.value}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-2">
            <p className="text-xs text-muted-foreground">{f.hint}</p>
            {/* One copy button per flavour, so the snippet you are reading is
                the snippet you get. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void copy(f.value, code[f.value]);
              }}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {copiedKey === f.value ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedKey === f.value ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-t border-border bg-background">
            <CodeBlock value={code[f.value]} language={f.language} />
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
