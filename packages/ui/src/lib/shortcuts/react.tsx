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
import { useIsomorphicLayoutEffect } from "../isomorphic-layout-effect";

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
  /**
   * The options the manager in use was built with, as a comparable string.
   *
   * Carried because the per-target registry cannot answer for a DETACHED provider: it is a
   * WeakMap keyed by the target, and `null` is not a key, so a provider that attaches nothing has
   * no entry to compare against. Two nested detached providers describe the same event stream and
   * share a manager exactly as two attached ones do, and an inner one passing different options
   * loses them the same way — with nothing in the registry to notice.
   */
  options: string;
}

const ShortcutContext = React.createContext<ShortcutContextValue | null>(null);

/** A target this kit is already listening on, and how many providers rely on that listener. */
interface TargetOwner {
  manager: ShortcutManager;
  providers: number;
  detach?: () => void;
  /** The options the manager was built with, so an adopting provider can tell they differ. */
  options: string;
  /**
   * Whether every provider that used this owner has since unmounted.
   *
   * Distinguishes a shell left behind, whose manager was configured by a provider that has gone,
   * from an entry a sibling RESERVED during the same render and has not mounted yet. Both have no
   * providers, and replacing the second discards the manager that sibling already registered its
   * bindings on.
   */
  retired: boolean;
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
 * The options that change how a manager behaves, as a comparable string.
 *
 * `now` is a function and cannot be compared usefully, so its PRESENCE is what is recorded: two
 * providers that both supply a clock may still disagree, and one that supplies none plainly
 * differs from one that does.
 */
function optionsFingerprint(options: ShortcutManagerOptions): string {
  return [
    options.isApple ?? "auto",
    options.sequenceTimeoutMs ?? "default",
    options.now ? "clock" : "no-clock",
  ].join("\u0000");
}

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
  // `null` is compared too: two providers that both attach nothing describe the SAME event
  // stream, the one the host drives through `handle()`. An inner provider building its own
  // manager there means the host never sees the bindings beneath it.
  const nestedOnSameTarget =
    parent !== null && parent.target === resolvedTarget;
  // Options are read once, when the manager is built. Re-creating it on a changed option would
  // drop every layer registered by a child, since registrations live on the manager instance.
  const optionsRef = React.useRef(managerOptions);
  // One manager per target this provider has served, rather than one for the provider.
  //
  // A single memoised manager becomes shared the moment a sibling adopts it, and then following
  // this provider to a new target would register that same manager for two documents — every
  // tree's shortcuts firing on both. Keyed by target, the manager this provider offers to a new
  // owner is one no other owner is using.
  // WEAK keys, so a pop-out or iframe document this provider has finished with can be collected.
  // A strong map would hold every former target, and its whole DOM, until the provider unmounted.
  const ownManagers = React.useRef(new WeakMap<object, ShortcutManager>());
  // The detached case has no target to key on, so it gets its own slot rather than a sentinel
  // object living in the map forever.
  const ownDetached = React.useRef<ShortcutManager | null>(null);
  const detached = React.useMemo(() => {
    if (resolvedTarget === null) {
      ownDetached.current ??= createShortcutManager(optionsRef.current);
      return ownDetached.current;
    }
    const existing = ownManagers.current.get(resolvedTarget);
    if (existing) return existing;
    const created = createShortcutManager(optionsRef.current);
    ownManagers.current.set(resolvedTarget, created);
    return created;
  }, [resolvedTarget]);

  // Looked up during render, because two sibling providers both need the same manager before
  // either one's effect has run. The lookup is idempotent and keyed by the target, so a repeated
  // render finds the entry it made rather than making a second one; the reference COUNT is kept
  // in the effect below, where React guarantees a matching cleanup.
  let owner =
    resolvedTarget === null ? null : ownersByTarget.get(resolvedTarget);
  // A RETIRED owner is a shell, kept only so a Strict Mode replay can find it. Its manager was
  // configured by a provider that has since gone, and adopting it would silently give this one
  // someone else's `isApple`, `sequenceTimeoutMs` and clock. An owner merely awaiting its first
  // effect is a different thing: a sibling rendered in the same pass has already taken its
  // manager and registered bindings on it, and replacing it would strand them.
  const fingerprint = optionsFingerprint(optionsRef.current);
  if (resolvedTarget !== null && (!owner || owner.retired)) {
    owner = {
      manager: detached,
      providers: 0,
      retired: false,
      options: fingerprint,
    };
    ownersByTarget.set(resolvedTarget, owner);
  }
  // Adopting a shared manager means adopting the options it was built with. That is what sharing
  // IS, and it is correct for genuine siblings — but a render that is abandoned before it commits
  // leaves a reservation nothing will ever clean up, and the next provider on that target adopts
  // its options silently. The mismatch is reported rather than hidden, because the symptom
  // otherwise is `mod` meaning the wrong key with nothing to point at.
  // Checked against the PARENT as well as the registry. The registry answers for a shared target;
  // the parent answers for the nested case, including the detached one the registry cannot see.
  const adoptedDiffers =
    (Boolean(owner) && owner?.options !== fingerprint) ||
    (nestedOnSameTarget && parent !== null && parent.options !== fingerprint);
  devWarnOnce(
    !adoptedDiffers,
    "ShortcutProvider: another provider is already listening on this target with different " +
      "options, so the ones passed here are being ignored. Managers are shared per target; give " +
      "the providers matching options, or a target of their own."
  );
  // Nesting with matching options is SUPPORTED, not a mistake, and is deliberately not warned
  // about: a component that owns keys and can be rendered on its own — a command palette exported
  // for embedding — has to bring a provider with it, or it throws wherever no shell wrapped it.
  // Reusing the target's manager makes that composition free, and the warning above still reports
  // the case that genuinely loses something, which is options that disagree.
  const manager =
    nestedOnSameTarget && parent
      ? parent.manager
      : owner
        ? owner.manager
        : detached;

