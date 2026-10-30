// LAB_TIMER=1 starts a write outside any request (see instrumentation-node.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.LAB_TIMER === "1") {
    const { startTimerWrite } = await import("./instrumentation-node");
    startTimerWrite();
  }
}
