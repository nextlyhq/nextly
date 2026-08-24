import type * as React from "react";
import { useId } from "react";

import { cn } from "../lib/utils";

import { Card } from "./card";

/** @experimental */
export interface FormSectionProps {
  /** Short label above the card, rendered uppercase. */
  label: string;
  /** Optional sentence under the label. */
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * A labelled card holding a group of fields.
 *
 * Composes `Card` rather than hand-rolling its own border and background, so
 * a section carries the CONTAINER radius tier `Card` already defines instead
 * of a second, drifting copy of the same chrome. There is deliberately no
 * footer slot. A form commits as one document, so its action belongs to the
 * page rather than to a section.
 * @experimental
 */
export function FormSection({
  label,
  description,
  className,
  children,
}: FormSectionProps) {
  // The visible label stays a `<p>` — promoting it to a heading would pick a
  // heading LEVEL, which depends on where in the page this section lands and
  // this component has no way to know. `aria-labelledby` names the region
  // for assistive tech without making that document-structure claim.
  const labelId = useId();

  return (
    <section aria-labelledby={labelId} className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <p
          id={labelId}
          className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground"
        >
          {label}
        </p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        {/* The section owns its vertical rhythm rather than leaving each child
            to pad itself. That delegation is what produced fields flush against
            the card's borders: `SettingsRow` supplied the padding and
            `FieldShell` did not, and a card cannot see which of the two it was
            handed.

            One token serves both the card's edge padding and the gap between
            two fields, because they are the same measurement seen twice. Two
            tokens could drift apart with nothing to notice.

            The rhythm itself is a plain CSS rule shipped in the theme
            (`.nx-form-section-rows`) rather than a Tailwind utility here, so it
            compiles identically under the v3 preset this package also publishes
            and leaves no arbitrary-value token for a scanner to extract from a
            file that merely names it.

            A child must not pad itself: the two are additive, so a row carrying
            its own `py-*` doubles the rhythm on exactly the sections that were
            already correct. */}
        <div className="nx-form-section-rows divide-y divide-foreground/10 px-6">
          {children}
        </div>
      </Card>
    </section>
  );
}
