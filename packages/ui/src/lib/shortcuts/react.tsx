/**
 * React bindings for the shortcut manager.
 *
 * Precedence follows the component tree. `ShortcutProvider` owns the single listener and is
 * depth 0; every `ShortcutScope` beneath it adds one. A shortcut registered deeper wins, which is
 * what makes an editor canvas outrank the shell that contains it without either one naming a
 * number the other has to stay clear of.
 *
 * @example
 * ```tsx
 * // The shell, once, at the root.
 * <ShortcutProvider>
 *   <App />
 * </ShortcutProvider>
 *
 * // Anywhere inside it.
 * useShortcuts(
 *   [{ keys: "mod+s", description: "Save", run: save, when: () => isDirty }],
 *   { name: "entry-form" }
 * );
 *
 * // A canvas that must own the keyboard while a drag is in flight. `blocking` is what stops the
 * // shell's Escape from navigating away mid-drag: while the drag runs, nothing below this layer
 * // sees a keystroke at all.
 * //
 * // The bindings live in their own component so the hook is called at a component's top level.
 * // A scope's children are ordinary React children, so a hook cannot be called among them
 * // directly — the rules-of-hooks lint rejects it, and conditional rendering would change hook
 * // order.
 * function DragKeys({ isDragging, cancel }) {
 *   useShortcuts([{ keys: "Escape", description: "Cancel drag", run: cancel }], {
 *     name: "canvas-drag",
 *     enabled: isDragging,
 *     blocking: true,
 *   });
 *   return null;
 * }
 *
 * <ShortcutScope>
 *   <DragKeys isDragging={isDragging} cancel={cancel} />
 *   <Canvas />
 * </ShortcutScope>
 * ```
 *
 * @module lib/shortcuts/react
 */
"use client";

import * as React from "react";

import { devWarnOnce } from "../dev-warn";

import {
  createShortcutManager,
  type ActiveShortcut,
  type ShortcutBinding,
  type ShortcutManager,
  type ShortcutManagerOptions,
} from "./manager";

