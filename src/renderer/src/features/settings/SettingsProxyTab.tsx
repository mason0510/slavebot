import type { UserProxyChange, UserProxyPreference } from "@openbot/contracts/ipc";
import {
  Button,
  CircleCheck,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  SwitchField,
  Trash2,
} from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";

const EMPTY: UserProxyPreference = {
  enabled: false,
  source: "none",
  scheme: "none",
  host: "",
  port: 0,
  accepting: false,
  pingMs: null,
  error: null,
};

/**
 * The saved address as the panel shows it. Guarantees `::1` is `[::1]:port`.
 * An empty host is an empty string. Does not prove the port is open.
 */
function proxyHopLabel(value: UserProxyPreference): string {
  if (value.host === "") return "";
  const host = value.host.includes(":") && !value.host.startsWith("[") ? `[${value.host}]` : value.host;
  return `${host}:${value.port}`;
}

/**
 * The proxy panel. Guarantees a failed load does not write, so an empty view cannot replace a
 * saved hop. A successful add clears the draft. The delay shown is the local connect time.
 * Does not offer a calls switch, and does not accept a remote address in this panel.
 */
export function SettingsProxyTab() {
  const i18n = useI18n();
  const [preference, setPreference] = createSignal<UserProxyPreference>(EMPTY);
  const [draft, setDraft] = createSignal("");
  const [draftScheme, setDraftScheme] = createSignal<"http" | "socks5">("socks5");
  const [busy, setBusy] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);

  onSettled(() => {
    void window.openbot
      .getUserProxyPreference()
      .then((value) => {
        setPreference(value);
        setLoaded(true);
      })
      .catch(() => {
        setNotice(i18n.t("settings.preferences.loadFailed"));
      });
  });

  /**
   * Send one change. Guarantees a write in flight, or a failed load, does not send another.
   * Does not clear the draft unless the add was saved.
   */
  const write = (change: UserProxyChange) => {
    if (!loaded() || busy()) return;
    setBusy(true);
    setNotice(null);
    void window.openbot
      .setUserProxyPreference(change)
      .then((next) => {
        setPreference(next);
        if (change.action === "manual" && next.error === null) setDraft("");
      })
      .catch(() => {
        setNotice(i18n.t("settings.preferences.saveFailed"));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const statusText = () => {
    const value = preference();
    if (value.host === "") return i18n.t("settings.proxy.status.empty");
    if (!value.enabled) return i18n.t("settings.proxy.status.off");
    if (!value.accepting) return i18n.t("settings.proxy.status.closed");
    const scheme =
      value.scheme === "http" ? i18n.t("settings.proxy.scheme.http") : i18n.t("settings.proxy.scheme.socks5");
    if (value.pingMs === null) return i18n.t("settings.proxy.status.connectedNoPing", { scheme });
    return i18n.t("settings.proxy.status.connected", { scheme, ms: value.pingMs });
  };

  const errorText = () => {
    const error = preference().error;
    if (error === "remote") return i18n.t("settings.proxy.error.remote");
    if (error === "invalid") return i18n.t("settings.proxy.error.invalid");
    if (error === "none-found") return i18n.t("settings.proxy.error.noneFound");
    return null;
  };

  return (
    <SettingsSection title={i18n.t("settings.tab.proxy.title")}>
      <ItemGroup class="settings-modal-card">
        <SwitchField
          data-settings-row="settings.proxy.enabled.title"
          checked={preference().enabled}
          disabled={!loaded() || busy()}
          onChange={(enabled) => write({ action: "enabled", enabled })}
          label={i18n.t("settings.proxy.enabled.title")}
          description={i18n.t("settings.proxy.enabled.description")}
        />
        <Item data-settings-row="settings.proxy.add.title" class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.proxy.add.title")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.proxy.add.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <div class="settings-proxy-actions">
              <Input
                spellcheck={false}
                placeholder={i18n.t("settings.proxy.placeholder")}
                value={draft()}
                disabled={!loaded() || busy()}
                onValueChange={setDraft}
              />
              <Button
                type="button"
                variant={draftScheme() === "socks5" ? "secondary" : "ghost"}
                disabled={!loaded() || busy()}
                onClick={() => setDraftScheme("socks5")}
              >
                {i18n.t("settings.proxy.scheme.socks5")}
              </Button>
              <Button
                type="button"
                variant={draftScheme() === "http" ? "secondary" : "ghost"}
                disabled={!loaded() || busy()}
                onClick={() => setDraftScheme("http")}
              >
                {i18n.t("settings.proxy.scheme.http")}
              </Button>
              <Button
                type="button"
                disabled={!loaded() || busy() || draft().trim() === ""}
                onClick={() => write({ action: "manual", text: draft(), scheme: draftScheme() })}
              >
                {i18n.t("settings.proxy.add.action")}
              </Button>
            </div>
          </ItemActions>
        </Item>
        <Item data-settings-row="settings.proxy.detect.title" class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.proxy.detect.title")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.proxy.detect.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button type="button" disabled={!loaded() || busy()} onClick={() => write({ action: "detect" })}>
              {i18n.t("settings.proxy.detect.action")}
            </Button>
          </ItemActions>
        </Item>
        <Show when={preference().host !== ""}>
          <Item class="settings-modal-row">
            <ItemContent>
              <div class="settings-proxy-hop">
                <Show when={preference().accepting}>
                  <CircleCheck aria-hidden="true" />
                </Show>
                <ItemTitle>{proxyHopLabel(preference())}</ItemTitle>
              </div>
            </ItemContent>
            <ItemActions>
              <IconButton
                label={i18n.t("settings.proxy.delete")}
                disabled={!loaded() || busy()}
                onClick={() => write({ action: "clear" })}
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </ItemActions>
          </Item>
        </Show>
        <p class="settings-proxy-status" aria-live="polite">
          {statusText()}
        </p>
        <Show when={errorText()}>
          {(text) => <p class="settings-proxy-status">{text()}</p>}
        </Show>
        <Show when={notice()}>
          {(text) => <p class="settings-proxy-status">{text()}</p>}
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
