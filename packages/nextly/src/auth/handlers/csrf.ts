// Body is `{ token }` per spec §7.6; the cookie carries the same
// value so the double-submit pattern remains intact.
import { respondData } from "../../api/response-shapes";
import { setCsrfCookie } from "../csrf/csrf-cookie";
import { generateCsrfToken } from "../csrf/generate";

export interface CsrfHandlerDeps {
  isProduction: boolean;
}

export async function handleCsrf(
  _request: Request,
  deps: CsrfHandlerDeps
): Promise<Response> {
  const token = generateCsrfToken();
  const cookie = setCsrfCookie(token, deps.isProduction);

  const headers = new Headers();
  headers.append("Set-Cookie", cookie);

  return respondData({ token }, { status: 200, headers });
}
