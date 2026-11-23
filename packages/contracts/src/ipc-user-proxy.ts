/** What the settings panel reads. `scheme` is `none` only when no hop is saved. */
export interface UserProxyPreference {
  enabled: boolean;
  source: "manual" | "auto" | "none";
  scheme: "http" | "socks5" | "none";
  host: string;
  port: number;
  /** True only when the switch is on and the local port accepted a connect. */
  accepting: boolean;
  /** Local connect time in milliseconds. Null when the port was not probed or the probe had no time. */
  pingMs: number | null;
  error: "remote" | "invalid" | "none-found" | null;
}

/** One change from the proxy panel. A failed manual or detect is not this type's saved hop. */
export type UserProxyChange =
  | { action: "enabled"; enabled: boolean }
  | { action: "manual"; text: string; scheme: "http" | "socks5" }
  | { action: "detect" }
  | { action: "clear" };
