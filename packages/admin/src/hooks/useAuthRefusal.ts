"use client";

import { useCallback, useState } from "react";

import { authRefusalOf, type AuthRefusal } from "@admin/lib/auth/auth-refusal";

export interface UseAuthRefusalReturn {
  /** The refusal to show, or null. */
  refusal: AuthRefusal | null;
  /** Forget the last refusal: called when the form is submitted again. */
  clear: () => void;
  /**
   * Keep a caught error if it is a refusal, and answer whether it was, so the
   * form's own message (a toast) is shown only for everything else.
   */
  take: (error: unknown) => boolean;
}

/**
 * The refusal a signed-out form is showing. One hook for every auth form, so
 * none of them reads a refusal differently or forgets to clear it on retry.
 */
export function useAuthRefusal(): UseAuthRefusalReturn {
  const [refusal, setRefusal] = useState<AuthRefusal | null>(null);

  const clear = useCallback(() => setRefusal(null), []);

  const take = useCallback((error: unknown) => {
    const found = authRefusalOf(error, window.location);
    setRefusal(found);
    return found !== null;
  }, []);

  return { refusal, clear, take };
}
