/**
 * Notices about work the builder started and could not finish.
 *
 * A control that reports its own failure beside itself is the better surface,
 * and every control here does that where it can. This exists for the case it
 * cannot: a failure that arrives after the control reporting it has gone.
 *
 * ## Why the state cannot live in the control
 *
 * The style inspector renders {@link class-selector} with `key={nodeId}`, so
 * changing selection UNMOUNTS it — deliberately, because an unkeyed selector is
 * reused across the change and Enter then applies the previous block's pending
 * choice to the new block. A site-style write is asynchronous and an author
 * does not wait for it, so a refusal can land after that unmount, on an
 * instance whose `setState` reaches nothing. The class was not created and
 * nothing says so.
 *
 * The key is load-bearing, so the failure is what moves. This holds it ABOVE
 * the keyed subtree, in the shell, which no selection change unmounts.
 *
 * ## Why the builder owns it rather than the host
 *
 * A host callback would be optional, like every other host prop here, and a
 * host that omitted it would swallow the failure exactly as before — with a
 * contract making it look handled. Owning the surface means every host gets it,
 * including one with no notification system of its own.
 *
 * ## What belongs here
 *
 * Only a failure with nowhere else to appear. A notice that duplicates a
 * message already on screen makes the author read the same sentence twice and
 * teaches them to ignore the region, so a control that can still be READ
 * reports for itself and stays silent here.
 *
 * Read rather than merely mounted, and the difference is the whole of
 * {@link useSurvivingReport}. Below its minimum width the shell puts its
 * subtree behind `hidden` and `inert`, and neither unmounts anything: a control
 * behind that notice still renders while being excluded from paint and from the
 * accessibility tree, so "it is mounted, let it speak for itself" sends the
 * message somewhere nobody can reach.
 *
 * ## Where it must render
 *
 * Two constraints, and they pull in opposite directions.
 *
 * OUTSIDE the subtree the shell makes `hidden` and `inert`, because that is
 * exactly when this surface is needed and an inert region is excluded from the
 * accessibility tree. A region inside it is unreachable by eye and by screen
 * reader at the same moment.
 *
 * INSIDE a scope that declares `--nx-builder-*`, because custom properties
 * inherit down and never across: with neither ancestor supplying them, every
 * border, background and text declaration resolves to nothing — a transparent
 * box with host-default text, which in dark mode is a failure message the
 * author cannot read.
 *
 * `.nx-builder-tokens` is what satisfies both. `.nx-builder-chrome` would not:
 * it identifies the editor's ROOT as well as declaring the tokens, so a
 * floating region claiming it puts a second root in the document and every
 * selector meaning "the editor" matches whichever comes first — and it paints a
 * background and a colour, so the region would also be claiming the frame.
 *
 * Mounted UNCONDITIONALLY rather than switched between the shell's two
 * branches. A live region has to exist before text is put into it, and one
 * remounted whenever the width crosses the threshold is created at the moment
 * it is needed; one permanent mount also keeps there being exactly one, since
 * two live regions interfere and some messages are announced by neither.
 *
 * @module builder-notices
 */
