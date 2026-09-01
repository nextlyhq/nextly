"use client";

import { useMemo, useRef, useState } from "react";

import { Monitor, Moon, Smartphone, Sun } from "@admin/components/icons";
import {
  previewFrameFit,
  previewFrameStyle,
  type PreviewFit,
} from "@admin/components/shared/preview/previewFrameFit";
import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";

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

/**
 * The two widths an email is actually authored against.
 *
 * The frame is these widths EDGE TO EDGE: the document inside carries no
 * horizontal padding, because a mail client's viewport does not. Padding it
 * would leave a 600px email 568px to lay out in, so a conventional fixed-width
 * 600px table would overflow the frame the toolbar labels "600px" — and the
 * breathing room around the frame belongs outside it, where it already is.
 *
 * 600 rather than a round browser width: it is the ceiling virtually every
 * HTML email is built to, because Outlook's reading pane has historically been
 * narrower than that and anything wider is clipped. 375 is the iPhone viewport
 * most mobile mail is read in. Neither is the pane's width, which is why the
 * frame is scaled to fit rather than resized — resizing it would reflow the
 * email to a width no recipient uses and preview a layout nobody receives.
 */
const DEVICE_WIDTH = { desktop: 600, mobile: 375 } as const;

type PreviewDevice = "desktop" | "mobile";
type PreviewTheme = "light" | "dark";
export type PreviewFormat = "html" | "text";

/**
 * The strip above the frame: what is being shown, at what size, and in which
 * simulated client.
 *
 * Separated from `PreviewPane` because it answers a different question. The
 * pane owns the render and the frame; this owns the reading of it, and folding
 * both into one component put the pane over the complexity gate the moment a
 * scale readout and a pending state were added to it.
 */
function PreviewToolbar({
  format,
  fit,
  isPending,
  device,
  onDeviceChange,
  theme,
  onThemeChange,
}: {
  format: PreviewFormat;
  fit: PreviewFit;
  isPending: boolean;
  device: PreviewDevice;
  onDeviceChange: (value: PreviewDevice) => void;
  theme: PreviewTheme;
  onThemeChange: (value: PreviewTheme) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Preview
      </span>
      <span className="rounded-sm border border-input px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
        {format === "text" ? "Plain text" : "HTML"}
      </span>
      {/* The width the email is being rendered AT, and — only when the pane
          cannot give it — how far it had to be shrunk to fit. Without this
          an author reads a scaled frame as the true size and mis-judges
          every type size in it. */}
      {fit.kind === "exact" || fit.kind === "scaled" ? (
        <span
          data-testid="preview-scale"
          className="font-mono text-xs text-muted-foreground"
          title={
            fit.kind === "scaled"
              ? "Too narrow to show at full size; drawn smaller."
              : "Shown at full size."
          }
        >
          {fit.width}px
          {fit.kind === "scaled" ? ` · ${Math.round(fit.scale * 100)}%` : null}
        </span>
      ) : null}
      {isPending ? (
        <span
          data-testid="preview-pending"
          className="text-xs text-muted-foreground"
        >
          Rendering…
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Segmented<PreviewDevice>
          value={device}
          onChange={onDeviceChange}
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
          onChange={onThemeChange}
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
  );
}

export function PreviewPane({
  html,
  text,
  subject,
  format,
  isPending = false,
  error = null,
}: {
  html: string;
  text: string;
  subject: string;
  /** Driven by the editor tab so the preview always mirrors what's edited. */
  format: PreviewFormat;
  /** A first render is in flight and there is no earlier one to show. */
  isPending?: boolean;
  /** The server refused or was unreachable. */
  error?: string | null;
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [theme, setTheme] = useState<PreviewTheme>("light");
  const viewport = useRef<HTMLDivElement>(null);
  const available = useMeasuredWidth(viewport);
  /*
   * Text has no device width: it is a monospace stream, not a laid-out
   * document, so scaling it to an email's column would shrink the type for no
   * gain. It fills the pane instead.
   */
  const requested = format === "text" ? null : DEVICE_WIDTH[device];
  const fit = previewFrameFit(requested, available);

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
    }"><style>html,body{margin:0}body{background:${pageBg};padding:16px 0}</style></head><body>${
      themedHtml ||
      `<p style='font-family:sans-serif;color:${PREVIEW_PALETTE.muted}'>Nothing to preview yet.</p>`
    }</body></html>`;
  }, [html, text, theme, format]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewToolbar
        format={format}
        fit={fit}
        isPending={isPending}
        device={device}
        onDeviceChange={setDevice}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Subject: </span>
        <span className="text-foreground">
          {subject || (
            <span className="italic text-muted-foreground">(no subject)</span>
          )}
        </span>
      </div>

      {/* The refusal goes ABOVE the frame rather than inside it: the frame is
          sandboxed and shows the LAST good render, so a message painted into
          it would be replaced by the stale preview it is warning about. */}
      {error !== null ? (
        <div
          data-testid="preview-error"
          role="status"
          className="shrink-0 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          Preview could not be rendered: {error}
        </div>
      ) : null}

      {/* `overflow-hidden` because a frame wider than this box is drawn inside
          it and scaled down; without clipping its untransformed corners paint
          over the border. */}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/40 p-4">
        {/* The measured box is INSIDE the padding. Measuring the padded
            element reports 32px more than the iframe can occupy, so the fit
            scales it to overrun its own container and `overflow-hidden` clips
            the right edge of the email — worst exactly when the pane is
            narrow, which is when the scaling matters. */}
        <div ref={viewport} className="h-full w-full">
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
            className="h-full w-full rounded-md border border-border"
            style={previewFrameStyle(fit)}
          />
        </div>
      </div>
    </div>
  );
}
