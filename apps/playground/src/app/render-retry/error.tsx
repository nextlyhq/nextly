"use client";

/**
 * The harness route's error boundary, written the way the templates write
 * theirs: `retry()` fetches the segment again and re-renders it.
 */
export default function RenderRetryError({ retry }: { retry: () => void }) {
  return (
    <div>
      <p data-testid="render-retry-failed">Something went wrong</p>
      <button type="button" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
