// Why: a small, muted pill that marks a Builder field as plugin-contributed.
// Plugin fields are code-owned (they live in the plugin, not the Builder DB),
// so the Builder shows them read-only with this badge — clicking through to the
// plugin's code is how you change them. Mirrors the collection-level "managed in
// code" affordance at the field level.
//
// The `title` attribute is a portable tooltip (same pattern the width badge in
// SortableRow uses); a richer Radix tooltip can replace it later.

export function FieldSourceBadge({ owner }: { owner?: string }) {
  // "@nextlyhq/plugin-seo" -> "plugin-seo" for a compact label.
  const short = owner?.split("/").pop() ?? owner ?? "plugin";
  return (
    <span
      data-testid="field-plugin-badge"
      title={`Contributed by ${owner ?? "a plugin"} — manage it in the plugin's code.`}
      className="text-[10px] border border-border rounded-sm px-1 py-0.5 text-muted-foreground bg-muted/40"
    >
      Plugin · {short}
    </span>
  );
}