import { Button, useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { useShellIsActive } from "./shell-active";

/** One thing that failed, in the words an author reads. */
export interface BuilderNotice {
  /** Identity for the list, and what dismissing addresses. */
  readonly id: string;
  /** The sentence shown. Already written for an author, not a log line. */
  readonly message: string;
}

/** Raise a notice. Returns nothing: nobody waits on a report. */
export type RaiseNotice = (message: string) => void;

/**
 * The sink, or nothing when no shell is above.
 *
 * `null` rather than a no-op default so {@link useNoticeSink} can tell "no
 * provider" from "a provider that did nothing", and so a component rendered
 * outside a shell — which the tests do constantly — keeps working.
 */
const NoticeSinkContext = React.createContext<RaiseNotice | null>(null);

/**
 * Report a failure the caller cannot display itself.
 *
 * Answers a no-op when nothing above provides a sink, because a control must
 * not require a shell to render. The caller therefore cannot use a return value
 * to decide whether the author was told, and none is offered: a control that
 * needs to be sure reports for itself while it still can.
 */
export function useNoticeSink(): RaiseNotice {
  const sink = React.useContext(NoticeSinkContext);
  return React.useMemo(() => sink ?? (() => undefined), [sink]);
}

/**
 * Report a failure that may outlive the control raising it.
 *
 * Two surfaces need this and they had a copy each: the class selector, keyed by
 * node, and the class manager, mounted only while its panel is the open one.
 * Both dispatch a site-style write, both can be unmounted before it answers,
 * and both must still tell the author.
 *
 * WHERE is the shared question and is answered here; WHETHER the caller can
 * still show it is not, so that stays with the caller. The selector's inline
 * message is scoped to the node the request was made against and must be
 * withheld when the author has moved to another one — a rule the manager has no
 * equivalent of. So `showInline` answers whether it took responsibility, and
 * the notice is raised only when nothing did.
 *
 * The two are exclusive on purpose: a region repeating what is already on
 * screen is one an author learns to stop reading.
 */
export function useSurvivingReport(): (
  reason: string,
  showInline: () => boolean
) => void {
  const raiseNotice = useNoticeSink();
  /*
   * Whether the caller can still draw. A ref rather than state because nothing
   * renders from it and setting it must schedule no work: it is read inside a
   * callback that has already outlived the render it came from.
   */
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /*
   * The other half of "can still draw", and the reason being mounted is not it.
   *
   * The shell puts its whole subtree behind `hidden` and `inert` below its
   * minimum width, and neither attribute unmounts anything — so a caller behind
   * the narrow-width notice is still mounted, still renders, and is excluded
   * from both the layout and the accessibility tree. Deciding on `mounted`
   * alone stores the message inline on a surface nobody can reach, and the
   * author leaves without learning the write was refused.
   *
   * Tracked through a ref, because the callback below is invoked long after the
   * render that created it — a value closed over at request time describes the
   * shell as it was when the request STARTED, which is exactly the state that
   * has since changed.
   *
   * Synchronised from a COMMITTED-phase effect rather than assigned during
   * render. A render can be abandoned: React may begin rendering a widening
   * shell and drop that work while the hidden subtree is still the one on
   * screen, and a render-time assignment would have already reported the shell
   * as readable. The message would then be stored inline in the subtree the
   * author still cannot see, which is the failure this whole hook exists to
   * prevent, reached by a narrower door.
   *
   * Layout timing rather than passive, because passive effects flush after
   * paint: between the commit that hides the shell and that flush, the ref
   * would still describe the previous committed state. That window is small and
   * it is the same window the rest of this file is about, so it is closed
   * rather than reasoned about.
   */
  const shellIsActive = useShellIsActive();
  const active = React.useRef(shellIsActive);
  useIsomorphicLayoutEffect(() => {
    active.current = shellIsActive;
  }, [shellIsActive]);
  return (reason, showInline) => {
    if (mounted.current && active.current && showInline()) return;
    raiseNotice(reason);
  };
}

/** Put a sink in reach of everything the shell renders. */
export function NoticeSinkProvider({
  raise,
  children,
}: {
  raise: RaiseNotice;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <NoticeSinkContext.Provider value={raise}>
      {children}
    </NoticeSinkContext.Provider>
  );
}

/** What the shell holds so a notice outlives the control that raised it. */
export interface NoticeQueue {
  readonly notices: readonly BuilderNotice[];
  readonly raise: RaiseNotice;
  readonly dismiss: (id: string) => void;
}

/**
 * The queue, owned by whoever renders the region.
 *
 * Identity is a counter rather than the message, because the same failure can
 * happen twice and an author who dismissed the first is owed the second. It is
 * a ref rather than state: bumping it must not schedule a render of its own,
 * and nothing reads it except the notice being built.
 */
export function useNoticeQueue(): NoticeQueue {
  const [notices, setNotices] = React.useState<readonly BuilderNotice[]>([]);
  const nextId = React.useRef(0);

  const raise = React.useCallback((message: string) => {
    nextId.current += 1;
    const id = `notice-${nextId.current}`;
    setNotices(current => {
      // The same sentence already on screen is the same news. Repeating it
      // stacks identical rows for one retried action and pushes the rest of
      // the shell down for no added information.
      if (current.some(notice => notice.message === message)) return current;
      return [...current, { id, message }];
    });
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setNotices(current => current.filter(notice => notice.id !== id));
  }, []);

  return { notices, raise, dismiss };
}

/**
 * The notices, or nothing at all.
 *
 * The container is ALWAYS mounted, and only its rows come and go. A polite
 * live region has to exist before its content changes: unlike `role="alert"`,
 * one inserted already carrying its message is not reliably announced, so a
 * screen-reader user could miss the only report that a class was not created.
 * Empty it holds no rows and has no box of its own, so the layout carries no
 * permanent gap for a surface that is silent almost always.
 *
 * `role="status"` rather than `role="alert"`: these are reports about an action
 * the author already took, and `alert` interrupts a screen reader mid-sentence
 * for something that is not an emergency. `aria-live="polite"` follows from it
 * and is stated anyway, because the implicit value differs between engines.
 */
export function BuilderNoticeRegion({
  notices,
  onDismiss,
}: {
  notices: readonly BuilderNotice[];
  onDismiss: (id: string) => void;
}): React.ReactElement | null {
  return (
    <div
      className="nx-notices"
      role="status"
      aria-live="polite"
      /*
       * `role="status"` is atomic by default, so adding one notice makes a
       * screen reader read every notice on screen again. False announces the
       * row that changed and leaves the rest alone.
       */
      aria-atomic="false"
    >
      {notices.map(notice => (
        <div className="nx-notices__item" key={notice.id}>
          <p className="nx-notices__text">{notice.message}</p>
          <Button
            className="nx-notices__dismiss"
            onClick={() => onDismiss(notice.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}
