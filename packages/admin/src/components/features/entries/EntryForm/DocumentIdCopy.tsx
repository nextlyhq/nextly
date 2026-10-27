"use client";

import { Check, Copy } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useCopyToClipboard } from "@admin/hooks/useCopyToClipboard";

/**
 * Format an entry ID as `first5…last3` so the row stays a single line
 * even for long UUIDs. Returns the original string when it is short enough
 * that truncating would hide more than it reveals.
 *
 * @example
 * formatId("548e813c-8266-40c3-bd9c-ca1816f8")  // "548e8…6f8"
 * formatId("abc12345")                          // "abc12345"
 * formatId(undefined)                           // "—"
 */
export function formatId(id: string | null | undefined): string {
  if (!id) return "—";
  // Why: 9 chars or fewer fits in a single line at the rail width without
  // ellipsis, and `first5…last3` would be longer than the original at 8.
  if (id.length <= 9) return id;
  return `${id.slice(0, 5)}…${id.slice(-3)}`;
}

/**
 * A document's id, shortened, and a control that copies it whole. The rail
 * draws it on a wide screen and the meta strip wherever the rail is not, so
 * the id is offered at every width, copied the same way.
 */
export function DocumentIdCopy({ id }: { id?: string | null | undefined }) {
  // The id on screen is shortened, so a copy the browser refuses says so and
  // shows the whole id to copy by hand.
  const { copied, copy } = useCopyToClipboard(id ?? "", () =>
    toast.error("Couldn't copy the ID", { description: id ?? "" })
  );

  return (
    <>
      <span className="text-xs font-mono text-foreground" title={id ?? ""}>
        {formatId(id)}
      </span>
      {id && (
        <button
          type="button"
          onClick={copy}
          className="hover:bg-primary/5 rounded p-0.5 transition-colors"
          aria-label={copied ? "ID copied" : "Copy ID to clipboard"}
        >
          {copied ? (
            // The copied tick uses the per-mode success ink. A fixed ramp
            // step (`success-600`) is a constant darkening of the brand
            // green and lands at 4.38:1 on the dark surface, under the 4.5:1
            // text minimum; `--color-success` is defined for each mode and
            // measures 5.30:1 light, 5.29:1 dark.
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      )}
    </>
  );
}
