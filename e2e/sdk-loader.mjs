// The opt-in live harness loads generated code with the same runtime as the existing SDK.
// This loader is never registered by the published library or the ordinary test command.
let anchor;
let assets;
let helperSources;

export function initialize(options) {
  ({ anchor, assets, helperSources } = options);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@midnight-ntwrk/compact-runtime' && context.parentURL?.startsWith(assets)) {
    return nextResolve(specifier, { ...context, parentURL: anchor });
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Existing helper TypeScript uses .js relative imports intended for a transpiling runner.
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || !specifier.endsWith('.js') ||
        !context.parentURL?.startsWith(helperSources)) throw error;
    const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (!target.href.startsWith(helperSources)) throw error;
    return nextResolve(target.href, context);
  }
}
