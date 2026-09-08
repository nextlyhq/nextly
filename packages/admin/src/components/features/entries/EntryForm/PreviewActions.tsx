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
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
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

const COPY_LABEL = "Copy shareable link";
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
  /** Mints a link and copies it. */
  onCopyLink?: () => void;
  /** Whether a link is being minted right now. */
  isCopyingLink?: boolean;
  /** Whether the link was just copied, for the control's acknowledgement. */
  isLinkCopied?: boolean;
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
  copying,
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
  /** Whether a link is being minted, which only this control can still show. */
  copying: boolean;
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
            {/*
              Progress belongs on the control that STAYS. Choosing to copy
              closes the menu, so the item that showed the spinner is gone the
              instant it would start — a slow mint then looks like nothing
              happened at all.
            */}
            {copying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
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
  onCopyLink,
  isCopyingLink = false,
  isLinkCopied = false,
  disabled = false,
  size = "default",
}: PreviewActionsProps) {
  const canPane = onTogglePreviewPane !== undefined;
  const canOpen = isPreviewAvailable && onPreview !== undefined;
  const canCopy = isLinkAvailable && onCopyLink !== undefined;

  // Nothing to offer is nothing to draw. A control that opens onto no options
  // is the empty-menu defect, and a disabled one here would be furniture.
  if (!canPane && !canOpen && !canCopy) return null;

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
  if (canCopy) {
    options.push(
      <DropdownMenuItem
        key="copy"
        onSelect={() => onCopyLink?.()}
        disabled={disabled || isCopyingLink}
        data-preview-option="copy"
      >
        {copyIcon(isCopyingLink, isLinkCopied)}
        {COPY_LABEL}
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
        copying={isCopyingLink}
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
   * There is no obvious lead between opening and copying — neither is cheaper
   * nor more reversible than the other — so promoting one would ADD a button
   * rather than remove one. Collapsing to a plain button when only one thing
   * can be done, and to one menu when both can, is what this already did and is
   * right for that case.
   */
  if (canOpen !== canCopy) {
    const solo = canOpen
      ? {
          label: labels.solo,
          icon: <Eye className="h-4 w-4" aria-hidden="true" />,
          run: () => void onPreview?.(),
          busy: false,
          lead: "open",
        }
      : {
          label: COPY_LABEL,
          icon: copyIcon(isCopyingLink, isLinkCopied),
          run: () => onCopyLink?.(),
          busy: isCopyingLink,
          lead: "copy",
        };
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={solo.run}
        disabled={disabled || solo.busy}
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
          {/*
            Progress belongs on the control that STAYS: choosing to copy closes
            the menu, so the item that would show the spinner is gone the
            instant it starts.
          */}
          {isCopyingLink ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
          <ToolbarLabel priority="secondary">{labels.menuTrigger}</ToolbarLabel>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{options}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Copying reports its own progress: in flight, just done, or ready. */
function copyIcon(copying: boolean, copied: boolean): ReactElement {
  if (copying) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (copied) return <Check className="h-4 w-4 text-success" />;
  return <Copy className="h-4 w-4" aria-hidden="true" />;
}
