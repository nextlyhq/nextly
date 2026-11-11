/**
 * The "What search engines received" screen's own styles, on top of the SEO
 * screens' shared ones (`styles`): the page picker, the table of what each
 * crawler received beside what Nextly holds, and the differences explained.
 * Scoped to `.nx-seo` and drawn only from the admin's `--nx-*` tokens, so
 * light and dark follow.
 *
 * @module admin/received-styles
 */
import type { JSX } from "react";

const CSS = `
.nx-seo-rcv{display:grid;gap:16px;min-width:0}
.nx-seo-rcv-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nx-seo-rcv-lbl{font-size:13px;color:var(--nx-muted-foreground)}
.nx-seo-rcv-addr{flex:1 1 260px;max-width:460px;min-width:0;min-height:38px;border:1px solid var(--nx-control-border,var(--nx-input));border-radius:8px;padding:8px 11px;background:var(--nx-card);color:var(--nx-foreground);font-family:var(--seo-mono);font-size:13px;line-height:1.45}
.nx-seo-rcv-addr::placeholder{color:var(--nx-muted-foreground)}
.nx-seo-rcv-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--nx-border);border-radius:8px;background:var(--nx-card);color:var(--nx-foreground);font:inherit;font-weight:500;font-size:13px;cursor:pointer;white-space:nowrap;text-decoration:none}
.nx-seo-rcv-btn:hover:not(:disabled){background:var(--nx-accent)}
.nx-seo-rcv-btn:disabled{opacity:.45;cursor:not-allowed}
.nx-seo-rcv-btn.sm{height:28px;font-size:12px;padding:0 9px}
.nx-seo-rcv-btn svg{width:14px;height:14px;flex:none}
.nx-seo-rcv-when{font-size:13px;color:var(--nx-muted-foreground)}
.nx-seo-rcv-note{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--nx-border);background:var(--nx-muted);font-size:13px;line-height:1.45}
.nx-seo-rcv-note > svg{margin-top:1px;flex:none;color:var(--nx-muted-foreground)}
.nx-seo-rcv-note b{font-weight:600}
.nx-seo-rcv-note.ok{background:var(--nx-success-surface);border-color:var(--nx-success-border)}
.nx-seo-rcv-note.ok > svg{color:var(--nx-success-text)}
.nx-seo-rcv-note.warn{background:var(--nx-warning-surface);border-color:var(--nx-warning-border)}
.nx-seo-rcv-note.warn > svg{color:var(--nx-warning-text)}
.nx-seo-rcv-note .t{flex:1;min-width:0}
.nx-seo-rcv-note a{color:var(--nx-foreground);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.nx-seo-rcv-box{border:1px solid var(--nx-border);border-radius:10px;overflow-x:auto;background:var(--nx-card)}
.nx-seo-rcv-grid{width:100%;min-width:820px;border-collapse:collapse;table-layout:fixed}
.nx-seo-rcv-grid th,.nx-seo-rcv-grid td{border-bottom:1px solid var(--nx-border);border-right:1px solid var(--nx-border);padding:10px 12px;text-align:left;vertical-align:top;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
.nx-seo-rcv-grid th:last-child,.nx-seo-rcv-grid td:last-child{border-right:0}
.nx-seo-rcv-grid tbody tr:last-child th,.nx-seo-rcv-grid tbody tr:last-child td{border-bottom:0}
.nx-seo-rcv-grid thead th{background:var(--nx-muted);font-size:12px;font-weight:600;color:var(--nx-muted-foreground)}
.nx-seo-rcv-grid thead th b{display:block;color:var(--nx-foreground);font-size:13px}
.nx-seo-rcv-grid thead th:first-child{width:130px}
.nx-seo-rcv-grid tbody th{font-weight:600;color:var(--nx-foreground);background:var(--nx-muted)}
.nx-seo .nx-seo-rcv-grid .nx-seo-mono{font-size:12.5px}
.nx-seo-rcv-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.nx-seo-rcv-help{display:block;color:var(--nx-muted-foreground);font-size:12.5px}
.nx-seo-rcv-same{display:inline-flex;align-items:center;gap:5px;color:var(--nx-muted-foreground)}
.nx-seo-rcv-same svg{width:13px;height:13px;flex:none}
.nx-seo-rcv-diff{display:block;background:color-mix(in oklch,var(--nx-highlight) 30%,var(--nx-card));border-radius:6px;padding:6px 8px;color:var(--nx-foreground)}
.nx-seo-rcv-same + .nx-seo-rcv-diff{margin-top:6px}
.nx-seo-rcv-k{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:999px;background:var(--nx-foreground);color:var(--nx-background);font-size:11px;font-weight:700;margin-right:6px;vertical-align:1px;line-height:1}
.nx-seo-rcv-flabel{font-size:13px;font-weight:600;margin-top:4px}
.nx-seo-rcv-explain{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.nx-seo-rcv-ex{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;padding:12px 14px;border:1px solid var(--nx-border);border-radius:10px;background:var(--nx-card)}
.nx-seo-rcv-ex > .nx-seo-rcv-k{width:20px;height:20px;margin:0}
.nx-seo-rcv-ex b{font-weight:600}
.nx-seo-rcv-ex p{margin:2px 0 0;color:var(--nx-muted-foreground);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.nx-seo-rcv-ex .acts{margin-top:8px}
`;

/** The screen's styles, placed once in the document's head. */
export function ReceivedStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-received" precedence="default">
      {CSS}
    </style>
  );
}
