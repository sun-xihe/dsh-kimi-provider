# dsh-kimi-provider

A thin Kimi Code provider integration for DeepSeek Harness (DSH).

The plugin deliberately does **not** implement its own LLM adapter. It reuses DSH's built-in `llm-pi-ai` adapter and pi-ai's built-in `kimi-coding` provider. That keeps model discovery, reasoning, tool calls, image attachments, context handling, and streaming on the upstream DSH/pi-ai path.

## Why

`kimi-tide` already proves Kimi Code OAuth works in DSH, but its v1 request conversion is text-only. DSH's official `llm-pi-ai` adapter already supports durable image attachments and converts them to pi-ai `ImageContent`, so duplicating that conversion layer is unnecessary.

`dsh-kimi-provider` only owns the credential/provider lifecycle:

```text
Kimi Code CLI
  ~/.kimi-code/credentials/kimi-code.json
            │
            ▼
dsh-kimi-provider
  OAuth sync / refresh / DSH Credentials
            │
            ▼
llm-pi-ai.providers.kimi-coding
            │
            ▼
DSH official PiAiAdapter
  text · image · tools · context · streaming
```

## Requirements

- Node.js >= 22
- `@deepseek-ai/dsh@0.1.0-rc.6` or a compatible release
- Kimi Code CLI installed and logged in once:

```bash
kimi login
```

The plugin reads `KIMI_CODE_HOME` when set, otherwise `~/.kimi-code`.

## Install

From a local checkout:

```bash
git clone https://github.com/sun-xihe/dsh-kimi-provider.git
cd dsh-kimi-provider
npm pack

dsh plugin --profile web add ./dsh-kimi-provider-0.1.0.tgz
```

Then restart `dsh web` and open Settings -> Providers -> Kimi Code.

## What v0.1 does

- imports the existing Kimi Code CLI OAuth state;
- stores the access/refresh tokens in DSH Credentials;
- activates `llm-pi-ai.providers.kimi-coding.apiKeyEnv`;
- refreshes Kimi OAuth tokens before expiry;
- uses the same credential lock file as Kimi CLI-compatible integrations to avoid refresh-token rotation races;
- writes rotated tokens back to the Kimi CLI credential file atomically;
- exposes a Web settings panel for status/import/sync/disconnect.

Disconnecting only removes the DSH credential references and provider activation. It does **not** sign out Kimi CLI.

## Multimodal behavior

This plugin does not transform images itself. When the pi-ai catalog advertises `image` input for the selected Kimi model, DSH's official attachment service resolves the image bytes and `llm-pi-ai` forwards them through the built-in provider.

That is the main architectural difference from implementing another custom Kimi adapter.

## Security

OAuth tokens are written to DSH Credentials, not settings. The Kimi CLI credential file is updated with mode `0600` on platforms that support POSIX permissions.

## License

MIT
