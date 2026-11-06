/**
 * Calling something again and again until it says to stop: how Settings
 * follows a removal, or an undo, through the route that carries it on.
 *
 * @module admin/editor/follow-loop
 * @experimental
 */

/**
 * Call `next` now, then again after the wait it answers, until it answers
 * `null` or the loop is stopped. `next` is told whether the loop has been
 * stopped since it began, so an answer arriving after that changes nothing.
 * Answers the function that stops it, for an effect to return.
 */
export function followLoop(
  next: (stopped: () => boolean) => Promise<number | null>
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = async (): Promise<void> => {
    const wait = await next(() => stopped);
    if (wait !== null && !stopped) timer = setTimeout(() => void call(), wait);
  };
  void call();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
