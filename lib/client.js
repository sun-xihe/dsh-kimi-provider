// dsh-kimi-provider — web client plugin
// Adds a Providers settings section for importing/syncing the existing Kimi Code CLI login.
window.__ModuleLoader__.load({
  id: "dsh-kimi-provider",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "settings.kimiProvider";

    function resultSchema(method) {
      return Object.freeze({
        parse(value) {
          if (!value || typeof value !== "object" || typeof value.ok !== "boolean") {
            throw new TypeError(`${method}: invalid remote result`);
          }
          if (method === "status" && value.ok) {
            if (typeof value.loggedIn !== "boolean" || typeof value.providerConfigured !== "boolean") {
              throw new TypeError("status: invalid provider state");
            }
          }
          return value;
        },
      });
    }

    const KIMI_REMOTE = Object.freeze({
      package: "dsh-kimi-provider",
      descriptors: ["status", "importExisting", "syncNow", "logout"].map((method) => ({
        id: `dsh-kimi-provider#kimiProvider/${method}`,
        service: "kimiProvider",
        namespace: "kimiProvider",
        method,
        invocation: { kind: "direct" },
        parameters: [],
        result: {
          mode: "strict",
          typeSymbol: `dsh-kimi-provider#kimiProvider/${method}:result`,
          schema: resultSchema(method),
        },
      })),
    });

    const zh = {
      nav: "供应商",
      title: "Kimi Code",
      subtitle: "复用 Kimi CLI OAuth · 使用 DSH 内置 kimi-coding provider",
      loggedIn: "已连接",
      loggedOut: "未连接",
      providerActive: "供应商已激活",
      providerInactive: "供应商未激活",
      cliFound: "已找到 Kimi CLI 登录态",
      cliMissing: "未找到 Kimi CLI 登录态",
      expires: "令牌过期",
      source: "来源",
      credentialPath: "登录态路径",
      import: "导入本机 Kimi CLI 登录态",
      sync: "立即同步",
      disconnect: "从 DSH 断开",
      disconnectConfirm: "确定从 DSH 断开 Kimi Code？这不会退出 Kimi CLI。",
      importHint: "读取 ~/.kimi-code/credentials/kimi-code.json，将 access token 写入 DSH Credentials，并激活 llm-pi-ai 的 kimi-coding 路由。",
      architectureHint: "模型调用仍由 DSH 官方 llm-pi-ai 处理，因此图片、工具调用、上下文和流式响应不会在本插件中重复实现。",
      cliLoginHint: "如果未找到登录态，请先在终端执行 kimi login。",
      successImport: "Kimi CLI 登录态已导入，kimi-coding 已激活。",
      successSync: "同步完成。",
      successDisconnect: "已从 DSH 断开；Kimi CLI 登录态保持不变。",
      working: "处理中…",
      unknown: "未知",
      refresh: "刷新状态",
      lastError: "最近错误",
    };

    const en = {
      nav: "Providers",
      title: "Kimi Code",
      subtitle: "Reuse Kimi CLI OAuth · use DSH's built-in kimi-coding provider",
      loggedIn: "Connected",
      loggedOut: "Not connected",
      providerActive: "Provider active",
      providerInactive: "Provider inactive",
      cliFound: "Kimi CLI login found",
      cliMissing: "Kimi CLI login not found",
      expires: "Token expires",
      source: "Source",
      credentialPath: "Credential path",
      import: "Import Kimi CLI login",
      sync: "Sync now",
      disconnect: "Disconnect from DSH",
      disconnectConfirm: "Disconnect Kimi Code from DSH? This does not sign out Kimi CLI.",
      importHint: "Reads ~/.kimi-code/credentials/kimi-code.json, stores the access token in DSH Credentials, and activates llm-pi-ai's kimi-coding route.",
      architectureHint: "Model calls stay on DSH's official llm-pi-ai path, so images, tools, context handling, and streaming are not reimplemented here.",
      cliLoginHint: "If no login is found, run kimi login in a terminal first.",
      successImport: "Kimi CLI login imported and kimi-coding activated.",
      successSync: "Sync complete.",
      successDisconnect: "Disconnected from DSH; Kimi CLI remains signed in.",
      working: "Working…",
      unknown: "Unknown",
      refresh: "Refresh status",
      lastError: "Last error",
    };

    const styles = {
      card: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        borderRadius: "12px",
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-bg-layer-2)",
        fontSize: "13px",
        color: "var(--dsw-alias-label-primary)",
      },
      head: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      title: { fontSize: "15px", fontWeight: 600, lineHeight: 1.4 },
      subtitle: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", marginTop: 2 },
      row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
      label: { color: "var(--dsw-alias-label-tertiary)", minWidth: 88 },
      value: { color: "var(--dsw-alias-label-primary)", fontWeight: 500 },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all" },
      hint: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 },
      error: { fontSize: "12px", color: "var(--dsw-alias-label-error)", lineHeight: 1.6 },
      success: { fontSize: "12px", color: "var(--dsw-alias-label-success, #22c55e)", lineHeight: 1.6 },
      actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
      dot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginRight: 6 },
      dotGreen: { background: "#22c55e" },
      dotGray: { background: "var(--dsw-alias-label-tertiary)" },
      notice: {
        fontSize: "12px",
        lineHeight: 1.6,
        color: "var(--dsw-alias-label-secondary)",
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-bg-module-platform)",
      },
    };

    function remoteValue(response, fallback) {
      if (!response?.ok) throw new Error(response?.error?.message || fallback);
      const value = response.value;
      if (!value?.ok) throw new Error(value?.error || fallback);
      return value;
    }

    function fmtTime(t, ts) {
      if (!ts) return t("unknown");
      return new Date(ts).toLocaleString();
    }

    function KimiProviderSection({ t, api }) {
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [error, setError] = React.useState(null);

      const refreshStatus = React.useCallback(async () => {
        try {
          const value = remoteValue(await api.status(), "status failed");
          setStatus(value);
          if (value.lastError) setError(value.lastError);
        } catch (e) {
          setError(String((e && e.message) || e));
        }
      }, [api]);

      React.useEffect(() => {
        refreshStatus();
      }, [refreshStatus]);

      const run = async (action, successMessage) => {
        setBusy(true);
        setNotice(null);
        setError(null);
        try {
          remoteValue(await action(), "operation failed");
          setNotice(successMessage);
          await refreshStatus();
        } catch (e) {
          setError(String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
      };

      const disconnect = async () => {
        if (!window.confirm(t("disconnectConfirm"))) return;
        await run(api.logout, t("successDisconnect"));
      };

      const loggedIn = Boolean(status?.loggedIn);
      const cliAvailable = Boolean(status?.cliAvailable);

      return React.createElement(
        "div",
        { style: styles.card },
        React.createElement(
          "div",
          { style: styles.head },
          React.createElement("div", { style: { flex: "1 1 260px" } },
            React.createElement("div", { style: styles.title }, t("title")),
            React.createElement("div", { style: styles.subtitle }, t("subtitle"))
          ),
          React.createElement("span", null,
            React.createElement("span", { style: { ...styles.dot, ...(loggedIn ? styles.dotGreen : styles.dotGray) } }),
            loggedIn ? t("loggedIn") : t("loggedOut")
          ),
          status?.providerConfigured
            ? React.createElement(primitives.Pill, { tone: "success" }, t("providerActive"))
            : React.createElement(primitives.Pill, { tone: "neutral" }, t("providerInactive"))
        ),

        React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, "Kimi CLI"),
          React.createElement("span", { style: styles.value }, cliAvailable ? t("cliFound") : t("cliMissing"))
        ),
        React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, t("credentialPath")),
          React.createElement("span", { style: { ...styles.value, ...styles.mono } }, status?.credentialPath || t("unknown"))
        ),
        loggedIn && React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, t("expires")),
          React.createElement("span", { style: styles.value }, fmtTime(t, status?.expiresAt))
        ),
        loggedIn && React.createElement("div", { style: styles.row },
          React.createElement("span", { style: styles.label }, t("source")),
          React.createElement("span", { style: styles.value }, status?.source || t("unknown"))
        ),

        React.createElement("div", { style: styles.actions },
          !loggedIn && React.createElement(primitives.Button, {
            onClick: () => run(api.importExisting, t("successImport")),
            disabled: busy,
            variant: "primary",
          }, busy ? t("working") : t("import")),
          loggedIn && React.createElement(primitives.Button, {
            onClick: () => run(api.syncNow, t("successSync")),
            disabled: busy,
            variant: "secondary",
          }, busy ? t("working") : t("sync")),
          loggedIn && React.createElement(primitives.Button, {
            onClick: disconnect,
            disabled: busy,
            variant: "danger",
          }, t("disconnect")),
          React.createElement(primitives.Button, {
            onClick: refreshStatus,
            disabled: busy,
            variant: "secondary",
          }, t("refresh"))
        ),

        !loggedIn && React.createElement("div", { style: styles.hint }, cliAvailable ? t("importHint") : t("cliLoginHint")),
        React.createElement("div", { style: styles.notice }, t("architectureHint")),
        notice && React.createElement("div", { style: styles.success }, notice),
        error && React.createElement("div", { style: styles.error }, `${t("lastError")}: ${error}`)
      );
    }

    async function apply(ctx) {
      const { slots, locale, remote } = ctx;
      const disposeRemote = await remote.$mount(KIMI_REMOTE);
      ctx.effect(() => locale.register(NS, { zh, en }), "kimi-provider-ui: dictionaries");
      const t = locale.bind(NS);
      ctx.inject(["remote.kimiProvider"], (scope) => {
        const injected = () => ({ api: scope.remote.kimiProvider });
        scope.slots.inject("settings.section", () => scope.slots.register({
          name: "settings.section",
          id: "kimi-provider",
          order: 15,
          label: () => t("nav"),
          locale: NS,
          inject: injected,
        }, KimiProviderSection));
      });
      return disposeRemote;
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "remote"];
    return module.exports;
  },
});
