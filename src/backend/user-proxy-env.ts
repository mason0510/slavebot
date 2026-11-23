/**
 * The proxy environment the next assistant process should inherit.
 *
 * Guarantees: the first apply snapshots the process proxy keys, and a later clear puts those
 * values back. `userProxyChildEnv` is the overlay for a spawn that does not copy `process.env`.
 * An empty overlay does not delete a shell proxy that this module never set. Does not prove
 * the proxy can reach a host, and does not log the values.
 */

const PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

let snapshot: Partial<Record<(typeof PROXY_KEYS)[number], string | undefined>> | null = null;
let current: Record<string, string> = {};

/**
 * Replace the process proxy keys with `env`. Guarantees keys absent from `env` return to the
 * snapshot taken on the first call. Does not touch any other environment variable.
 */
export function applyUserProxyProcessEnv(env: Record<string, string>): void {
  if (!snapshot) {
    snapshot = {};
    for (const key of PROXY_KEYS) snapshot[key] = process.env[key];
  }
  current = { ...env };
  for (const key of PROXY_KEYS) {
    const value = env[key];
    if (value === undefined) {
      const saved = snapshot[key];
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Drop the overlay. Guarantees a shell proxy that was present before the first apply comes back.
 * A clear before any apply leaves `process.env` alone.
 */
export function clearUserProxyProcessEnv(): void {
  if (!snapshot) {
    current = {};
    return;
  }
  applyUserProxyProcessEnv({});
}

/**
 * The overlay for a child that does not inherit `process.env`. Guarantees an empty object when
 * the user proxy is off. Does not include unrelated variables.
 */
export function userProxyChildEnv(): Readonly<Record<string, string>> {
  return current;
}
