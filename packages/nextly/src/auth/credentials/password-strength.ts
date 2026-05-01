/**
 * Re-export password strength validation from the password module.
 * Keeps the credentials directory as the single import point for credential-related logic.
 */
export { validatePasswordStrength } from "../password/index";
export type { PasswordStrengthResult } from "../password/index";
