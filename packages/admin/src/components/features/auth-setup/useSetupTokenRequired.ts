import { useEffect, useState } from "react";

import { checkSetupTokenRequired } from "@admin/lib/auth/setup-status";

/**
 * Whether this install's setup needs its setup token: in production, until it
 * has an administrator. `undefined` until setup-status has answered, so the
 * form can wait rather than submit without a field the server requires.
 *
 * Read from the setup-status answer the route guards share, never fetched on
 * its own, so the form and the guards cannot disagree. A failed read answers
 * `true` (see checkSetupTokenRequired).
 */
export function useSetupTokenRequired(): boolean | undefined {
  const [required, setRequired] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void checkSetupTokenRequired().then(needed => {
      if (live) setRequired(needed);
    });
    return () => {
      live = false;
    };
  }, []);
  return required;
}
