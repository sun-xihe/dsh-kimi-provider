// dsh-kimi-provider — host-side plugin
// Thin Kimi Code integration for DeepSeek Harness:
//   - imports the existing Kimi Code CLI OAuth state
//   - keeps rotating OAuth tokens synchronized
//   - activates the built-in llm-pi-ai `kimi-coding` route
//   - leaves model discovery, image attachments, tools and streaming to DSH/pi-ai
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  ensureImageCapabilities as ensureImageCapabilitiesSetting,
  providerActivationMutations,
} from "./model-capabilities.js";

const name = "kimi-provider";
const inject = ["credentials", "settings"];

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
const REQUEST_TIMEOUT_MS = 30_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const SYNC_INTERVAL_MS = 60_000;
const LOCK_STALE_MS = 5 * 60 * 1000;

const KEY_REF = "KIMI_CODE_API_KEY";
const REFRESH_REF = "KIMI_CODE_REFRESH_TOKEN";
const SETTINGS_NS = "llm-pi-ai";
const PROVIDER_ID = "kimi-coding";
const API_KEY_SETTINGS_PATH = ["providers", PROVIDER_ID, "apiKeyEnv"];

function kimiHome() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
}

function kimiCredentialFile() {
  return path.join(kimiHome(), "credentials", "kimi-code.json");
}

function kimiCredentialLockFile() {
  return `${kimiCredentialFile()}.lock`;
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function friendlyError(error) {
  return error instanceof Error ? error.message : String(error);
}

function expiresAtMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1_000_000_000_000 ? n : n * 1000;
}

function readCliCredential() {
  const filename = kimiCredentialFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    return {
      raw: parsed,
      access: typeof parsed?.access_token === "string" ? parsed.access_token : "",
      refresh: typeof parsed?.refresh_token === "string" ? parsed.refresh_token : "",
      expires: expiresAtMs(parsed?.expires_at),
      scope: typeof parsed?.scope === "string" ? parsed.scope : undefined,
      tokenType: typeof parsed?.token_type === "string" ? parsed.token_type : undefined,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`读取 Kimi CLI 登录态失败: ${friendlyError(error)}`);
  }
}

