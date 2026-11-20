"use client";

/**
 * Each stage's label and colour, shown over the code's: what the code names
 * it, a label, a colour from the palette, Save, and Reset back to the code.
 *
 * A label left empty, or the code's own, is saved as no label of its own, so
 * the code's label shows and follows the code. Reset clears both label and
 * colour, and is offered only while either differs from the code. A row's
 * edits stay on screen until saved, through a save that meets settings
 * changed meanwhile.
 */

import { Button, Input } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import { cn } from "@admin/lib/utils";
import type {
  WorkflowSettingsPatch,
  WorkflowSettingsView,
  WorkflowStageSummary,
  WorkflowSummary,
} from "@admin/types/workflows";

import { NEUTRAL_SWATCH, STAGE_SWATCHES, stageColourOf } from "./stage-colours";
import { StagePill } from "./StagePill";
import { labelDiffersFromCode } from "./workflow-settings-model";

export interface StageLabelsSectionProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  canChange: boolean;
  /** The field being saved (`labels.<stage>`), or null. */
  saving: string | null;
  errors: Record<string, string>;
  onSave: (
    stage: string,
    patch: NonNullable<WorkflowSettingsPatch["labels"]>[string]
  ) => Promise<boolean>;
}

/** A row's edits: the label typed and the colour chosen ("" for none). */
interface Draft {
  label: string;
  colour: string;
}

/** The colour as the row's picker names it: the stored value, or "" for none. */
const colourKey = (colour: string | undefined): string =>
  colour === undefined ? "" : colour.toLowerCase();

export function StageLabelsSection({
  workflow,
  settings,
  canChange,
  saving,
  errors,
  onSave,
}: StageLabelsSectionProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const clearDraft = (stage: string) =>
    setDrafts(current =>
      Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== stage)
      )
    );

  return (
    <div className="divide-y divide-border">
      {workflow.stages.map(stage => (
        <StageLabelRow
          key={stage.name}
          stage={stage}
          settings={settings}
          draft={drafts[stage.name]}
          canChange={canChange}
          saving={saving === `labels.${stage.name}`}
          error={errors[`labels.${stage.name}`]}
          onDraft={draft =>
            setDrafts(current => ({ ...current, [stage.name]: draft }))
          }
          onSave={patch =>
            onSave(stage.name, patch).then(saved => {
              if (saved) clearDraft(stage.name);
              return saved;
            })
          }
        />
      ))}
    </div>
  );
}

interface StageLabelRowProps {
  stage: WorkflowStageSummary;
  settings: WorkflowSettingsView;
  draft: Draft | undefined;
  canChange: boolean;
  saving: boolean;
  error: string | undefined;
  onDraft: (draft: Draft) => void;
  onSave: (
    patch: NonNullable<WorkflowSettingsPatch["labels"]>[string]
  ) => Promise<boolean>;
}

function StageLabelRow({
  stage,
  settings,
  draft,
  canChange,
  saving,
  error,
  onDraft,
  onSave,
}: StageLabelRowProps): React.JSX.Element {
  const set = settings.labels[stage.name];
  const stored: Draft = {
    label: set?.label ?? stage.label,
    colour: colourKey(set?.colour),
  };
  const current = draft ?? stored;
  const inputId = `stage-label-${stage.name}`;

  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-1">
        <StagePill
          label={current.label.trim() || stage.label}
          colour={current.colour === "" ? undefined : current.colour}
        />
        <p className="text-xs text-muted-foreground">
          In code: &ldquo;{stage.label}&rdquo;, no colour
        </p>
      </div>
      {canChange ? (
        <div className="space-y-2">
          <div>
            <label htmlFor={inputId} className="sr-only">
              Label for {stage.label}
            </label>
            <Input
              id={inputId}
              value={current.label}
              maxLength={100}
              disabled={saving}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={event =>
                onDraft({ ...current, label: event.target.value })
              }
            />
          </div>
          <StageColourPicker
            stage={stage}
            stored={set?.colour}
            chosen={current.colour}
            disabled={saving}
            onChoose={colour => onDraft({ ...current, colour })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!draftChanged(current, stored) || saving}
              aria-label={`Save ${stage.label}`}
              onClick={() => void onSave(labelPatch(current, stage))}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!labelDiffersFromCode(stage, settings) || saving}
              aria-label={`Reset ${stage.label}`}
              onClick={() => void onSave(null)}
            >
              Reset
            </Button>
          </div>
          {error && (
            <p
              id={`${inputId}-error`}
              className="text-xs text-danger-text"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Whether a row's edits differ from what is stored. */
function draftChanged(current: Draft, stored: Draft): boolean {
  return (
    current.label.trim() !== stored.label || current.colour !== stored.colour
  );
}

/**
 * What a row's Save sends: a label left empty, or the code's own, as no label
 * of its own, so the code's shows and follows the code; no colour as none.
 */
function labelPatch(
  current: Draft,
  stage: WorkflowStageSummary
): { label: string | null; colour: string | null } {
  const label = current.label.trim();
  return {
    label: label === "" || label === stage.label ? null : label,
    colour: current.colour === "" ? null : current.colour,
  };
}

/**
 * A stage's colour picker: No colour, each palette swatch, and a stored value
 * outside the palette as its own option, so the choice on screen is the one
 * stored.
 */
function StageColourPicker({
  stage,
  stored,
  chosen,
  disabled,
  onChoose,
}: {
  stage: WorkflowStageSummary;
  /** The colour stored for the stage, as the API keeps it. */
  stored: string | undefined;
  /** The colour chosen, by its picker key ("" for none). */
  chosen: string;
  disabled: boolean;
  onChoose: (colour: string) => void;
}): React.JSX.Element {
  const name = `stage-colour-${stage.name}`;
  const storedColour = stageColourOf(stored);
  const options = [
    {
      key: "none",
      value: "",
      label: NEUTRAL_SWATCH.name,
      surface: NEUTRAL_SWATCH.surface,
      ink: NEUTRAL_SWATCH.label,
    },
    ...STAGE_SWATCHES.map(swatch => ({
      key: swatch.id,
      value: swatch.value,
      label: swatch.name,
      surface: swatch.surface,
      ink: swatch.label,
    })),
    ...(storedColour.kind === "custom"
      ? [
          {
            key: "custom",
            value: colourKey(storedColour.value),
            label: `Set elsewhere (${storedColour.value})`,
            surface: NEUTRAL_SWATCH.surface,
            ink: NEUTRAL_SWATCH.label,
          },
        ]
      : []),
  ];
  return (
    <fieldset>
      <legend className="sr-only">Colour for {stage.label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <ColourOption
            key={option.key}
            name={name}
            value={option.value}
            label={option.label}
            checked={chosen === option.value}
            disabled={disabled}
            surface={option.surface}
            ink={option.ink}
            onSelect={() => onChoose(option.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface ColourOptionProps {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  surface: string;
  ink: string;
  onSelect: () => void;
}

/** One swatch of the picker: a radio named by its colour, drawn on it. */
function ColourOption({
  name,
  value,
  label,
  checked,
  disabled,
  surface,
  ink,
  onSelect,
}: ColourOptionProps): React.JSX.Element {
  return (
    <label
      className={cn(
        "inline-flex min-h-6 cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        surface,
        ink,
        checked && "ring-2 ring-foreground ring-offset-1 ring-offset-background"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      {label}
    </label>
  );
}
