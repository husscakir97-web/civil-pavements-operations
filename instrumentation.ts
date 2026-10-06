// Deliberately inert during builds, development, and ordinary app startup.
// Only the generated standalone server may opt into the existing guarded loader.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production' ||
      process.env.EXISTING_TENANT_RUNTIME_ENABLE !== 'true' || !process.env.EXISTING_TENANT_LOAD ||
      !process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) return;
  const { startRuntimeLoader } = await import('./scripts/demo/runtime-loader.mjs');
  startRuntimeLoader();
}
