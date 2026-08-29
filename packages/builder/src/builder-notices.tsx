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
 * teaches them to ignore the region, so a control still mounted reports for
 * itself and stays silent here.
 *
 * @module builder-notices
 */
import { Button } from "@nextlyhq/ui";
import * as React from "react";

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
 * Renders no element when the list is empty rather than an empty container, so
 * the shell's layout does not carry a permanent gap for a surface that is
 * usually silent.
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
  if (notices.length === 0) return null;
  return (
    <div className="nx-notices" role="status" aria-live="polite">
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
