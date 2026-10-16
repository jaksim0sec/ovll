/**
 * 1014 prompt assembler (draft).
 * No model calls, IO policy or state transitions here.
 * `readText(relativePath)` is supplied by the server.
 */
export async function assemblePrompt(manifest, options) {
  const { layer, workroom, action, data = {}, readText } = options ?? {};
  if (!manifest || typeof manifest !== "object") throw new Error("Missing assembly manifest");
  if (typeof readText !== "function") throw new Error("readText(path) is required");

  const isWorkroom = layer === "workroom";
  const rule = isWorkroom ? manifest.workrooms : manifest.assemblies?.[layer];
  if (!rule) throw new Error(`Unknown layer: ${layer}`);

  let identifiers, required;
  if (isWorkroom) {
    if (!Object.hasOwn(rule.actions ?? {}, workroom)) throw new Error(`Unknown workroom: ${workroom}`);
    if (!rule.actions[workroom].includes(action)) throw new Error(`Unknown action: ${workroom}.${action}`);
    identifiers = rule.composition.map(s => s.replaceAll("<workroom>", workroom).replaceAll("<action>", action));
    required = rule.inputs;
  } else {
    identifiers = rule.parts;
    required = rule.inputs;
  }
  if (!Array.isArray(identifiers) || !Array.isArray(required)) throw new Error("Invalid assembly manifest");

  // Preserve the explicit JSON array order. Missing files never silently disappear.
  const chunks = [];
  for (const key of identifiers) {
    const filename = manifest.files?.[key];
    if (!filename || filename.startsWith("/") || filename.split("/").includes("..")) {
      throw new Error(`Unregistered or unsafe prompt key: ${key}`);
    }
    const raw = await readText(filename);
    if (typeof raw !== "string") throw new Error(`Cannot read prompt: ${filename}`);
    chunks.push(raw);
  }

  const missing = required.filter(key => !Object.hasOwn(data, key) || data[key] === undefined);
  if (missing.length) throw new Error(`Missing required runtime data: ${missing.join(", ")}`);

  const runtimeData = Object.fromEntries(required.map(key => [key, data[key]]));
  // focus is server-generated per call, not an editable request property.
  if (Object.hasOwn(data, "focus")) runtimeData.focus = data.focus;

  const slots = { ...data, inputData: runtimeData };
  // One-pass replacement prevents placeholders inside user content being interpreted.
  const replace = text => text.replace(/{{([a-zA-Z][a-zA-Z0-9]*)}}/g, (_, name) => {
    if (!Object.hasOwn(slots, name) || slots[name] === undefined) {
      throw new Error(`Unresolved prompt slot: ${name}`);
    }
    return JSON.stringify(slots[name]);
  });

  const contextTemplate = manifest.dataInsertion?.inputTemplate;
  if (typeof contextTemplate !== "string" || !contextTemplate.includes("{{inputData}}")) {
    throw new Error("Invalid inputTemplate; {{inputData}} is required");
  }
  const prompt = [...chunks, contextTemplate].map(replace).join("\n\n");
  return {
    prompt,
    parts: [...identifiers],
    expectedOutputs: rule.expectedOutputs ?? null,
    outputCases: rule.outputCases ?? null
  };
}
