/**
 * Fallback hook registry used when the caller does not supply one.
 *
 * `CollectionEntryService` and `SingleEntryService` both require a
 * `HookRegistry` parameter. Rather than making hooks optional on those
 * services, we provide a no-op implementation that silently drops every
 * call so the services can run unchanged.
 */

import type { HookRegistry } from "../../hooks/hook-registry";

export function createNoOpHookRegistry(): HookRegistry {
  return {
    register: () => {},
    execute: async () => {},
    getHooks: () => [],
    hasHooks: () => false,
    // Asked by every collection write before its in-transaction phase: none
    // is ever registered here, so the phase is never run.
    hasInTransaction: () => false,
    inTransactionRunners: () => [],
    clear: () => {},
  } as unknown as HookRegistry;
}
