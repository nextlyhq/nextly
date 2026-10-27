/**
 * One complete version, as a package.json `version` holds it:
 * `0.0.2-alpha.66`. A range or a dist-tag names no one release, so it does
 * not match.
 */
export const EXACT_VERSION: RegExp = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
