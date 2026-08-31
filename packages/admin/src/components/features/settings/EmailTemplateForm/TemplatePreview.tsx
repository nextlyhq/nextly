"use client";

import { useMemo, useState } from "react";

import { Monitor, Moon, Smartphone, Sun } from "@admin/components/icons";

import { escapeHtmlValue } from "./interpolate";
import { Segmented } from "./Segmented";

/**
 * The preview iframe's own palette.
 *
 * An email is rendered by mail clients, which do not resolve CSS custom
 * properties, so a preview that reads the admin's tokens would show the author
 * something their recipients will never see. These are the email's colours, not
 * the admin's, which is why they are literal — and why they are named here once
 * rather than spelled out at each interpolation.
 *
 * design-lint-ok: an email cannot resolve `var(--nx-*)`; see above.
 */
export const PREVIEW_PALETTE = {
  dark: {
    text: "#e5e7eb",
    background: "#0b0b0f",
    page: "#0b0b0f",
  },
  light: {
    text: "#111827",
    background: "#ffffff",
    page: "#f3f4f6",
  },
  /** Placeholder copy shown when there is nothing to preview. */
  muted: "#9ca3af",
  /** The sample body injected into a layout row's `{{content}}` slot. */
  sample: "#71717a",
} as const;

// ============================================================
// Preview pane
// ============================================================

type PreviewDevice = "desktop" | "mobile";
type PreviewTheme = "light" | "dark";
export type PreviewFormat = "html" | "text";

export function PreviewPane({
  html,
  text,
  subject,
  format,
}: {
  html: string;
  text: string;
  subject: string;
  /** Driven by the editor tab so the preview always mirrors what's edited. */
  format: PreviewFormat;
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [theme, setTheme] = useState<PreviewTheme>("light");

  const srcDoc = useMemo(() => {
    const dark = theme === "dark";
    if (format === "text") {
      return `<!doctype html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;color:${
        dark ? PREVIEW_PALETTE.dark.text : PREVIEW_PALETTE.light.text
      };background:${
        dark
          ? PREVIEW_PALETTE.dark.background
          : PREVIEW_PALETTE.light.background
      }">${escapeHtmlValue(text || "(no plain-text content)")}</body></html>`;
    }
    const pageBg = dark
      ? PREVIEW_PALETTE.dark.page
      : PREVIEW_PALETTE.light.page;
    // A <meta color-scheme> can't drive `@media (prefers-color-scheme: dark)`
    // (that follows the OS), so rewrite the email's own dark-mode query to
    // force it on/off deterministically with the toggle. Emails without a
    // dark variant are unaffected either way.
    const darkQuery = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/gi;
    const themedHtml = (html || "").replace(
      darkQuery,
      dark
        ? "@media all"
        : "@media (prefers-color-scheme: dark) and (min-width:100000px)"
    );
    return `<!doctype html><html><head><meta name="color-scheme" content="${
      dark ? "dark" : "light"
    }"><style>html,body{margin:0}body{background:${pageBg};padding:16px}</style></head><body>${
      themedHtml ||
      `<p style='font-family:sans-serif;color:${PREVIEW_PALETTE.muted}'>Nothing to preview yet.</p>`
    }</body></html>`;
  }, [html, text, theme, format]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </span>
        <span className="rounded-sm border border-input px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
          {format === "text" ? "Plain text" : "HTML"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Segmented<PreviewDevice>
            value={device}
            onChange={setDevice}
            options={[
              {
                value: "desktop",
                icon: <Monitor className="h-3.5 w-3.5" />,
                title: "Desktop width",
              },
              {
                value: "mobile",
                icon: <Smartphone className="h-3.5 w-3.5" />,
                title: "Mobile width",
              },
            ]}
          />
          <Segmented<PreviewTheme>
            value={theme}
            onChange={setTheme}
            options={[
              {
                value: "light",
                icon: <Sun className="h-3.5 w-3.5" />,
                title: "Light client",
              },
              {
                value: "dark",
                icon: <Moon className="h-3.5 w-3.5" />,
                title: "Dark client",
              },
            ]}
          />
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Subject: </span>
        <span className="text-foreground">
          {subject || (
            <span className="italic text-muted-foreground">(no subject)</span>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/40 p-4">
        <iframe
          // Remount on format/theme change so the sandboxed srcDoc always
          // re-renders (some browsers don't reload srcDoc in place).
          key={`${format}-${theme}`}
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          // No backdrop class: srcDoc always paints its own body background for
          // the simulated mail client, so a fixed white here would only ever
          // show as a flash of the wrong color in a dark admin.
          className="h-full min-h-[420px] rounded-md border border-border"
          style={{ width: device === "mobile" ? 375 : 640, maxWidth: "100%" }}
        />
      </div>
    </div>
  );
}
