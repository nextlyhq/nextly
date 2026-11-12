/**
 * The bulk edit screen's own styles, on top of the SEO screens' shared ones
 * (`styles`): the table whose cells are text boxes, the bar of unsaved
 * changes, and the import panel beside the table with its field matching
 * and dry run. Scoped to `.nx-seo` and drawn only from the admin's `--nx-*`
 * tokens, so light and dark follow.
 *
 * Beside the table at a desktop width; below it from 1100px down, where the
 * table needs the room; and each row a stack of its cells on a phone.
 *
 * @module admin/bulk-styles
 */
import type { JSX } from "react";

const CSS = `
.nx-seo-bulkwrap{display:flex;align-items:stretch;margin-top:4px}
.nx-seo-bulkmain{flex:1;min-width:0;padding:20px 24px 28px}
.nx-seo-bulkside{width:380px;flex:none;border-left:1px solid var(--nx-border);padding:18px;display:grid;gap:14px;align-content:start}
.nx-seo-bulkside h2{margin:0;font-size:15px;font-weight:650}
.nx-seo-bulkside .nx-seo-lede{margin-top:-8px}
.nx-seo-bulkbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.nx-seo-bulkbar .nx-seo-select{width:200px;max-width:100%;height:30px;font-size:13px}
.nx-seo-bulkbar .nx-seo-seg button{font-size:13px}
.nx-seo-bulkcount{margin-left:auto}
.nx-seo-bulkcount code{font-family:var(--seo-mono);font-size:12px;background:var(--nx-muted);padding:1px 5px;border-radius:4px}
.nx-seo-changes{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--nx-foreground);border-radius:10px;background:var(--nx-card);margin-bottom:12px;font-size:13px;flex-wrap:wrap}
.nx-seo-changes b{font-weight:600}
.nx-seo-sheet{width:100%;border-collapse:collapse;table-layout:fixed}
.nx-seo-colpage{width:26%}
.nx-seo-coltitle{width:32%}
.nx-seo-coldesc{width:42%}
.nx-seo-sheet th{padding:8px 10px;text-align:left;font-size:12px;font-weight:600;color:var(--nx-muted-foreground);border-bottom:1px solid var(--nx-border);border-right:1px solid var(--nx-border-subtle);background:var(--nx-table-header-bg)}
.nx-seo-sheet td{border-bottom:1px solid var(--nx-border-subtle);border-right:1px solid var(--nx-border-subtle);padding:0;vertical-align:top}
.nx-seo-sheet th:last-child,.nx-seo-sheet td:last-child{border-right:0}
.nx-seo-sheet tr:last-child td{border-bottom:0}
.nx-seo-sheet .nx-seo-pg{padding:9px 10px;font-size:13px}
.nx-seo-sheet .nx-seo-pg b{font-weight:600;display:block;line-height:1.35;overflow-wrap:anywhere}
.nx-seo-sheet .nx-seo-pg .nx-seo-mono{display:block;color:var(--nx-muted-foreground);font-size:11px;overflow-wrap:anywhere}
.nx-seo-sheet .nx-seo-pg small{display:block;margin-top:4px;color:var(--nx-muted-foreground);font-size:12px}
.nx-seo-cell{position:relative}
.nx-seo-cell textarea{display:block;width:100%;border:0;background:transparent;padding:9px 10px 26px;resize:none;font:inherit;font-size:13px;line-height:1.45;min-height:64px;color:var(--nx-foreground);overflow:hidden}
.nx-seo-cell textarea::placeholder{color:var(--nx-muted-foreground);opacity:.8}
.nx-seo-cell textarea:focus{outline:2px solid var(--nx-ring);outline-offset:-2px;background:var(--nx-card)}
.nx-seo-cell textarea[readonly]{cursor:default}
.nx-seo-cell .nx-seo-cm{position:absolute;left:10px;right:10px;bottom:5px;display:flex;justify-content:space-between;font-size:11px;color:var(--nx-muted-foreground);pointer-events:none}
.nx-seo-cell .nx-seo-cm .over{color:var(--nx-warning-text);font-weight:600}
.nx-seo-cell.changed{background:var(--nx-warning-surface)}
.nx-seo-more{display:flex;justify-content:center;padding:12px}
.nx-seo-map{width:100%;border-collapse:collapse}
.nx-seo-map td{padding:6px 0;font-size:13px;vertical-align:middle;border-top:1px solid var(--nx-border-subtle)}
.nx-seo-map tr:first-child td{border-top:0}
.nx-seo-map td:first-child{font-family:var(--seo-mono);font-size:12px;width:36%;overflow-wrap:anywhere;padding-right:6px}
.nx-seo-map td:first-child .nx-seo-help{display:block;font-family:inherit;font-size:12px}
.nx-seo-map td:nth-child(2){width:22px;color:var(--nx-muted-foreground)}
.nx-seo-map .nx-seo-select{max-width:none;height:30px;font-size:13px}
.nx-seo-dry{border:1px solid var(--nx-border);border-radius:10px;padding:12px;background:var(--nx-card);display:grid;gap:8px;font-size:13px}
.nx-seo-dry .row{display:flex;justify-content:space-between;gap:10px}
.nx-seo-dry .row b{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.nx-seo-dry .nx-seo-warnline{display:flex;gap:6px;align-items:flex-start;font-weight:500}
.nx-seo-dry .nx-seo-warnline svg{flex:none;margin-top:1px}
.nx-seo-note.ok{border-color:var(--nx-success-border);background:var(--nx-success-surface)}
.nx-seo-note.ok > svg{color:var(--nx-success-text)}
.nx-seo-bulkside .nx-seo-sidebtn{justify-self:stretch}
.nx-seo-refused{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.nx-seo-refused > span{flex:1;min-width:200px}
.nx-seo-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.nx-seo-filepick{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
@media (max-width:1100px){
.nx-seo-bulkwrap{flex-direction:column}
.nx-seo-bulkside{width:auto;border-left:0;border-top:1px solid var(--nx-border);padding:18px 24px 28px}
}
@media (max-width:720px){
.nx-seo-bulkmain{padding:16px 16px 24px}
.nx-seo-bulkside{padding:16px 16px 24px}
.nx-seo-bulkcount{margin-left:0;flex-basis:100%}
.nx-seo-bulkbar .nx-seo-select{width:100%}
.nx-seo-sheet colgroup,.nx-seo-sheet thead{display:none}
.nx-seo-sheet,.nx-seo-sheet tbody,.nx-seo-sheet tr,.nx-seo-sheet td{display:block;width:100%}
.nx-seo-sheet tr{border-bottom:1px solid var(--nx-border)}
.nx-seo-sheet tr:last-child{border-bottom:0}
.nx-seo-sheet td{border-right:0}
.nx-seo-sheet td[data-label]::before{content:attr(data-label);display:block;padding:8px 10px 0;font-size:12px;font-weight:600;color:var(--nx-muted-foreground)}
}
`;

/** The bulk edit screen's styles, placed once in the document's head. */
export function BulkStyles(): JSX.Element {
  return (
    <style href="nextly-plugin-seo-bulk" precedence="default">
      {CSS}
    </style>
  );
}
