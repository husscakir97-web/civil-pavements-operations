// Deliberately inert during builds, development, edge, and ordinary app startup. Two explicit, independent runtime opt-ins; neither module is even imported
// unless its own variable is set in a production Node.js server that is not in a Next build phase. The modules then repeat a stronger, launcher-independent proof
// that this process is the generated standalone server (scripts/demo/standalone-runtime.mjs) and log a concise skip reason if it is not.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.EXISTING_TENANT_STATE_PROBE) {
    const { startStateProbe } = await import('./scripts/demo/state-probe.mjs');
    startStateProbe();
  }
  if (process.env.EXISTING_TENANT_RUNTIME_ENABLE === 'true' && process.env.EXISTING_TENANT_LOAD) {
    const { startRuntimeLoader } = await import('./scripts/demo/runtime-loader.mjs');
    startRuntimeLoader();
  }
}
