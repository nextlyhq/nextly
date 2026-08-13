"use client";

import { Button } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import { AlertCircle, Check, Copy } from "@admin/components/icons";
import { PluginIcon } from "@admin/components/shared/plugin-icon";
import { adminVersion } from "@admin/lib/admin-version";
import { categoryLabel } from "@admin/lib/plugins/plugin-categories";
import {
  PACKAGE_MANAGERS,
  adminImportStatement,
  importStatement,
  installCommand,
  pluginsArrayEntry,
  type PackageManager,
} from "@admin/lib/plugins/registry/install-command";
import type { RegistryPlugin } from "@admin/lib/plugins/registry/types";

/**
 * A copyable command line.
 *
 * The confirmation lives on the button rather than in a toast: the reader is
 * looking at the thing they clicked, and a toast in the corner asks them to
 * look somewhere else to learn that something local succeeded.
 */
function CopyLine({
  value,
  label,
  file,
}: {
  value: string;
  label: string;
  /** The file this line goes in, when it is not the one the section names. */
  file?: string;
}) {
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle");

  // The Clipboard API needs a secure context, so an admin served over plain
  // HTTP — a LAN host, a colleague's dev box — has no `navigator.clipboard` at
  // all, and `writeText` can be rejected by permissions even where it exists.
  // Both end with the reader having to select the line by hand, so both have
  // to say so: a button that silently does nothing reads as a broken page.
  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setOutcome("failed");
      return;
    }
    try {
      void clipboard.writeText(value).then(
        () => {
          setOutcome("copied");
          window.setTimeout(() => setOutcome("idle"), 2000);
        },
        () => setOutcome("failed")
      );
    } catch {
      // A synchronous throw rather than a rejection, which some
      // implementations do when the document is not focused.
      setOutcome("failed");
    }
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {file && (
          <span className="ml-1.5 font-mono font-normal opacity-80">
            {file}
          </span>
        )}
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Names the thing copied, since several of these sit on one page and
          // "Copy" alone would read identically to a screen reader each time.
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={copy}
        >
          {outcome === "copied" ? (
            <Check className="h-3.5 w-3.5" />
          ) : outcome === "failed" ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {outcome === "failed" && (
        // Announced, because the only other signal is an icon on the button
        // the reader just pressed, and the instruction matters more than the
        // failure: the line above is still there to be selected.
        <p className="mt-1.5 text-xs text-destructive" role="status">
          Could not copy to the clipboard. Select the line above and copy it
          manually.
        </p>
      )}
      {outcome === "copied" && (
        // Success is announced too, and only to assistive technology. The
        // button's `aria-label` overrides its descendants, so swapping the
        // glyph changes nothing a screen reader can perceive — sighted users
        // already have the tick, and this is the equivalent for everyone else.
        <p className="sr-only" role="status">
          {label} copied to the clipboard.
        </p>
      )}
    </div>
  );
}

/**
 * What a catalogue plugin's page shows when the project has not installed it.
 *
 * Deliberately thin, and the reason is the invariant the whole surface is
 * built on: verified content only ever appears in the verified section. Nothing
 * here has been observed running, so there is no contributions section, no
 * permissions and no routes — only what the catalogue claims, plus the lines
 * that would make the claims checkable.
 *
 * @module pages/dashboard/plugins/components/NotInstalledPlugin
 */
export function NotInstalledPlugin({
  plugin,
}: {
  plugin: RegistryPlugin;
}): React.ReactElement {
  const [manager, setManager] = useState<PackageManager>("pnpm");
  const label = categoryLabel(plugin.category);
  const adminImport = adminImportStatement(plugin);

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <PluginIcon
            plugin={{
              appearance: {
                icon: plugin.icon.lucide,
                iconAsset: plugin.icon.asset,
              },
            }}
            fallback="Package"
            className="h-6 w-6 text-muted-foreground"
          />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {plugin.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {plugin.author}
            {label ? ` · ${label}` : ""}
          </p>
        </div>
      </div>

      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        {plugin.description}
      </p>

      <section className="mb-8 space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Add it to your project</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Install the package, then make two edits in{" "}
            <code className="font-mono">nextly.config.ts</code>: import the
            plugin at the top of the file, and add it to the{" "}
            <code className="font-mono">plugins</code> array. Nextly picks it up
            on the next start.
          </p>
        </div>

        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Package manager"
        >
          {PACKAGE_MANAGERS.map(pm => (
            <Button
              key={pm}
              type="button"
              size="sm"
              variant={pm === manager ? "default" : "outline"}
              aria-pressed={pm === manager}
              onClick={() => setManager(pm)}
            >
              {pm}
            </Button>
          ))}
        </div>

        {/* One line per edit, each copyable on its own: the import and the
            array entry land in different places in the same file, so joining
            them into one block would be a snippet nobody can paste anywhere. */}
        <CopyLine
          label="Install command"
          value={installCommand(plugin.id, manager, adminVersion())}
        />
        <CopyLine label="Import statement" value={importStatement(plugin)} />
        <CopyLine
          label="Plugins array entry"
          value={pluginsArrayEntry(plugin)}
        />
        {adminImport && (
          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              This plugin also ships admin UI, which is registered by importing
              it in your admin route page. Skip it and the plugin still loads —
              its editors just fall back to plain inputs.
            </p>
            <CopyLine
              label="Admin route import"
              value={adminImport}
              file="app/admin/[[...params]]/page.tsx"
            />
          </div>
        )}
      </section>

      {/* States the boundary rather than leaving it implied: a reader looking
          for permissions and routes should learn why they are absent instead
          of concluding the plugin contributes nothing. */}
      <p className="mb-6 text-xs text-muted-foreground">
        What this plugin adds — its collections, permissions and API routes — is
        only known once it is installed and Nextly has loaded it.
      </p>

      {plugin.links && (
        <div className="flex flex-wrap gap-2">
          {plugin.links.homepage && (
            <Button asChild variant="outline" size="sm">
              <a
                href={plugin.links.homepage}
                target="_blank"
                rel="noreferrer noopener"
              >
                Homepage
              </a>
            </Button>
          )}
          {plugin.links.repository && (
            <Button asChild variant="outline" size="sm">
              <a
                href={plugin.links.repository}
                target="_blank"
                rel="noreferrer noopener"
              >
                Repository
              </a>
            </Button>
          )}
          {plugin.links.docs && (
            <Button asChild variant="outline" size="sm">
              <a
                href={plugin.links.docs}
                target="_blank"
                rel="noreferrer noopener"
              >
                Documentation
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
