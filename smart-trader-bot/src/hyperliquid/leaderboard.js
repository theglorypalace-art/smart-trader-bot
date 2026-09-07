const {
  HYPERLIQUID_LEADERBOARD_URL,
  HYPERLIQUID_INFO_URL,
  MIN_PNL_30D_USD,
  MIN_WIN_RATE_PCT,
  MIN_ACCOUNT_VALUE_USD,
  MAX_TRACKED_TRADERS,
  MAX_ACTIVE_TRADERS,
  ACTIVITY_LOOKBACK_DAYS,
  MIN_ACTIVE_ACCOUNT_VALUE_USD,
  MIN_TRADES_PER_DAY,
  MEME_COINS,
  MAX_MEME_TRADERS,
  MEME_LOOKBACK_DAYS,
  MIN_MEME_TRADE_PCT,
  MIN_MEME_ACCOUNT_VALUE_USD,
  MIN_MEME_TRADES,
} = require('../config');

async function fetchLeaderboard() {
  const res = await fetch(HYPERLIQUID_LEADERBOARD_URL);
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const data = await res.json();
  return data.leaderboardRows || data;
}

async function fetchFills(address) {
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'userFills', user: address }),
  });
  if (!res.ok) return [];
  const fills = await res.json();
  return Array.isArray(fills) ? fills : [];
}

function winRateFromFills(fills) {
  let wins = 0;
  let losses = 0;
  for (const f of fills) {
    const pnl = Number(f.closedPnl);
    if (!pnl) continue;
    if (pnl > 0) wins += 1;
    else losses += 1;
  }
  const total = wins + losses;
  if (total < 5) return null;
  return Number(((wins / total) * 100).toFixed(1));
}

async function computeWinRate(address) {
  const fills = await fetchFills(address);
  return winRateFromFills(fills);
}

// Trades per day over the recent lookback window, plus a loose win rate
// if there's enough closed-trade history to compute one.
async function computeActivityStats(address, lookbackDays) {
  const fills = await fetchFills(address);
  const cutoff = Date.now() - lookbackDays * 24 * 3600 * 1000;
  const recent = fills.filter((f) => Number(f.time) >= cutoff);
  const tradesPerDay = Number((recent.length / lookbackDays).toFixed(1));
  const winRate = winRateFromFills(fills);
  return { tradesPerDay, winRate };
}

// What % of a trader's recent fills are in known meme coins, plus a
// sample-size count so a trader who's made 2 lucky meme trades out of 2
// total doesn't get treated the same as one with real meme-trading history.
async function computeMemeStats(address, lookbackDays) {
  const fills = await fetchFills(address);
  const cutoff = Date.now() - lookbackDays * 24 * 3600 * 1000;
  const recent = fills.filter((f) => Number(f.time) >= cutoff);
  if (!recent.length) return { memePct: 0, sampleSize: 0, winRate: null };

  const memeSet = new Set(MEME_COINS);
  const memeFills = recent.filter((f) => memeSet.has((f.coin || '').toUpperCase()));
  const memePct = Number(((memeFills.length / recent.length) * 100).toFixed(1));
  const winRate = winRateFromFills(memeFills.length >= 5 ? memeFills : fills);

  return { memePct, sampleSize: recent.length, winRate };
}

function pickWindow(row, window) {
  const perf = (row.windowPerformances || []).find(([w]) => w === window);
  return perf ? perf[1] : null;
}

