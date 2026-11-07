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
