import type { ReactNode } from "react";

interface SettingsSectionProps {
  /** Short label rendered above the card. e.g. "Locale & Formatting" */
  label: string;
  /** Children are typically <SettingsRow> instances. */
  children: ReactNode;
}

/**
 * A settings section: small uppercase grey label above a thin-bordered card.
 * Rows inside are auto-divided with thin horizontal lines.
 */
export function SettingsSection({ label, children }: SettingsSectionProps) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">
        {label}
      </p>
      <div className="rounded-md border border-input bg-card overflow-hidden">
        <div className="divide-y divide-foreground/10 px-6">{children}</div>
      </div>
    </section>
  );
}
