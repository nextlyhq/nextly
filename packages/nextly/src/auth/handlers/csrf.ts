import { setCsrfCookie } from "../csrf/csrf-cookie.js";
import { generateCsrfToken } from "../csrf/generate.js";

export interface CsrfHandlerDeps {
  isProduction: boolean;
}

export async function handleCsrf(
  _request: Request,
  deps: CsrfHandlerDeps
): Promise<Response> {
  const token = generateCsrfToken();
  const cookie = setCsrfCookie(token, deps.isProduction);

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookie);

  return new Response(JSON.stringify({ data: { csrfToken: token } }), {
    status: 200,
    headers,
  });
}
