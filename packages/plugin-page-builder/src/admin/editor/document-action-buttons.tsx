"use client";

/**
 * The document's save verbs, in the builder's own top bar.
 *
 * The builder takes the window, and the editor's header with it, so without
 * these an author mid-layout could save only with the keyboard. They are the
 * header's own actions (`useDocumentActions`), not a second set: the same
 * labels, the same reasons an action cannot run, and pressing one runs what
 * the header's control runs — open passages finished first, its question
 * asked, its outcome reported.
 *
 * Only the leading action and the toolbar's (Publish, Save, Save draft). The
 * document menu — duplicate, delete, the API response — stays on the page's
 * form, one step away, rather than crowding a bar that belongs to the canvas.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/document-action-buttons
 */
import {
  useDocumentActions,
  type DocumentAction,
} from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";

/** The toolbar's actions first, then the one that leads, at the far end. */
function shownActions(actions: readonly DocumentAction[]): DocumentAction[] {
  return [
    ...actions.filter(action => action.placement === "toolbar"),
    ...actions.filter(action => action.placement === "primary"),
  ];
}

export function DocumentActionButtons(): React.JSX.Element | null {
  const document = useDocumentActions();
  if (document === null) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {shownActions(document.actions).map(action => {
        // Kept focusable and named when it cannot run, so its reason is
        // read and hovered rather than lost with a disabled control. Only the
        // action's own reason holds it back, as in the header: a save state of
        // "saving" includes a write the page depends on, and Save and Publish
        // wait for that write and then store, which `run` does for both
        // surfaces. A save already in flight is answered as busy by `run`.
        const blocked = action.disabledReason !== undefined;
        return (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant={action.placement === "primary" ? "default" : "outline"}
            aria-disabled={blocked || undefined}
            title={action.disabledReason}
            onClick={() => {
              if (blocked) return;
              void document.run(action.id);
            }}
          >
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}