interface ShortcutContextValue {
  manager: ShortcutManager;
  depth: number;
  /**
   * The target this provider's listener is installed on, already resolved.
   *
   * Carried so a nested provider can compare identity rather than props: an omitted target and
   * an explicit `document` name the same node, and comparing the props would call two providers
   * different while both attached a listener to it.
   */
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

const ShortcutContext = React.createContext<ShortcutContextValue | null>(null);

/** A target this kit is already listening on, and how many providers rely on that listener. */
interface TargetOwner {
  manager: ShortcutManager;
  providers: number;
  detach?: () => void;
}

/**
 * The manager already listening on each target.
 *
 * Keyed by the target rather than carried in context, because "one listener per target" is a
 * fact about the DOM and not about the React tree. Two sibling subtrees — or two independent
 * roots on one page — each render a provider with no shortcut ancestor between them, so a
 * context check sees nothing and both would attach. This registry is what makes the guarantee
 * hold across them.
 */
const ownersByTarget = new WeakMap<object, TargetOwner>();

/**
 * Props for {@link ShortcutProvider}.
 *
 * @experimental
 */
export interface ShortcutProviderProps extends ShortcutManagerOptions {
  children?: React.ReactNode;
  /**
   * Where the listener is installed. Defaults to `document`.
   *
   * The bubble phase is deliberate: a component that handles its own keys and calls
   * `stopPropagation` wins without knowing this exists, because React attaches its handlers
   * below `document`.
   */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/**
 * Installs the application's one keydown listener and roots the layer stack.
 *
 * @experimental
 */
export function ShortcutProvider({
  children,
  target,
  ...managerOptions
}: ShortcutProviderProps): React.JSX.Element {
  const parent = React.useContext(ShortcutContext);
  // A second provider on the same target is the very bug this module exists to remove: two
  // listeners on one node, where `stopPropagation` cannot suppress a sibling, so both run their
  // binding for one key. A nested provider therefore does NOT build a manager of its own — it
  // passes the outer one through, so the shortcuts inside it still work and there is still one
  // listener. Nesting with an EXPLICIT target is left alone: a second document, such as an
  // iframe or a pop-out window, genuinely needs its own listener.
  // Resolved before comparing, because `undefined` and an explicit `document` name the same
  // node. Comparing the PROPS would call two providers different while both attach a listener to
  // the same target, which is the arrangement this guard exists to prevent.
  const resolvedTarget =
    target === null
      ? null
      : (target ?? (typeof document === "undefined" ? null : document));
  const nestedOnSameTarget =
    parent !== null &&
    resolvedTarget !== null &&
    parent.target === resolvedTarget;
  // Options are read once, when the manager is built. Re-creating it on a changed option would
  // drop every layer registered by a child, since registrations live on the manager instance.
  const optionsRef = React.useRef(managerOptions);
  const detached = React.useMemo(
    () => createShortcutManager(optionsRef.current),
    []
  );

  // Looked up during render, because two sibling providers both need the same manager before
  // either one's effect has run. The lookup is idempotent and keyed by the target, so a repeated
  // render finds the entry it made rather than making a second one; the reference COUNT is kept
  // in the effect below, where React guarantees a matching cleanup.
  let owner =
    resolvedTarget === null ? null : ownersByTarget.get(resolvedTarget);
  if (resolvedTarget !== null && !owner) {
    owner = { manager: detached, providers: 0 };
    ownersByTarget.set(resolvedTarget, owner);
  }
  const manager = owner ? owner.manager : detached;

  devWarnOnce(
    !nestedOnSameTarget,
    "ShortcutProvider: a provider is already mounted above this one. The inner one is being " +
      "ignored, because two listeners on the same target would each run a binding for the same " +
      "key. Render one provider at the root, and use ShortcutScope to raise precedence inside it."
  );

  React.useEffect(() => {
    // `null` is an explicit "attach nothing", for tests and for a host that drives `handle`
    // itself.
    if (resolvedTarget === null) return;
    const entry = ownersByTarget.get(resolvedTarget);
    if (!entry) return;
    entry.providers += 1;
    // The first provider to arrive installs the listener; the rest share it. Ownership is a
    // property of the target rather than of the tree, so this holds for sibling subtrees and
    // independent React roots, which have no common context to consult.
    if (entry.providers === 1) {
      entry.detach = entry.manager.attach(resolvedTarget);
    }
    return () => {
      entry.providers -= 1;
      if (entry.providers === 0) {
        entry.detach?.();
        entry.detach = undefined;
        ownersByTarget.delete(resolvedTarget);
      }
    };
  }, [resolvedTarget]);

  // Depth continues from the parent rather than restarting, so a scope inside an ignored nested
  // provider still outranks what surrounds it.
  const depth = nestedOnSameTarget && parent ? parent.depth : 0;
  const value = React.useMemo(
    () => ({ manager, depth, target: resolvedTarget }),
    [manager, depth, resolvedTarget]
  );
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Raises the precedence of everything inside it by one level.
 *
 * @experimental
 */
export function ShortcutScope({
  children,
}: {
  children?: React.ReactNode;
}): React.JSX.Element {
  const parent = React.useContext(ShortcutContext);
  if (!parent) {
    throw new Error("ShortcutScope must be rendered inside a ShortcutProvider");
  }
  const value = React.useMemo(
    () => ({
      manager: parent.manager,
      depth: parent.depth + 1,
      target: parent.target,
    }),
    [parent.manager, parent.depth, parent.target]
  );
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Options for {@link useShortcuts}, minus the depth, which comes from the tree.
 *
 * @experimental
 */
export interface UseShortcutsOptions {
  /** Identifies this layer in a help panel. */
  name: string;
  /** Whether the layer participates. A disabled layer neither matches nor blocks. */
  enabled?: boolean;
  /**
   * Whether unmatched keys stop here rather than reaching layers beneath.
   *
   * Set this while a drag or a modal interaction owns the keyboard.
   */
  blocking?: boolean;
}

/**
 * Register shortcuts for as long as the calling component is mounted.
 *
 * The bindings array may be rebuilt on every render; it is re-read in place rather than
 * re-registered, so inline closures are fine and the layer keeps its position in the stack.
 *
 * @experimental
 */
export function useShortcuts(
  bindings: readonly ShortcutBinding[],
  options: UseShortcutsOptions
): void {
  const context = React.useContext(ShortcutContext);
  if (!context) {
    throw new Error("useShortcuts must be called inside a ShortcutProvider");
  }
  const { manager, depth } = context;

  const registration = React.useRef<ReturnType<
    ShortcutManager["register"]
  > | null>(null);

  // The newest bindings and options, reachable from an effect that must not re-run when they
  // change. Registration is deliberately NOT keyed on them: rebuilding the layer would move it
  // to the top of its depth, changing precedence for a reason the caller never asked for.
  const latest = React.useRef({ bindings, options });

  React.useLayoutEffect(() => {
    registration.current = manager.register([], {
      name: latest.current.options.name,
      depth,
    });
    return () => {
      registration.current?.dispose();
      registration.current = null;
    };
  }, [manager, depth]);

  // No dependency array: the bindings close over render-scoped values, so re-reading them every
  // render is what keeps them from going stale, and it is cheap.
  React.useLayoutEffect(() => {
    latest.current = { bindings, options };
    registration.current?.update(bindings, {
      name: options.name,
      depth,
      enabled: options.enabled,
      blocking: options.blocking,
    });
  });
}

/**
 * The manager itself, for a help panel that lists what is currently bound.
 *
 * @experimental
 */
export function useShortcutManager(): ShortcutManager {
  const context = React.useContext(ShortcutContext);
  if (!context) {
    throw new Error(
      "useShortcutManager must be called inside a ShortcutProvider"
    );
  }
  return context.manager;
}

/**
 * The shortcuts currently in effect, most precedent first.
 *
 * Read at call time rather than subscribed to: this is for a help panel, which opens, reads once
 * and closes, and a subscription would re-render it on every layer change beneath.
 *
 * @experimental
 */
export function useActiveShortcuts(): readonly ActiveShortcut[] {
  const manager = useShortcutManager();
  return manager.activeBindings();
}
