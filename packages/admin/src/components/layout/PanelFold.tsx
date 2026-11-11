"use client";

/**
 * A page that wants its width can ask for the panel to start folded away.
 *
 * A builder (the Forms builder, the Schema Builder) shows a field list, a
 * preview and a settings panel side by side; beside the content panel there is
 * too little room for all three. Such a page declares that its panel starts
 * folded. The rail stays, the bar shows a panel toggle at its left end, and the
 * reader's choice is remembered for that page, so the next visit draws it the
 * same way from its first paint.
 *
 * Folding goes through chrome suppression's `subSidebar` layer, the same way an
 * immersive editor releases the panel, so the panel's width rule needs nothing
 * new: a released panel takes no width.
 */
import React from "react";

import { useSuppressAdminChrome } from "./ChromeSuppression";

const STORAGE_PREFIX = "nextly:panel-open:";

/** Whether the reader last left `key`'s panel open; folded when never chosen. */
function readOpen(key: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    // Storage can be blocked (a private window, a locked-down browser). The
    // page then starts folded every time, as declared, which is still right.
    return false;
  }
}

function writeOpen(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? "1" : "0");
  } catch {
    // As above: the choice is not remembered, and nothing else changes.
  }
}

interface PanelFoldValue {
  /** The page that declared a foldable panel, or null when none has. */
  declared: string | null;
  /** Whether that page's panel is open now. */
  open: boolean;
  /** Open or fold the declared page's panel, and remember the choice. */
  toggle: () => void;
  /** Used by `useFoldedPanel`; a page declares itself on mount. */
  declare: (key: string) => () => void;
}

const PanelFoldContext = React.createContext<PanelFoldValue>({
  declared: null,
  open: false,
  toggle: () => {},
  declare: () => () => {},
});

/** Holds which page declared a foldable panel, and whether it is open. */
export function PanelFoldProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [declared, setDeclared] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const declare = React.useCallback((key: string) => {
    setDeclared(key);
    setOpen(readOpen(key));
    return () => {
      setDeclared(current => (current === key ? null : current));
    };
  }, []);

  const toggle = React.useCallback(() => {
    setOpen(current => {
      const next = !current;
      if (declared) writeOpen(declared, next);
      return next;
    });
  }, [declared]);

  const value = React.useMemo(
    () => ({ declared, open, toggle, declare }),
    [declared, open, toggle, declare]
  );
  return (
    <PanelFoldContext.Provider value={value}>
      {children}
    </PanelFoldContext.Provider>
  );
}

/** The fold state, for the bar's toggle. */
export function usePanelFold(): Pick<
  PanelFoldValue,
  "declared" | "open" | "toggle"
> {
  const { declared, open, toggle } = React.useContext(PanelFoldContext);
  return { declared, open, toggle };
}

// A layout effect, so the declaration and the stored choice are applied before
// the page's first paint; on the server there is no paint to beat.
const useDeclarationEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Declare that this page's panel starts folded away. `key` names the page for
 * remembering the reader's choice (`"forms.builder"`), not the entry it shows,
 * so every form opens the way the reader last left the builder.
 */
export function useFoldedPanel(key: string): void {
  const { declare, declared, open } = React.useContext(PanelFoldContext);
  useDeclarationEffect(() => declare(key), [declare, key]);
  // Until the declaration lands (`declared` is still null), fold: a page that
  // asks to start folded must not first paint its panel open.
  const folded = declared !== key || !open;
  useSuppressAdminChrome({
    layers: folded ? ["subSidebar"] : [],
    canExit: true,
  });
}
