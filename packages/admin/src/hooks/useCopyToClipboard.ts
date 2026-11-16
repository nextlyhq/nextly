import { useCallback, useEffect, useRef, useState } from "react";

import { UI } from "@admin/constants/ui";

/**
 * Copy a piece of text, and say for a moment that it was copied.
 *
 * `navigator.clipboard` is undefined in non-secure or policy-restricted contexts, and a write
 * can be rejected; either way `onRefused` is called, and without one nothing happens and the
 * text stays on screen to select by hand. A caller showing less than the whole text says so.
 */
export function useCopyToClipboard(
  text: string,
  onRefused?: () => void
): {
  copied: boolean;
  copy: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      onRefused?.();
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(
          () => setCopied(false),
          UI.COPY_FEEDBACK_TIMEOUT_MS
        );
      },
      () => {
        // Rejected (permissions).
        onRefused?.();
      }
    );
  }, [text, onRefused]);

  return { copied, copy };
}
