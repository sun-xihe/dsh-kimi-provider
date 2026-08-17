import assert from "node:assert/strict";
import test from "node:test";
import {
  KIMI_IMAGE_MODEL_IDS,
  ensureImageCapabilities,
  imageInputOverrideMutations,
  providerActivationMutations,
} from "../lib/model-capabilities.js";

const KEY_REF = "KIMI_CODE_API_KEY";

function fakeSettings(section) {
  const mutateCalls = [];
  return {
    mutateCalls,
    settings: {
      async get(namespace) {
        assert.equal(namespace, "llm-pi-ai");
        return section;
      },
      async mutate(namespace, mutations) {
        mutateCalls.push({ namespace, mutations });
      },
    },
  };
}

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

test("startup repairs missing image capabilities for an already configured provider", async () => {
  const { settings, mutateCalls } = fakeSettings({
    providers: {
      "kimi-coding": {
        apiKeyEnv: KEY_REF,
      },
    },
  });

  const changed = await ensureImageCapabilities(settings, KEY_REF);

  assert.equal(changed, true);
  assert.equal(mutateCalls.length, 1);
  assert.equal(mutateCalls[0].namespace, "llm-pi-ai");
  assert.deepEqual(
    mutateCalls[0].mutations.map((mutation) => mutation.path.at(-2)),
    KIMI_IMAGE_MODEL_IDS,
  );
  assert.ok(mutateCalls[0].mutations.every((mutation) => mutation.path.at(-1) === "input"));
});

test("startup repair preserves a user's non-empty text-only override", async () => {
  const { settings, mutateCalls } = fakeSettings({
    providers: {
      "kimi-coding": {
        apiKeyEnv: KEY_REF,
        modelOverrides: {
          k3: { input: ["text"] },
        },
      },
    },
  });

  const changed = await ensureImageCapabilities(settings, KEY_REF);

  assert.equal(changed, true);
  assert.equal(mutateCalls.length, 1);
  assert.deepEqual(
    mutateCalls[0].mutations.map((mutation) => mutation.path.at(-2)),
    KIMI_IMAGE_MODEL_IDS.filter((modelId) => modelId !== "k3"),
  );
});

test("startup repair ignores a provider not activated with the Kimi API key reference", async () => {
  const { settings, mutateCalls } = fakeSettings({
    providers: {
      "kimi-coding": {
        apiKeyEnv: "CUSTOM_KIMI_API_KEY",
      },
    },
  });

  const changed = await ensureImageCapabilities(settings, KEY_REF);

  assert.equal(changed, false);
  assert.deepEqual(mutateCalls, []);
});
