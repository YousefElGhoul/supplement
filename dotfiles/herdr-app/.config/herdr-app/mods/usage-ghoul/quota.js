const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WINDOWS = { session: 5 * HOUR, daily: DAY, weekly: 7 * DAY, billing: null };
const PROVIDERS = { claude: "Claude", codex: "OpenAI" };

export function quotaGroups(stats) {
  if (!Array.isArray(stats?.limits?.providers)) throw new Error("Invalid limits snapshot");
  return Object.entries(PROVIDERS).map(([id, label]) => {
    const accounts = stats.limits.providers.filter((provider) => provider?.provider === id);
    const rows = accounts.flatMap((provider, index) => {
      if (!Array.isArray(provider.windows)) return [];
      const account = accounts.length > 1 ? `Account ${index + 1} · ` : "";
      return Object.keys(WINDOWS).flatMap((kind) => provider.windows
        .filter((window) => window?.kind === kind && !window.additional && !window.metric &&
          window.showMeter !== false && Number.isFinite(window.remainingPercent))
        .map((window) => {
          const length = Number.isFinite(window.windowMinutes) && window.windowMinutes > 0
            ? window.windowMinutes * MINUTE : WINDOWS[kind];
          return {
            label: `${account}${length ? duration(length) : "Billing"}`,
            left: Math.max(0, Math.min(100, window.remainingPercent)),
            reset: Date.parse(window.resetsAt),
            length,
            stale: provider.stale === true || (provider.status != null && provider.status !== "ok"),
            observedAt: Date.parse(provider.updatedAt),
            maxAge: Number.isFinite(stats.staleAfterMs) && stats.staleAfterMs > 0 ? stats.staleAfterMs : 15 * MINUTE,
          };
        }));
    });
    return { id, label, rows };
  });
}

export function quotaTiming(row, now, disconnected = false) {
  const resetIn = row.reset - now;
  const stale = disconnected || row.stale || (Number.isFinite(row.observedAt) && now - row.observedAt > row.maxAge);
  if (stale || !(resetIn > 0 && resetIn <= row.length)) return { stale, resetIn };

  // Match OpenCode Quota's time-based even-use marker and 5-point pace band.
  const evenLeft = 100 * resetIn / row.length;
  const elapsed = row.length - resetIn;
  const fast = row.left < evenLeft - 5;
  const runsOutIn = fast && elapsed >= row.length / 10 && row.left > 0
    ? elapsed * (row.left / (100 - row.left)) : null;
  return { stale, resetIn, evenLeft, runsOutIn };
}

export function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  if (days) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours) return `${hours}h${rest ? ` ${rest}m` : ""}`;
  return `${rest}m`;
}
