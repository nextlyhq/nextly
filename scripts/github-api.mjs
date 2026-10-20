/**
 * Requests to the GitHub REST API from a workflow step's script, with the
 * headers each of them sends. One home, so the scripts that read and act on
 * runs cannot drift apart in how they ask.
 */

/**
 * One request, with a JSON body when one is given; the response is returned
 * as it came, for the caller to judge its status.
 */
export function githubRequest(path, { token, fetchImpl = fetch }, method = "GET", body = undefined) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body === undefined) return fetchImpl(`https://api.github.com/${path}`, { method, headers });
  headers["content-type"] = "application/json";
  return fetchImpl(`https://api.github.com/${path}`, { method, headers, body: JSON.stringify(body) });
}

/** A resource's JSON; any status but success throws, for the caller to turn into its safe answer. */
export async function githubJson(path, context) {
  const response = await githubRequest(path, context);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

/** A write with no body to read; any status but success throws. */
export async function githubWrite(path, context, method = "POST") {
  const response = await githubRequest(path, context, method);
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
}
