"use client";

/**
 * The card as the settings sheet's values would draw it, beside the form: the same renderer the
 * dashboard uses, so what the reader sees is what Done keeps. Shown, not used: its links and
 * controls are out of reach, since the card they would act on is the one behind the sheet.
 *
 * @module components/features/widgets/edit/SettingsPreview
 */

import type { JSX } from "react";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { WidgetRenderer } from "../WidgetRenderer";

import { fenceOff } from "./CustomizingFence";
import { useSettingsPreview, type ShownAnswer } from "./useSettingsPreview";

export function SettingsPreview(props: {
  /** The widget as declared, before any settings apply. */
  widget: DashboardWidget;
  placementId: string;
  stored: Record<string, unknown> | undefined;
  /** The sheet's current values, as `toStoredConfig` builds them. */
  draft: Record<string, unknown>;
  shown: ShownAnswer;
}): JSX.Element {
  const preview = useSettingsPreview(props);
  return (
    <section
      aria-label={`Preview of ${props.widget.title}`}
      className="flex flex-col gap-2"
    >
      <p className="text-xs font-medium text-muted-foreground">Preview</p>
      <div ref={fenceOff} data-testid="settings-preview">
        <WidgetRenderer
          definition={preview.definition}
          placement={preview.placement}
          slot={preview.slot}
          {...(preview.slotFor === undefined
            ? {}
            : { slotFor: preview.slotFor })}
          subtitle={preview.subtitle}
          isFetching={preview.isFetching}
          {...(preview.answerSize === undefined
            ? {}
            : { answerSize: preview.answerSize })}
        />
      </div>
    </section>
  );
}
