"use client";

/**
 * Everything an author can do with a preview, as ONE control.
 *
 * There were three, and they read as three unrelated buttons: a pane toggle, an
 * "open the preview" action, and a copy-link action — two of which already
 * shared a dropdown while the third sat beside them looking like a second
 * preview button. Counted from the running editor, that was three of the seven
 * controls in the header for one idea.
 *
 * They are one idea, so this is one control: pressing it does the thing an
 * author wants most, and the menu holds the other ways of getting at the same
 * preview. That is the split-button shape every editor surveyed uses for this —
 * the block editor's preview, Webflow's, Framer's — and the reason is the same
 * everywhere: the variants are destinations for one intent, not separate verbs.
 *
 * WHICH ONE IS THE PRESS is decided by what the surface offers, not by
 * preference. A pane toggle is the cheapest and most reversible — it costs
 * nothing to open and nothing to close — so it leads wherever it exists, and it
 * is the only one of the three with a STATE worth showing, which a press with
 * `aria-pressed` expresses and a menu item cannot. Where no pane exists — an
 * editor embedded in a modal — opening the preview leads instead.
 *
 * @module components/features/entries/EntryForm/PreviewActions
 */

import type { ReactElement } from "react";

import {
  ChevronDown,
  ExternalLink,
  Eye,
  Link,
  PanelRight,
} from "@admin/components/icons";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import { ToolbarLabel } from "./toolbar-density";

// An ellipsis because it opens the share popover rather than acting at once:
// the lifetime is chosen there, and the link is made and copied from it.
const SHARE_LABEL = "Share preview link…";
const OPEN_LABEL = "Open in new tab";

export interface PreviewActionsProps {
  /** Whether the collection has a preview URL configured. */
  isPreviewAvailable?: boolean;
  /**
   * Opens the preview in the editor's own session.
   *
   * May return a promise: resolving the URL can require a round trip. Nothing
   * here treats the handler returning as the preview having opened, so an
   * asynchronous implementation needs no change on this side.
   */
  onPreview?: () => void | Promise<void>;
  /** Label for the preview action. */
  previewLabel?: string;
  /**
   * Shows or hides the side-by-side pane.
   *
   * Absent means the surface offers no pane at all, which is what an editor
   * embedded in a modal does.
   */
  onTogglePreviewPane?: () => void;
  /** Whether that pane is open, which the control reports as its pressed state. */
  previewPaneOpen?: boolean;
  /**
   * Whether a shareable link can be minted. False for an unsaved entry, which
   * has no id to name, and for an author without `update` on the collection.
   */
  isLinkAvailable?: boolean;
  /**
   * Opens the share popover, where the link's lifetime is chosen, the link is
   * made and copied, and the document's live links are listed and revoked.
   * The surface holding this control owns the popover, so it can anchor it
   * somewhere that stays on screen.
   */
  onShareLink?: () => void;
  /** Whether the surrounding form is submitting. */
  disabled?: boolean;
  /**
   * The button height, matching whichever action row this sits in. The two
   * rows disagree: the standalone editor's header is a band of `sm` controls,
   * while the embedded form's footer uses the default. A control that keeps
   * one height in both is the wrong height in one of them, and a button a few
   * pixels taller than the Save beside it reads as a mistake rather than as a
   * distinction.
   */
  size?: "default" | "sm";
}

/**
 * What each position calls the preview.
 *
 * Four labels rather than one, because the same action is named differently
 * depending on where it sits — and gathering them here keeps that decision
 * readable instead of spread across four ternaries in the render.
 *
 * A DECLARED label wins everywhere and is used VERBATIM. Collections name one
 * "View page", and interpolating a verb produced "Show View page", which is not
 * English; the open state is reported by `aria-pressed` and by the variant,
 * which is how a toggle button reports itself.
 */
function previewLabels(
  declared: string | undefined,
  paneOpen: boolean,
  hasPane: boolean
): { pane: string; solo: string; menuOpen: string; menuTrigger: string } {
  const fallbackPane = paneOpen ? "Hide preview" : "Show preview";
  return {
    pane: declared ?? fallbackPane,
    solo: declared ?? "Preview",
    /*
     * Under the pane toggle, opening names its DESTINATION: an item saying
     * "Preview" beside a button saying "Show preview" tells an author nothing
     * about which is which. Where the menu IS the control there is nothing to
     * confuse it with, so it is simply the preview.
     */
    menuOpen: declared ?? (hasPane ? OPEN_LABEL : "Preview"),
    menuTrigger: declared ?? "Preview",
  };
}

