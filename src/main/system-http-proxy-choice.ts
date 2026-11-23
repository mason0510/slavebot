import type { UserProxySessionDecision } from "../backend/user-proxy-choice";

/**
 * Decide whether the running session keeps, clears, or replaces its machine proxy.
 *
 * Guarantees: the same accepting hop is `keep`. A different accepting hop is `apply`.
 * No accepting hop is `direct` when a hop is already applied, otherwise `keep`.
 * Does not probe TCP, read the OS, or call Electron. A closed port must already be absent
 * from `accepting`.
 */
export function proxyRefreshAction(
  appliedKey: string | null,
  accepting: { kind: "http" | "socks"; host: string; port: number } | null,
): "keep" | "direct" | "apply" {
  const next = accepting ? `${accepting.kind}:${accepting.host}:${accepting.port}` : null;
  if (next === appliedKey) return "keep";
  if (next === null) return "direct";
  return "apply";
}

export type UserProxyOverride = UserProxySessionDecision;
export type SessionProxyHop = { kind: "http" | "socks"; host: string; port: number };

/**
 * The hop the session should use.
 * Guarantees: a direct override ignores the OS hop, including a Japan node.
 * Null defers to the OS hop. A user hop is returned as-is and the OS hop is ignored.
 * Does not probe TCP.
 */
export function sessionHop(override: UserProxyOverride, osHop: SessionProxyHop | null): SessionProxyHop | null {
  if (override?.kind === "direct") return null;
  if (override) return override;
  return osHop;
}
