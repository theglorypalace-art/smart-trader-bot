const { HYPERLIQUID_INFO_URL } = require('../config');

// Raw clearinghouseState for a user — includes every open perp position
// with live leverage, liquidation price, and unrealized PnL.
async function fetchClearinghouseState(address) {
  const res = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: address }),
  });
  if (!res.ok) return null;
  return res.json();
}

// Returns { [coin]: { unrealizedPnl, positionValue, entryPx, liquidationPx,
//                      leverage, leverageType, returnOnEquityPct } }
// for every currently-open position of this trader. Safe to call even if
// the trader has since closed everything (returns {}).
async function fetchLivePositionsByCoin(address) {
  const map = {};
  let state;
  try {
    state = await fetchClearinghouseState(address);
  } catch {
    return map;
  }
  const assetPositions = (state && state.assetPositions) || [];

  for (const ap of assetPositions) {
    const pos = ap && ap.position;
    if (!pos || Number(pos.szi) === 0) continue;

    map[pos.coin] = {
      unrealizedPnl: Number(pos.unrealizedPnl) || 0,
      positionValue: Number(pos.positionValue) || 0,
      entryPx: Number(pos.entryPx) || 0,
      liquidationPx: pos.liquidationPx != null ? Number(pos.liquidationPx) : null,
      leverage: pos.leverage ? Number(pos.leverage.value) : null,
      leverageType: pos.leverage ? pos.leverage.type : null, // 'cross' or 'isolated'
      returnOnEquityPct: pos.returnOnEquity != null ? Number(pos.returnOnEquity) * 100 : null,
    };
  }

  return map;
}

// Returns the account's total margin-account value (in USD), used to size
// auto-copy trades as a % of the follower's own capital.
async function getAccountValue(address) {
  const state = await fetchClearinghouseState(address);
  const value = state && state.marginSummary && state.marginSummary.accountValue;
  return value != null ? Number(value) : 0;
}

module.exports = { fetchClearinghouseState, fetchLivePositionsByCoin, getAccountValue };
