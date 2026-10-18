import { useEffect, useState } from "react";

import { publicApi } from "@admin/lib/api/publicApi";

/**
 * Whether this install's setup needs its setup token: in production, until it
 * has an administrator. Read from `/auth/setup-status`, which says only that
 * one is needed, never anything about it.
 *
 * A failed read answers `true`: the field then shows where the server may not
 * need it, which it ignores, rather than hiding where the server requires it,
 * which would leave the form unable to finish setup.
 */
export function useSetupTokenRequired(): boolean {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      let needed = true;
      try {
        const status = await publicApi.get<
          { requiresSetupToken?: boolean } | undefined
        >("/auth/setup-status");
        needed = status?.requiresSetupToken !== false;
      } catch {
        // Unreadable: ask for it (see above).
      }
      if (live) setRequired(needed);
    })();
    return () => {
      live = false;
    };
  }, []);
  return required;
}
