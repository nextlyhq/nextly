/**
 * Readiness reads for a service built without the wiring: every document is
 * there, every author may act, and nothing fails validation. A suite about
 * something else then meets no readiness refusal it did not arrange, and a
 * suite about readiness overrides the one read it is testing.
 *
 * Core's sources are registered on import, as the releases registration does
 * at boot: a service with none refuses to check anything rather than pass.
 *
 * @module domains/releases/__tests__/helpers/ready-checks
 */
import { registerCoreReleaseCheckSources } from "../../readiness/core-sources";
import type { ReleaseDocumentChecks } from "../../services/releases-service";
import { perEntry } from "../../readiness/__tests__/helpers/readiness-fixtures";
import { documentRefKey } from "../../releases-repository";

registerCoreReleaseCheckSources();

export { perEntry };

export const READY_CHECKS: ReleaseDocumentChecks = {
  actingAs: async authorId => ({ id: authorId, roles: [] }),
  mayPerform: async (_user, _scope, _action, entryIds) => new Set(entryIds),
  existing: async refs => new Set(refs.map(documentRefKey)),
  publishProblems: perEntry(() => []),
  heldDraftLocales: perEntry(() => []),
  companionLacksLifecycle: async () => false,
};
