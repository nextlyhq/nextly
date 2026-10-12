/**
 * The wire contract for `GET /auth/ui`, published so the admin login screen
 * need not restate it.
 *
 * The screen renders provider buttons, challenge views and form slots from
 * this shape. A copy written on the client agrees with the server only on the
 * day it is written; importing it makes a field the server adds a compile
 * error in every consumer that builds one.
 *
 * Types only, so a client that imports it pays for no server code.
 *
 * @module api/auth-ui-types
 */
export type { AuthUiMeta, AuthUiProvider } from "../auth/handlers/auth-ui";
