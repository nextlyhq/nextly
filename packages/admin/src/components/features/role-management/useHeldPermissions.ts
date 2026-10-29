import { useMemo } from "react";

/**
 * The role's permissions as the roles screen reads them: `owned`, the role's
 * own; `locked`, those its base roles give; and `held`, the two together,
 * which a row's level and a plugin's summary are read over. One derivation
 * for every part of the screen, so a row and its plugin's summary cannot read
 * the role differently.
 */
export function useHeldPermissions(
  value: readonly string[],
  lockedIds: readonly string[]
): {
  owned: ReadonlySet<string>;
  locked: ReadonlySet<string>;
  held: ReadonlySet<string>;
} {
  const owned = useMemo(() => new Set(value), [value]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const held = useMemo(
    () => new Set([...value, ...lockedIds]),
    [value, lockedIds]
  );
  return { owned, locked, held };
}
