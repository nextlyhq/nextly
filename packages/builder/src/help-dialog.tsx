/**
 * Help: the editor's keyboard shortcuts and where its documentation is.
 *
 * A modal rather than a panel, so it never reserves a region and shrinks the
 * canvas. It holds the keyboard while it is open, so a key pressed in it does
 * not edit the page behind it, and Radix keeps focus inside it and closes it on
 * Escape; focus then goes back to the control that opened it.
 *
 * @module help-dialog
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  detectApplePlatform,
  Label,
  Switch,
  useActiveShortcuts,
} from "@nextlyhq/ui";
import * as React from "react";

import { PAGE_BUILDER_DOCS } from "./docs-links";
import { EDITOR_WORDS } from "./editor-words";
import { helpShortcuts, type ShortcutRow } from "./help-shortcuts";
import { useModalKeyboardHold } from "./modal-keyboard-hold";

/**
 * Keys that are not bindings in any registry, so no registry can report them:
 * the platform's own context-menu key, which the browser turns into the same
 * event a right-click sends. Listed by hand, and only these.
 *
 * The row says where it works because it does not work everywhere: the event
 * comes from whatever holds focus, and reaches a block's menu only when that is
 * a link or button inside the block. With focus on the canvas or on a block
 * with no control in it, the key does nothing, and a row promising the menu
 * would mislead.
 */
const PLATFORM_KEYS: readonly ShortcutRow[] = [
  {
    description: "Open the block's menu from a link or button inside it",
    keys: ["Shift+F10", "Menu key"],
  },
];

function ShortcutList({ rows }: { rows: readonly ShortcutRow[] }) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold">
        Keyboard shortcuts
      </h2>
      <dl className="space-y-1.5 text-sm">
        {rows.map(row => (
          <div
            key={row.description}
            className="flex items-baseline justify-between gap-4"
          >
            <dt>{row.description}</dt>
            <dd className="flex shrink-0 gap-1">
              {row.keys.map(key => (
                <kbd
                  key={key}
                  className="rounded border border-[color:var(--nx-builder-border)] px-1.5 py-0.5 font-mono text-xs"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The rail's single-letter panel keys: whether they are on, and the switch. */
export interface PanelKeysSetting {
  on: boolean;
  onChange: (on: boolean) => void;
}

/**
 * The switch for the panel keys, beside the list that shows them: a key with
 * no modifier can be set off by speech input or a stray press, so an author
 * can turn them off (WCAG 2.1.4).
 */
function PanelKeysSwitch({
  setting,
}: {
  setting: PanelKeysSetting;
}): React.JSX.Element {
  const id = React.useId();
  const hintId = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="space-y-0.5">
        <Label htmlFor={id}>Single-letter shortcuts</Label>
        <p id={hintId} className="text-xs text-muted-foreground">
          A, L, P, C and D open panels. Turn them off if you use speech input or
          press them by accident.
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={hintId}
        checked={setting.on}
        onCheckedChange={setting.onChange}
      />
    </div>
  );
}

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when Help closes: the control that opened it.
   *
   * Radix returns focus to a dialog's own trigger, and Help has none — it
   * opens from the rail, outside the dialog — so without this, closing it
   * left focus on the page's body and a keyboard author back at the top.
   */
  returnFocus?: () => HTMLElement | null;
  /** The panel keys' switch, where the editor has them. */
  panelKeys?: PanelKeysSetting;
}

export function HelpDialog({
  open,
  onOpenChange,
  returnFocus,
  panelKeys,
}: HelpDialogProps): React.JSX.Element {
  useModalKeyboardHold("builder-help-modal", open);
  // Every binding in effect, the editor's and the page's around it: a
  // provider nested on the page's target shares the page's manager. The hold
  // above binds nothing, so it hides nothing from the list.
  const active = useActiveShortcuts();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={event => {
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{EDITOR_WORDS.help}</DialogTitle>
          <DialogDescription>
            Keyboard shortcuts for the Page Builder, and where to read more.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* The platform is read here, where the content draws only once the
              dialog is open — always in a browser, after hydration. */}
          <ShortcutList
            rows={[
              ...helpShortcuts(active, detectApplePlatform()),
              ...PLATFORM_KEYS,
            ]}
          />
          {panelKeys === undefined ? null : (
            <PanelKeysSwitch setting={panelKeys} />
          )}
          <section aria-label="Documentation" className="space-y-2">
            <h2 className="text-sm font-semibold">Documentation</h2>
            <ul className="space-y-1 text-sm">
              {PAGE_BUILDER_DOCS.map(link => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