/** A press paired with a chevron that opens the rest. */
function SplitControl({
  press,
  options,
  size,
  disabled,
  optionsLabel,
}: {
  press: ReactElement;
  options: ReactElement[];
  size: "default" | "sm";
  disabled: boolean;
  /**
   * What this chevron opens, named after the control it belongs to.
   *
   * The chevron carries no visible text, so its `aria-label` IS its name, and a
   * fixed one detaches it from a press whose label the collection chose.
   */
  optionsLabel: string;
}) {
  if (options.length === 0) return press;
  return (
    <div className="flex items-center">
      {press}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size}
            disabled={disabled}
            className="rounded-l-none px-1.5"
            aria-label={optionsLabel}
            title={optionsLabel}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{options}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PreviewActions({
  isPreviewAvailable = false,
  onPreview,
  previewLabel,
  onTogglePreviewPane,
  previewPaneOpen = false,
  isLinkAvailable = false,
  onShareLink,
  disabled = false,
  size = "default",
}: PreviewActionsProps) {
  const canPane = onTogglePreviewPane !== undefined;
  const canOpen = isPreviewAvailable && onPreview !== undefined;
  const canShare = isLinkAvailable && onShareLink !== undefined;

  // Nothing to offer is nothing to draw. A control that opens onto no options
  // is the empty-menu defect, and a disabled one here would be furniture.
  if (!canPane && !canOpen && !canShare) return null;

  const labels = previewLabels(previewLabel, previewPaneOpen, canPane);

  /*
   * `onSelect` rather than `onClick`, which is what makes `disabled` real: the
   * menu is uncontrolled and stays open across the state change that starts a
   * save, and Radix suppresses a disabled item's `onSelect` while letting a
   * click through.
   */
  const options: ReactElement[] = [];
  if (canOpen) {
    options.push(
      <DropdownMenuItem
        key="open"
        onSelect={() => void onPreview?.()}
        disabled={disabled}
        data-preview-option="open"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {labels.menuOpen}
      </DropdownMenuItem>
    );
  }
  if (canShare) {
    options.push(
      <DropdownMenuItem
        key="share"
        onSelect={() => onShareLink?.()}
        disabled={disabled}
        data-preview-option="share"
      >
        <Link className="h-4 w-4" aria-hidden="true" />
        {SHARE_LABEL}
      </DropdownMenuItem>
    );
  }

  /*
   * WHERE A PANE EXISTS, it leads and the rest become its menu.
   *
   * The pane toggle is the cheapest and most reversible of the three — nothing
   * is spent opening or closing it — and it is the only one with a STATE worth
   * showing, which a press with `aria-pressed` expresses and a menu item
   * cannot. One visual unit replaces the pane toggle and a separate preview
   * menu sitting side by side, which read as two preview buttons.
   */
  if (canPane) {
    return (
      <SplitControl
        size={size}
        disabled={disabled}
        options={options}
        optionsLabel={`${labels.pane} options`}
        press={
          <Button
            type="button"
            variant={previewPaneOpen ? "secondary" : "outline"}
            size={size}
            onClick={onTogglePreviewPane}
            disabled={disabled}
            aria-pressed={previewPaneOpen}
            title={labels.pane}
            className={cn(options.length > 0 && "rounded-r-none border-r-0")}
            data-preview-lead="pane"
          >
            <PanelRight className="h-4 w-4" aria-hidden="true" />
            <ToolbarLabel priority="secondary">{labels.pane}</ToolbarLabel>
          </Button>
        }
      />
    );
  }

  /*
   * WITHOUT A PANE the shape is unchanged, deliberately.
   *
   * There is no obvious lead between opening and sharing — neither is cheaper
   * nor more reversible than the other — so promoting one would ADD a button
   * rather than remove one. Collapsing to a plain button when only one thing
   * can be done, and to one menu when both can, is what this already did and is
   * right for that case.
   */
  if (canOpen !== canShare) {
    const solo = canOpen
      ? {
          label: labels.solo,
          icon: <Eye className="h-4 w-4" aria-hidden="true" />,
          run: () => void onPreview?.(),
          lead: "open",
        }
      : {
          label: SHARE_LABEL,
          icon: <Link className="h-4 w-4" aria-hidden="true" />,
          run: () => onShareLink?.(),
          lead: "share",
        };
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={solo.run}
        disabled={disabled}
        title={solo.label}
        data-preview-lead={solo.lead}
      >
        {solo.icon}
        <ToolbarLabel priority="secondary">{solo.label}</ToolbarLabel>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          /*
            Derived from the VISIBLE text, not fixed. A collection naming its
            preview "View page" renders that word, and a hardcoded name here
            overrides it — so a voice-control user saying what they can see
            addresses nothing, and a screen reader announces a name the screen
            does not show.
          */
          aria-label={`${labels.menuTrigger} options`}
          title={`${labels.menuTrigger} options`}
          data-preview-lead="menu"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          <ToolbarLabel priority="secondary">{labels.menuTrigger}</ToolbarLabel>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{options}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One thing an author can do with the preview, as a menu row. */
export interface PreviewChoice {
  id: "pane" | "open" | "share";
  label: string;
  run: () => void;
  disabled: boolean;
}

/**
 * Every preview action this surface offers, as plain menu rows, named exactly
 * as the control names them.
 *
 * For a screen too narrow to keep the control in the header: the same choices
 * move into the document's menu rather than wrapping the header onto another
 * row. Derived from the same labels the control draws, so the two never call
 * one action by different names.
 */
export function previewChoices({
  isPreviewAvailable = false,
  onPreview,
  previewLabel,
  onTogglePreviewPane,
  previewPaneOpen = false,
  isLinkAvailable = false,
  onShareLink,
  disabled = false,
}: PreviewActionsProps): PreviewChoice[] {
  const canPane = onTogglePreviewPane !== undefined;
  const canOpen = isPreviewAvailable && onPreview !== undefined;
  const canShare = isLinkAvailable && onShareLink !== undefined;
  const choices: PreviewChoice[] = [];
  /*
   * Named by what each row DOES, not by the preview's own label. Folded into
   * the document's menu the rows sit side by side, out of the control that
   * told them apart, and a collection's declared label ("View page") on both
   * would give two rows one name: one opens the pane beside the editor, the
   * other a new tab.
   */
  if (canPane) {
    choices.push({
      id: "pane",
      label: previewPaneOpen ? "Hide preview pane" : "Show preview pane",
      run: () => onTogglePreviewPane?.(),
      disabled,
    });
  }
  if (canOpen) {
    choices.push({
      id: "open",
      // The control's own name for opening, so a preview that opens in this
      // window is never promised a new tab.
      label: previewLabels(previewLabel, previewPaneOpen, canPane).menuOpen,
      run: () => void onPreview?.(),
      disabled,
    });
  }
  if (canShare) {
    choices.push({
      id: "share",
      label: SHARE_LABEL,
      run: () => onShareLink?.(),
      disabled,
    });
  }
  return choices;
}
