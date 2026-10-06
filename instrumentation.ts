// Deliberately inert during builds, development, and ordinary app startup.
// Only the generated standalone server may opt into the existing guarded loader.
export async function register() {
  // Filesystem-only persistence diagnostic: no database, no endpoint. Off unless
  // EXISTING_TENANT_STATE_PROBE is set; standalone production server only.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production' &&
      process.env.EXISTING_TENANT_STATE_PROBE && process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
    const { startStateProbe } = await import('./scripts/demo/state-probe.mjs');
    startStateProbe();
  }
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production' ||
      process.env.EXISTING_TENANT_RUNTIME_ENABLE !== 'true' || !process.env.EXISTING_TENANT_LOAD ||
      !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) return;
  const { startRuntimeLoader } = await import('./scripts/demo/runtime-loader.mjs');
  startRuntimeLoader();
}
