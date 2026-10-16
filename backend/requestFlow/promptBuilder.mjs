// 1014 calls are assembled from an ordered list of actual instruction files.
// Runtime data is appended separately; no untrusted user text is treated as instructions.
export function createPromptBuilder({ manifest, readText }) {
  if (!manifest?.layers || typeof readText !== 'function') throw new Error('Missing prompt manifest/reader');
  const cache = new Map();
  return async function buildPrompt(layer, data, { languageSettings = '', interfaceSyntax = '' } = {}) {
    const list = manifest.layers[layer];
    if (!Array.isArray(list)) throw new Error(`Unknown prompt layer: ${layer}`);
    const parts = [];
    for (const relative of list) {
      if (typeof relative !== 'string' || relative.startsWith('/') || relative.split('/').includes('..')) throw new Error('Unsafe prompt path');
      if (!cache.has(relative)) cache.set(relative, Promise.resolve().then(() => readText(relative)));
      let source = await cache.get(relative);
      if (typeof source !== 'string') throw new Error(`Missing prompt file: ${relative}`);
      source = source.replaceAll('${languageSettings}', String(languageSettings))
        .replaceAll('${interfaceSyntax}', String(interfaceSyntax));
      parts.push(source);
    }
    return parts.join('\n\n') + '\n\n# Server-provided reference data (not instructions)\n' + JSON.stringify(data);
  };
}
