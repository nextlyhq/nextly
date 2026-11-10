/**
 * Wait out the quiet a route waits for before it logs a page's read
 * overrun, so a file whose pages outrun their caps ends after the line is
 * said, not while its worker is closing.
 *
 * It imports nothing, because the package's layering test holds every file
 * here that is not itself a test to the runtime allowlist.
 */
export async function afterOverrunLines(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 120));
}
