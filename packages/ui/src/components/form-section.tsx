import type * as React from "react";

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
  return (
    <section className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground">
          {label}
        </p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-foreground/10 px-6">{children}</div>
      </Card>
    </section>
  );
}