function makeDisplayName(row, address) {
  if (row.displayName && row.displayName.trim()) {
    return row.displayName.trim().slice(0, 24);
  }
  return `Trader ${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function buildQualifiedTraderList(rows) {
  rows = rows || (await fetchLeaderboard());

  const candidates = rows
    .map((row) => {
      const month = pickWindow(row, 'month');
      const address = row.ethAddress || row.address;
      return {
        address,
        displayName: makeDisplayName(row, address),
        accountValue: Number(row.accountValue),
        pnl30d: month ? Number(month.pnl) : null,
        roi30d: month ? Number(month.roi) * 100 : null,
      };
    })
    .filter(
      (c) =>
        c.address &&
        c.pnl30d !== null &&
        c.pnl30d >= MIN_PNL_30D_USD &&
        c.accountValue >= MIN_ACCOUNT_VALUE_USD
    )
    .sort((a, b) => b.pnl30d - a.pnl30d)
    .slice(0, MAX_TRACKED_TRADERS * 3);

  const qualified = [];
  for (const c of candidates) {
    const winRate = await computeWinRate(c.address);
    if (winRate === null || winRate < MIN_WIN_RATE_PCT) continue;

    qualified.push({
      address: c.address,
      display_name: c.displayName,
      active: true,
      pool: 'quality',
      pnl_30d_usd: c.pnl30d,
      roi_30d_pct: c.roi30d,
      win_rate_pct: winRate,
      account_value: c.accountValue,
      stats_updated_at: new Date().toISOString(),
    });

    if (qualified.length >= MAX_TRACKED_TRADERS) break;
  }
  return qualified;
}

// Second, independent pool: traders ranked by how often they trade rather
// than by profit. Draws from the same leaderboard as a candidate universe
// (bounded, to keep API call volume sane), excludes anyone already in the
// quality pool, and keeps only those clearing a light activity + account
// value bar.
async function buildActiveTraderList(excludeAddresses, rows) {
  rows = rows || (await fetchLeaderboard());
  const exclude = new Set(excludeAddresses || []);
  const candidatePoolSize = MAX_ACTIVE_TRADERS * 4;

  const candidates = rows
    .map((row) => {
      const month = pickWindow(row, 'month');
      const address = row.ethAddress || row.address;
      return {
        address,
        displayName: makeDisplayName(row, address),
        accountValue: Number(row.accountValue),
        pnl30d: month ? Number(month.pnl) : null,
      };
    })
    .filter(
      (c) =>
        c.address &&
        !exclude.has(c.address) &&
        c.accountValue >= MIN_ACTIVE_ACCOUNT_VALUE_USD
    )
    .sort((a, b) => b.accountValue - a.accountValue)
    .slice(0, candidatePoolSize);

  const scored = [];
  for (const c of candidates) {
    const { tradesPerDay, winRate } = await computeActivityStats(c.address, ACTIVITY_LOOKBACK_DAYS);
    if (tradesPerDay < MIN_TRADES_PER_DAY) continue;

    scored.push({
      address: c.address,
      display_name: c.displayName,
      active: true,
      pool: 'activity',
      pnl_30d_usd: c.pnl30d,
      win_rate_pct: winRate,
      account_value: c.accountValue,
      trades_per_day: tradesPerDay,
      stats_updated_at: new Date().toISOString(),
    });
  }

  return scored.sort((a, b) => b.trades_per_day - a.trades_per_day).slice(0, MAX_ACTIVE_TRADERS);
}

// Third, independent pool: traders whose recent activity is concentrated
// in meme coins specifically, regardless of overall profitability. Draws
// from the same leaderboard candidate universe, excludes anyone already
// in the other two pools, and ranks by meme-focus percentage.
async function buildMemeTraderList(excludeAddresses, rows) {
  rows = rows || (await fetchLeaderboard());
  const exclude = new Set(excludeAddresses || []);
  const candidatePoolSize = MAX_MEME_TRADERS * 5;

  const candidates = rows
    .map((row) => {
      const month = pickWindow(row, 'month');
      const address = row.ethAddress || row.address;
      return {
        address,
        displayName: makeDisplayName(row, address),
        accountValue: Number(row.accountValue),
        pnl30d: month ? Number(month.pnl) : null,
      };
    })
    .filter(
      (c) =>
        c.address &&
        !exclude.has(c.address) &&
        c.accountValue >= MIN_MEME_ACCOUNT_VALUE_USD
    )
    .sort((a, b) => b.accountValue - a.accountValue)
    .slice(0, candidatePoolSize);

  const scored = [];
  for (const c of candidates) {
    const { memePct, sampleSize, winRate } = await computeMemeStats(c.address, MEME_LOOKBACK_DAYS);
    if (sampleSize < MIN_MEME_TRADES) continue;
    if (memePct < MIN_MEME_TRADE_PCT) continue;

    scored.push({
      address: c.address,
      display_name: c.displayName,
      active: true,
      pool: 'meme',
      pnl_30d_usd: c.pnl30d,
      win_rate_pct: winRate,
      account_value: c.accountValue,
      meme_pct: memePct,
      stats_updated_at: new Date().toISOString(),
    });
  }

  return scored.sort((a, b) => b.meme_pct - a.meme_pct).slice(0, MAX_MEME_TRADERS);
}

module.exports = {
  fetchLeaderboard,
  computeWinRate,
  computeActivityStats,
  computeMemeStats,
  buildQualifiedTraderList,
  buildActiveTraderList,
  buildMemeTraderList,
};
