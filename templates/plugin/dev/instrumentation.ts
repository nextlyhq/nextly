// Warm up Nextly once per worker at startup (Node.js runtime only) so admin/API
// handlers never run before init and schema boot-apply runs once, not per request.
// Imported dynamically + guarded so nextly stays out of the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister } = await import("nextly");
  const { default: config } = await import("./nextly.config");
  await createRegister(config)();
}