  // Layout timing, matching the effects that register the layers. A passive effect installs the
  // listener AFTER paint, so a keydown delivered between the commit and the passive flush reaches
  // no manager at all — the provider is on screen, its layers are registered, and a focused
  // control or a legacy listener still answers the first keystroke.
  useIsomorphicLayoutEffect(() => {
    // `null` is an explicit "attach nothing", for tests and for a host that drives `handle`
    // itself.
    if (resolvedTarget === null) return;
    let entry = ownersByTarget.get(resolvedTarget);
    if (!entry) {
      // Strict Mode replays effects as setup, cleanup, setup. Reading the entry made during
      // render would find nothing on the replayed setup, so nothing would reattach and every
      // shortcut would be dead for the rest of the mount — in development only, which is the
      // worst place for it to hide.
      entry = {
        manager,
        providers: 0,
        retired: false,
        options: optionsFingerprint(optionsRef.current),
      };
      ownersByTarget.set(resolvedTarget, entry);
    }
    const owned = entry;
    owned.providers += 1;
    owned.retired = false;
    // The first provider to arrive installs the listener; the rest share it. Ownership is a
    // property of the target rather than of the tree, so this holds for sibling subtrees and
    // independent React roots, which have no common context to consult.
    if (owned.providers === 1) {
      owned.detach = owned.manager.attach(resolvedTarget);
    }
    return () => {
      owned.providers -= 1;
      if (owned.providers === 0) {
        owned.detach?.();
        owned.detach = undefined;
        owned.retired = true;
        // The entry itself is KEPT. It is weakly keyed by the target, so it cannot outlive one,
        // and removing it is what made a Strict Mode replay lose the listener. An unused manager
        // holds no layers, since each layer is disposed by the hook that registered it.
      }
    };
  }, [resolvedTarget, manager]);

  // Depth continues from the parent rather than restarting, so a scope inside an ignored nested
  // provider still outranks what surrounds it.
  const depth = nestedOnSameTarget && parent ? parent.depth : 0;
  const value = React.useMemo(
    () => ({ manager, depth, target: resolvedTarget, options: fingerprint }),
    [manager, depth, resolvedTarget, fingerprint]
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
      // Inherited: a scope raises precedence, it does not build a manager, so the options in force
      // are still the ones the provider above it used.
      options: parent.options,
    }),
    [parent.manager, parent.depth, parent.target, parent.options]
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
  /**
   * Sorted ABOVE depth, so a layer can outrank one nested deeper than itself.
   *
   * For a modal, whose hold must not be tied or beaten by a host scoping its own shortcuts one
   * level further. Ordinary layers leave this alone.
   */
  priority?: number;
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

  useIsomorphicLayoutEffect(() => {
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
  useIsomorphicLayoutEffect(() => {
    latest.current = { bindings, options };
    registration.current?.update(bindings, {
      name: options.name,
      depth,
      enabled: options.enabled,
      blocking: options.blocking,
      priority: options.priority,
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
 * SUBSCRIBED rather than read once. A help panel mounting alongside the components that register
 * shortcuts reads before their effects have run, so a one-time read returns an empty list and no
 * later render corrects it — the panel simply shows nothing. The same applies whenever a layer is
 * enabled, disabled or replaced while the panel is open.
 *
 * The manager returns the same array until its stack changes, so this re-renders when the
 * shortcuts change and not on every read.
 *
 * @experimental
 */
export function useActiveShortcuts(): readonly ActiveShortcut[] {
  const manager = useShortcutManager();
  return React.useSyncExternalStore(
    manager.subscribe,
    manager.activeBindings,
    manager.activeBindings
  );
}
