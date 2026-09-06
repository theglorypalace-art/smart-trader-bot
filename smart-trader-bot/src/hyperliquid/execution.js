const { ExchangeClient, InfoClient, HttpTransport } = require('@nktkas/hyperliquid');
const { privateKeyToAccount } = require('viem/accounts');
const { HYPERLIQUID_IS_TESTNET, DEFAULT_SLIPPAGE_PCT } = require('../config');

const transport = new HttpTransport({ isTestnet: HYPERLIQUID_IS_TESTNET });
const readOnlyInfo = new InfoClient({ transport });

// Hyperliquid's asset universe (index + size-decimal rules per coin) rarely
// changes — cache it instead of re-fetching on every single order.
let metaCache = null;
let metaCacheAt = 0;
const META_TTL_MS = 10 * 60 * 1000;

async function getAssetMeta() {
  if (metaCache && Date.now() - metaCacheAt < META_TTL_MS) return metaCache;
  const meta = await readOnlyInfo.meta();
  metaCache = meta.universe.map((u, index) => ({
    index,
    name: u.name,
    szDecimals: u.szDecimals,
  }));
  metaCacheAt = Date.now();
  return metaCache;
}

async function getAssetInfo(coin) {
  const universe = await getAssetMeta();
  const asset = universe.find((u) => u.name === coin);
  if (!asset) throw new Error(`Unknown Hyperliquid asset: ${coin}`);
  return asset;
}

async function getMidPrice(coin) {
  const mids = await readOnlyInfo.allMids();
  const mid = mids[coin];
  if (!mid) throw new Error(`No mid price available for ${coin}`);
  return Number(mid);
}

function roundSize(size, szDecimals) {
  const factor = 10 ** szDecimals;
  return Math.floor(size * factor) / factor;
}

// Hyperliquid prices: max 5 significant figures, and no more decimal places
// than (6 - szDecimals) for perps. This is a practical approximation, not
// a guarantee against every edge case — verify against current Hyperliquid
// docs before scaling this up.
function roundPrice(price, szDecimals) {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const rounded = Number(price.toFixed(maxDecimals));
  const sig5 = Number(rounded.toPrecision(5));
  return sig5;
}

// Places an aggressive IOC limit order that behaves like a market order,
// sized in USD, using the given agent wallet's private key to sign.
// Returns the raw Hyperliquid response — caller is responsible for
// checking whether it actually filled.
async function placeCopyOrder({ agentPrivateKey, coin, side, usdSize, slippagePct }) {
  const asset = await getAssetInfo(coin);
  const mid = await getMidPrice(coin);
  const slip = (slippagePct != null ? slippagePct : DEFAULT_SLIPPAGE_PCT) / 100;

  const isBuy = side === 'long';
  const limitPx = roundPrice(isBuy ? mid * (1 + slip) : mid * (1 - slip), asset.szDecimals);
  const rawSize = usdSize / mid;
  const size = roundSize(rawSize, asset.szDecimals);

  if (size <= 0) {
    throw new Error(`Computed order size rounds to zero (usdSize=${usdSize}, mid=${mid})`);
  }

  const wallet = privateKeyToAccount(agentPrivateKey);
  const exchange = new ExchangeClient({ transport, wallet });

  const result = await exchange.order({
    orders: [
      {
        a: asset.index,
        b: isBuy,
        p: String(limitPx),
        s: String(size),
        r: false,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  });

  return { result, size, limitPx, mid };
}

module.exports = { getAssetMeta, getAssetInfo, getMidPrice, placeCopyOrder, roundSize, roundPrice };
