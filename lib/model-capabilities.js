const PROVIDER_ID = "kimi-coding";

// These are the models shipped by pi-ai's Kimi Coding catalog in the DSH
// rc.6 dependency line. Keep the provider capability explicit so a stale or
// drifted catalog cannot make DSH reject durable image blocks before pi-ai's
// existing Anthropic message converter sees them.
const KIMI_IMAGE_MODEL_IDS = Object.freeze([
  "k3",
  "k3-256k",
  "kimi-for-coding",
  "kimi-for-coding-highspeed",
]);

const IMAGE_INPUT_MODALITIES = Object.freeze(["text", "image"]);

function configuredInput(section, modelId) {
  return section?.providers?.[PROVIDER_ID]?.modelOverrides?.[modelId]?.input;
}

function imageInputOverrideMutations(section) {
  return KIMI_IMAGE_MODEL_IDS.flatMap((modelId) => {
    const input = configuredInput(section, modelId);
    // A non-empty user override is authoritative. In particular, preserve an
    // explicit text-only override for a gateway that intentionally lacks
    // vision support.
    if (Array.isArray(input) && input.length > 0) return [];
    return [{
      op: "set",
      path: ["providers", PROVIDER_ID, "modelOverrides", modelId, "input"],
      value: [...IMAGE_INPUT_MODALITIES],
    }];
  });
}

function providerActivationMutations(section, apiKeyRef) {
  return [
    {
      op: "set",
      path: ["providers", PROVIDER_ID, "apiKeyEnv"],
      value: apiKeyRef,
    },
    ...imageInputOverrideMutations(section),
  ];
}

export {
  IMAGE_INPUT_MODALITIES,
  KIMI_IMAGE_MODEL_IDS,
  imageInputOverrideMutations,
  providerActivationMutations,
};
