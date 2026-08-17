import assert from "node:assert/strict";
import test from "node:test";
import {
  KIMI_IMAGE_MODEL_IDS,
  imageInputOverrideMutations,
  providerActivationMutations,
} from "../lib/model-capabilities.js";

test("adds text and image input to every built-in Kimi Coding model", () => {
  const mutations = imageInputOverrideMutations(undefined);

  assert.equal(mutations.length, KIMI_IMAGE_MODEL_IDS.length);
  assert.deepEqual(
    mutations.map((mutation) => mutation.path.at(-2)),
    KIMI_IMAGE_MODEL_IDS,
  );
  for (const mutation of mutations) {
    assert.equal(mutation.op, "set");
    assert.deepEqual(mutation.value, ["text", "image"]);
  }
});

test("preserves explicit user model input overrides", () => {
  const section = {
    providers: {
      "kimi-coding": {
        modelOverrides: {
          k3: { input: ["text"] },
          "k3-256k": { input: ["text", "image"] },
          "kimi-for-coding": { input: [] },
        },
      },
    },
  };

  const mutations = imageInputOverrideMutations(section);
  assert.deepEqual(
    mutations.map((mutation) => mutation.path.at(-2)),
    ["kimi-for-coding", "kimi-for-coding-highspeed"],
  );
});

test("activates the route and applies missing image capability overrides", () => {
  const mutations = providerActivationMutations({}, "KIMI_CODE_API_KEY");

  assert.deepEqual(mutations[0], {
    op: "set",
    path: ["providers", "kimi-coding", "apiKeyEnv"],
    value: "KIMI_CODE_API_KEY",
  });
  assert.equal(mutations.length, KIMI_IMAGE_MODEL_IDS.length + 1);
});
