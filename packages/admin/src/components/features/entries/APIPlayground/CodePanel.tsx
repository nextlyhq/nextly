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

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";

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
  /**
   * Which flavour is open.
   *
   * Controlled by the response pane rather than held here, because its toolbar
   * has to copy the snippet being READ. A panel owning this privately meant the
   * only control that knew which flavour was open was the one that could not
   * reach the clipboard button.
   */
  flavour: keyof CodeSnippets;
  onFlavourChange: (flavour: keyof CodeSnippets) => void;
}

export function CodePanel({ code, flavour, onFlavourChange }: CodePanelProps) {
  return (
    <Tabs
      value={flavour}
      onValueChange={value => onFlavourChange(value as keyof CodeSnippets)}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-2">
        <TabsList variant="ghost">
          {FLAVOURS.map(f => (
            <TabsTrigger key={f.value} value={f.value} size="sm">
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
          {/* The copy control lives in the pane's toolbar, which now knows
              which flavour is open. Two buttons a few pixels apart, one of them
              copying something else, is worse than one. */}
          <div className="flex shrink-0 items-center gap-4 px-6 pb-2">
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-t border-border bg-code-bg">
            <CodeBlock value={code[f.value]} language={f.language} />
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
