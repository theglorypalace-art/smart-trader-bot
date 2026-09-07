require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

module.exports = {
  TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SERVICE_KEY: required('SUPABASE_SERVICE_KEY'),

  HYPERLIQUID_WS_URL: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
  HYPERLIQUID_INFO_URL: process.env.HYPERLIQUID_INFO_URL || 'https://api.hyperliquid.xyz/info',
  HYPERLIQUID_LEADERBOARD_URL:
    process.env.HYPERLIQUID_LEADERBOARD_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard',

  // Quality pool — top by profit + win rate (loosened for higher volume)
  MIN_PNL_30D_USD: Number(process.env.MIN_PNL_30D_USD || 10000),
  MIN_WIN_RATE_PCT: Number(process.env.MIN_WIN_RATE_PCT || 45),
  MIN_ACCOUNT_VALUE_USD: Number(process.env.MIN_ACCOUNT_VALUE_USD || 25000),
  MAX_TRACKED_TRADERS: Number(process.env.MAX_TRACKED_TRADERS || 30),

  // Activity pool — top by trade frequency, separate from the quality pool
  MAX_ACTIVE_TRADERS: Number(process.env.MAX_ACTIVE_TRADERS || 20),
  ACTIVITY_LOOKBACK_DAYS: Number(process.env.ACTIVITY_LOOKBACK_DAYS || 2),
  MIN_ACTIVE_ACCOUNT_VALUE_USD: Number(process.env.MIN_ACTIVE_ACCOUNT_VALUE_USD || 10000),
  MIN_TRADES_PER_DAY: Number(process.env.MIN_TRADES_PER_DAY || 3),

  // Meme-coin pool — traders whose activity is concentrated in meme coins,
  // separate from both pools above. Ranked by how meme-focused they are,
  // not by overall profit.
  MEME_COINS: (process.env.MEME_COINS || 'DOGE,SHIB,PEPE,WIF,BONK,FLOKI,MEME,POPCAT,MOG,BRETT,WOJAK,TURBO')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  MAX_MEME_TRADERS: Number(process.env.MAX_MEME_TRADERS || 15),
  MEME_LOOKBACK_DAYS: Number(process.env.MEME_LOOKBACK_DAYS || 7),
  MIN_MEME_TRADE_PCT: Number(process.env.MIN_MEME_TRADE_PCT || 30), // % of a trader's fills that must be meme coins
  MIN_MEME_ACCOUNT_VALUE_USD: Number(process.env.MIN_MEME_ACCOUNT_VALUE_USD || 5000),
  MIN_MEME_TRADES: Number(process.env.MIN_MEME_TRADES || 5), // minimum sample size before judging meme %

  // Refresh leaderboard every 15 minutes
  TRADER_REFRESH_INTERVAL_MS: Number(process.env.TRADER_REFRESH_INTERVAL_MS || 15 * 60 * 1000),

  // Comma-separated Telegram chat IDs allowed to run admin commands like /customers
  ADMIN_CHAT_IDS: (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),

  // ============================================================
  // AUTO-TRADING — every default here is the SAFE default.
  // Real mainnet trading requires explicitly setting two env vars.
  // ============================================================
  AUTO_TRADE_ENABLED: process.env.AUTO_TRADE_ENABLED === 'true', // global kill switch, OFF by default
  HYPERLIQUID_IS_TESTNET: process.env.HYPERLIQUID_IS_TESTNET !== 'false', // testnet by default
  MAX_CAPITAL_PCT_ALLOWED: Number(process.env.MAX_CAPITAL_PCT_ALLOWED || 20), // hard ceiling on /capital
  DEFAULT_SLIPPAGE_PCT: Number(process.env.DEFAULT_SLIPPAGE_PCT || 1), // IOC limit price buffer
  MEME_SLIPPAGE_PCT: Number(process.env.MEME_SLIPPAGE_PCT || 4), // wider buffer for thin/volatile meme books
};
