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
import { documentRefKey } from "../../releases-repository";

registerCoreReleaseCheckSources();

export const READY_CHECKS: ReleaseDocumentChecks = {
  actingAs: async authorId => ({ id: authorId, roles: [] }),
  mayPerform: async () => true,
  existing: async refs => new Set(refs.map(documentRefKey)),
  publishProblems: async () => [],
  heldDraftLocales: async () => [],
};
