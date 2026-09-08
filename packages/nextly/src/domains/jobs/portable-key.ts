/**
 * The bound every key stored on a job row is held to, and the keys derived from
 * one another.
 *
 * A leaf module with no imports, so both the registry (which validates a slug
 * when a job type is DEFINED) and the repository (which validates it again when
 * a row is WRITTEN) can read the same number without either importing the other.
 *
 * They previously declared it separately — `MAX_JOB_SLUG_LENGTH` here and
 * `MAX_PORTABLE_KEY_LENGTH` there — and agreed only because both said 191. Two
 * constants for one limit is one edit away from a definition that is accepted
 * and an enqueue that refuses it, which for a sweep means a job type registered
 * and never run, with no error anywhere.
 *
 * @module domains/jobs/portable-key
 */

/**
 * The longest key MySQL will index in `varchar(191)` utf8mb4 — the narrowest of
 * the three dialects, so it is the bound all of them are held to. PostgreSQL and
 * SQLite would accept more; a slug that worked on two dialects and threw on the
 * third would be a portability bug discovered at enqueue time, on a scheduler
 * tick, with nobody watching.
 */
export const MAX_PORTABLE_KEY_LENGTH = 191;

/**
 * What a sweep's dedupe key is prefixed with.
 *
 * Lives beside the limit because it SPENDS part of it: a sweep's key is its slug
 * behind this prefix, and both are held to {@link MAX_PORTABLE_KEY_LENGTH}. A
 * sweep slug is therefore budgeted at {@link MAX_SWEEP_SLUG_LENGTH}, and pairing
 * the two here is what keeps that arithmetic from being restated somewhere it
 * can drift.
 */
export const SWEEP_KEY_PREFIX = "sweep:";

/**
 * The longest slug a SWEEP may carry, derived rather than written down.
 *
 * Deriving it is the point of this module. Written as its own number it would be
 * correct until somebody changed the prefix or the limit, and the failure it
 * guards against is silent.
 */
export const MAX_SWEEP_SLUG_LENGTH =
  MAX_PORTABLE_KEY_LENGTH - SWEEP_KEY_PREFIX.length;
