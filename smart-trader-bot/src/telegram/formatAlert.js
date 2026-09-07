function escapeMarkdownV2(text) {
  if (text == null) return '';
  return String(text).replace(/[_*[\]()\~`>#+=|{}.!\\-]/g, '\\$&');
}

// Inside a MarkdownV2 code/pre block, only backtick and backslash need
// escaping — none of the other reserved characters apply there.
function escapeCodeBlock(text) {
  if (text == null) return '';
  return String(text).replace(/[`\\]/g, '\\$&');
}

function fmtUsd(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  if (abs >= 1e6) return (num < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (num < 0 ? '-' : '') + '$' + (abs / 1e3).toFixed(0) + 'K';
  return (num < 0 ? '-' : '') + '$' + abs.toFixed(0);
}

// Whole-dollar fmtUsd loses meaningful precision on small demo balances
// (e.g. a $100 account) where cents actually matter. Use this instead for
// anything demo-related.
function fmtUsdPrecise(n) {
  const num = Number(n) || 0;
  return (num < 0 ? '-' : '') + '$' + Math.abs(num).toFixed(2);
}

function fmtPrice(n) {
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n) {
  const num = Number(n) || 0;
  return (num >= 0 ? '+' : '') + num.toFixed(1) + '%';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function formatOpenAlert({ trader, coin, side, entryPrice, positionUsd, time, leverage, liquidationPx }) {
  const isLong = side === 'long';
  const action = isLong ? '🟢 BUY / LONG' : '🔴 SELL / SHORT';
  const sideText = isLong ? 'LONG' : 'SHORT';

  const name = escapeMarkdownV2(trader.display_name);
  const coinSafe = escapeMarkdownV2(coin);
  const pnl = escapeMarkdownV2(fmtUsd(trader.pnl_30d_usd || 0));
  const win = escapeMarkdownV2(String(trader.win_rate_pct || '?'));
  const entry = escapeMarkdownV2(fmtPrice(entryPrice));
  const size = escapeMarkdownV2(fmtUsd(positionUsd));
  const t = escapeMarkdownV2(formatTime(time));

  const conviction =
    trader.account_value > 0
      ? escapeMarkdownV2(((positionUsd / trader.account_value) * 100).toFixed(1)) + '%'
      : null;

  let riskLines = '';
  if (leverage != null) {
    riskLines += `⚡ Leverage: *${escapeMarkdownV2(String(leverage))}x*\n`;
  }
  if (liquidationPx != null) {
    riskLines += `💥 Liquidation: *${escapeMarkdownV2(fmtPrice(liquidationPx))}*\n`;
  }

  return (
    `🚨 *NEW TRADE SIGNAL*\n\n` +
    `${action} — *${coinSafe}*\n\n` +
    `👤 Trader: *${name}*\n` +
    `📈 30D Profit: *\\+${pnl}*\n` +
    `🎯 Win Rate: *${win}%*\n\n` +
    `💰 Entry Price: *${entry}*\n` +
    `📦 Position Size: *${size}*` + (conviction ? ` \\(${conviction} of account\\)` : '') + `\n` +
    riskLines +
    `🕒 Time: ${t}\n\n` +
    `📋 *COPY SIGNAL* — _tap to copy_:\n` +
    '```\n' +
    `${escapeCodeBlock(coin)}\n` +
    `${escapeCodeBlock(sideText)}\n` +
    `Entry: ${escapeCodeBlock(Number(entryPrice).toFixed(2))}\n` +
    '```'
  );
}

function formatCloseAlert({ trader, coin, entryPrice, exitPrice, pnlUsd, heldMs }) {
  const held = formatDuration(heldMs);
  const profitEmoji = pnlUsd >= 0 ? '✅' : '❌';

  const name = escapeMarkdownV2(trader.display_name);
  const coinSafe = escapeMarkdownV2(coin);
  const entry = escapeMarkdownV2(fmtPrice(entryPrice));
  const exit = escapeMarkdownV2(fmtPrice(exitPrice));
  const pnl = escapeMarkdownV2(fmtUsd(pnlUsd));
  const heldSafe = escapeMarkdownV2(held);

  return (
    `${profitEmoji} *POSITION CLOSED* — ${coinSafe}\n\n` +
    `👤 Trader: *${name}*\n` +
    `Entry → Exit: ${entry} → ${exit}\n` +
    `PnL: *${pnlUsd >= 0 ? '\\+' : ''}${pnl}*\n` +
    `⏱ Held: ${heldSafe}`
  );
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return 'unknown';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

module.exports = {
  formatOpenAlert,
  formatCloseAlert,
  fmtUsd,
  fmtUsdPrecise,
  fmtPrice,
  fmtPct,
  formatDuration,
  escapeMarkdownV2,
  escapeCodeBlock,
};
