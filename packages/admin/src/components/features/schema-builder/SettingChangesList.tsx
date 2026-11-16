"use client";

/**
 * The entity's settings a save changes, as the save's review lists them: one
 * line each, "Name: Post → Article", in the order the settings show them.
 * Drawn by every review a save can open, so a setting changed is reviewed
 * wherever it is saved.
 */
import { type JSX, useId } from "react";

import type { SettingChange } from "@admin/lib/builder/settings-changes";

/** "drafts and publishing" → "Drafts and publishing". */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function SettingChangesList({
  changes,
}: {
  changes: readonly SettingChange[];
}): JSX.Element | null {
  const headingId = useId();
  if (changes.length === 0) return null;
  return (
    <div className="space-y-1 py-2">
      <p id={headingId} className="text-sm font-medium text-foreground">
        Settings
      </p>
      <ul aria-labelledby={headingId} className="space-y-1 text-sm">
        {changes.map(change => (
          <li key={change.key} className="text-muted-foreground">
            {/* One text, so the line reads as it is spoken. A setting with
                no value reads "none". */}
            {`${sentenceCase(change.label)}: ${change.from || "none"} → ${change.to || "none"}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