function writeCliCredentialAtomic(current, credential) {
  const target = kimiCredentialFile();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    ...(current?.raw && typeof current.raw === "object" ? current.raw : {}),
    access_token: credential.access,
    refresh_token: credential.refresh,
    expires_at: Math.floor(credential.expires / 1000),
    expires_in: credential.expiresIn,
    scope: credential.scope ?? current?.scope ?? "kimi-code",
    token_type: credential.tokenType ?? current?.tokenType ?? "Bearer",
  };
  const tmp = path.join(dir, `.kimi-code.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod semantics.
  }
}

function lockIsStale(filename) {
  try {
    const info = JSON.parse(fs.readFileSync(filename, "utf8"));
    const when = typeof info?.time === "string" ? Date.parse(info.time) : Number.NaN;
    if (Number.isFinite(when)) return Date.now() - when > LOCK_STALE_MS;
  } catch {
    // Fall back to mtime below.
  }
  try {
    return Date.now() - fs.statSync(filename).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireCliCredentialLock() {
  const filename = kimiCredentialLockFile();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const fd = fs.openSync(filename, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }), "utf8");
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(filename);
        } catch {
          // Already released/removed.
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!lockIsStale(filename)) return null;
      try {
        fs.unlinkSync(filename);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function refreshAccessToken(refreshToken, signal) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: requestSignal(signal),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    if (/invalid_grant/i.test(text)) {
      throw new Error('Kimi refresh token 已失效，请重新执行 "kimi login"');
    }
    throw new Error(`Kimi token 刷新失败 (${response.status}): ${text.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Kimi token 接口返回无效 JSON: ${friendlyError(error)}`);
  }

  const access = typeof json?.access_token === "string" ? json.access_token : "";
  const refresh = typeof json?.refresh_token === "string" ? json.refresh_token : "";
  const expiresIn = Number(json?.expires_in);
  if (access.length === 0 || refresh.length === 0 || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Kimi token 刷新响应缺少必要字段");
  }
  return {
    access,
    refresh,
    expires: Date.now() + expiresIn * 1000,
    expiresIn,
    scope: typeof json?.scope === "string" ? json.scope : undefined,
    tokenType: typeof json?.token_type === "string" ? json.token_type : undefined,
  };
}

function makeRemoteMarker(methodName) {
  let initializer = null;
  Remote(methodName)(undefined, {
    private: false,
    static: false,
    name: methodName,
    addInitializer(cb) {
      initializer = cb;
    },
  });
  return initializer;
}

const REMOTE_METHODS = ["status", "importExisting", "syncNow", "logout"];

class KimiGateway extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, "kimiProvider");
    this.ctx = ctx;
    this.syncTask = null;
    this.abortController = null;
    this.lastCredential = null;
    this.lastError = null;

    for (const marker of REMOTE_METHODS.map(makeRemoteMarker)) marker?.call(this);

    this.ensureImageCapabilities().catch((error) => {
      this.ctx.logger.warn("kimi-provider: capability repair failed: %s", friendlyError(error));
    });
    this.maybeSync(true).catch(() => {});
    const timer = setInterval(() => {
      this.maybeSync(true).catch(() => {});
    }, SYNC_INTERVAL_MS);

    ctx.effect(() => async () => {
      clearInterval(timer);
      this.abortController?.abort();
      await this.syncTask?.catch(() => {});
    }, "kimi-provider: background sync cleanup");
  }

  async providerConfigured() {
    try {
      const section = await this.ctx.settings.get(SETTINGS_NS);
      return section?.providers?.[PROVIDER_ID]?.apiKeyEnv === KEY_REF;
    } catch {
      return false;
    }
  }

  async ensureImageCapabilities() {
    return ensureImageCapabilitiesSetting(this.ctx.settings, KEY_REF);
  }

  async status() {
    const [accessRef, refreshRef, configured] = await Promise.all([
      this.ctx.credentials.resolve(KEY_REF),
      this.ctx.credentials.resolve(REFRESH_REF),
      this.providerConfigured(),
    ]);
    let cli = null;
    try {
      cli = readCliCredential();
    } catch (error) {
      this.lastError = friendlyError(error);
    }
    return {
      ok: true,
      loggedIn: Boolean(accessRef?.value),
      hasRefresh: Boolean(refreshRef?.value),
      providerConfigured: configured,
      cliAvailable: Boolean(cli?.refresh),
      credentialPath: kimiCredentialFile(),
      expiresAt: this.lastCredential?.expires ?? cli?.expires ?? null,
      source: this.lastCredential?.source ?? (accessRef?.value ? "dsh-credential" : null),
      lastError: this.lastError,
    };
  }

  async importExisting() {
    try {
      const cli = readCliCredential();
      if (!cli?.refresh) {
        return { ok: false, error: `未找到可用的 Kimi CLI 登录态：${kimiCredentialFile()}（请先执行 \"kimi login\"）` };
      }
      await this.syncFromCli({ forceRefreshIfExpired: true, source: "kimi-cli" });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async syncNow() {
    try {
      await this.maybeSync(true, true);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async logout() {
    this.abortController?.abort();
    await this.syncTask?.catch(() => {});
    const results = await Promise.allSettled([
      this.ctx.credentials.unset(KEY_REF),
      this.ctx.credentials.unset(REFRESH_REF),
      this.ctx.settings.mutate(SETTINGS_NS, [{ op: "unset", path: API_KEY_SETTINGS_PATH }]),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      return {
        ok: false,
        error: `从 DSH 断开未完全成功: ${failures.map((result) => friendlyError(result.reason)).join("; ")}`,
      };
    }
    this.lastCredential = null;
    this.lastError = null;
    return { ok: true };
  }

  async activateProvider(access, refresh, meta = {}) {
    // Refresh tokens rotate. Store the new refresh token before the access token.
    await this.ctx.credentials.set(REFRESH_REF, refresh);
    await this.ctx.credentials.set(KEY_REF, access);
    const section = await this.ctx.settings.get(SETTINGS_NS);
    await this.ctx.settings.mutate(SETTINGS_NS, providerActivationMutations(section, KEY_REF));
    this.lastCredential = {
      expires: meta.expires ?? null,
      source: meta.source ?? "kimi-cli",
    };
    this.lastError = null;
  }

  async syncFromCli({ forceRefreshIfExpired = false, source = "kimi-cli" } = {}) {
    let cli = readCliCredential();
    if (!cli?.refresh) throw new Error(`Kimi CLI 登录态不存在：${kimiCredentialFile()}`);

    const shouldRefresh = !cli.access
      || cli.expires === null
      || cli.expires - Date.now() <= REFRESH_SKEW_MS
      || forceRefreshIfExpired && cli.expires <= Date.now();

    if (!shouldRefresh) {
      await this.activateProvider(cli.access, cli.refresh, { expires: cli.expires, source });
      return;
    }

    const release = acquireCliCredentialLock();
    if (release === null) {
      // Another Kimi process may be rotating the token. Re-read and sync if it already finished.
      await new Promise((resolve) => setTimeout(resolve, 500));
      cli = readCliCredential();
      if (cli?.access && cli?.refresh && cli.expires !== null && cli.expires > Date.now()) {
        await this.activateProvider(cli.access, cli.refresh, { expires: cli.expires, source: "kimi-cli-sync" });
        return;
      }
      throw new Error("Kimi 凭据正在被其他进程刷新，请稍后重试");
    }

    try {
      // Re-read after acquiring the shared lock; another process may have refreshed first.
      cli = readCliCredential();
      if (!cli?.refresh) throw new Error("Kimi CLI refresh_token 不存在");
      if (cli.access && cli.expires !== null && cli.expires - Date.now() > REFRESH_SKEW_MS) {
        await this.activateProvider(cli.access, cli.refresh, { expires: cli.expires, source: "kimi-cli-sync" });
        return;
      }
      const controller = this.abortController ?? new AbortController();
      const credential = await refreshAccessToken(cli.refresh, controller.signal);
      writeCliCredentialAtomic(cli, credential);
      await this.activateProvider(credential.access, credential.refresh, {
        expires: credential.expires,
        source: "kimi-oauth-refresh",
      });
      this.ctx.logger.info("kimi-provider: Kimi OAuth token refreshed and synced");
    } finally {
      release();
    }
  }

  async syncFromDshFallback() {
    const [accessRef, refreshRef] = await Promise.all([
      this.ctx.credentials.resolve(KEY_REF),
      this.ctx.credentials.resolve(REFRESH_REF),
    ]);
    if (!refreshRef?.value) return false;
    if (accessRef?.value && this.lastCredential?.expires && this.lastCredential.expires - Date.now() > REFRESH_SKEW_MS) {
      return true;
    }
    const controller = this.abortController ?? new AbortController();
    const credential = await refreshAccessToken(refreshRef.value, controller.signal);
    await this.activateProvider(credential.access, credential.refresh, {
      expires: credential.expires,
      source: "dsh-refresh",
    });
    return true;
  }

  async maybeSync(background = false, force = false) {
    if (this.syncTask) return this.syncTask;
    const controller = new AbortController();
    this.abortController = controller;
    const task = (async () => {
      try {
        const cli = readCliCredential();
        if (cli?.refresh) {
          const configured = await this.providerConfigured();
          const accessRef = await this.ctx.credentials.resolve(KEY_REF);
          const needsSync = force
            || !configured
            || !accessRef?.value
            || !cli.access
            || cli.expires === null
            || cli.expires - Date.now() <= REFRESH_SKEW_MS
            || accessRef.value !== cli.access;
          if (needsSync) await this.syncFromCli({ source: "kimi-cli-sync" });
          return;
        }
        if (force) {
          const ok = await this.syncFromDshFallback();
          if (!ok) throw new Error(`未找到 Kimi 登录态：${kimiCredentialFile()}`);
        }
      } catch (error) {
        this.lastError = friendlyError(error);
        if (!background && !controller.signal.aborted) throw error;
        if (!controller.signal.aborted) this.ctx.logger.warn("kimi-provider: sync failed: %s", friendlyError(error));
      }
    })().finally(() => {
      if (this.syncTask === task) this.syncTask = null;
      if (this.abortController === controller) this.abortController = null;
    });
    this.syncTask = task;
    return task;
  }
}

KimiGateway.inject = inject;

export { KimiGateway, KimiGateway as default, inject, name };
