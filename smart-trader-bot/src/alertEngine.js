const db = require('./db/supabase');
const { formatOpenAlert, formatCloseAlert, escapeMarkdownV2, fmtUsd, fmtUsdPrecise, fmtPct } = require('./telegram/formatAlert');
const { fetchLivePositionsByCoin, getAccountValue } = require('./hyperliquid/positions');
const { placeCopyOrder } = require('./hyperliquid/execution');
const { decryptSecret } = require('./crypto');
const { AUTO_TRADE_ENABLED } = require('./config');

function classify(dir) {
  const d = (dir || '').toLowerCase();
  if (d.startsWith('open long')) return { action: 'open', side: 'long' };
  if (d.startsWith('open short')) return { action: 'open', side: 'short' };
  if (d.startsWith('close long')) return { action: 'close', side: 'long' };
  if (d.startsWith('close short')) return { action: 'close', side: 'short' };
  if (d.includes('long > short')) return { action: 'flip', from: 'long', to: 'short' };
  if (d.includes('short > long')) return { action: 'flip', from: 'short', to: 'long' };
  return { action: 'ignore' };
}

async function processFill(fill, traderAddress, bot) {
  if (fill.tid == null) return;
  if (await db.isFillSeen(fill.tid)) return;
  await db.markFillSeen(fill.tid);

  const trader = await db.getTrader(traderAddress);
  if (!trader || !trader.active) return;

  const coin = fill.coin;
  const px = Number(fill.px);
  const sz = Number(fill.sz);
  const positionUsd = px * sz;
  const info = classify(fill.dir);

  if (info.action === 'open') {
    await db.upsertOpenPosition({
      trader_address: traderAddress,
      coin,
      side: info.side,
      entry_price: px,
      size: sz,
      opened_at: new Date(fill.time).toISOString(),
    });
    const liveByCoin = await fetchLivePositionsByCoin(traderAddress);
    const live = liveByCoin[coin] || {};
    await broadcast(bot, coin, traderAddress, formatOpenAlert({
      trader,
      coin,
      side: info.side,
      entryPrice: px,
      positionUsd,
      time: fill.time,
      leverage: live.leverage,
      liquidationPx: live.liquidationPx,
    }), trader, { side: info.side, px });
    await executeAutoCopyTrades(bot, coin, info.side, traderAddress, px).catch((err) =>
      console.error('[auto-copy] unexpected error:', err.message)
    );
    return;
  }

  if (info.action === 'close') {
    const existing = await db.getOpenPosition(traderAddress, coin);
    const entryPrice = existing ? existing.entry_price : px;
    const openedAt = existing ? new Date(existing.opened_at).getTime() : null;
    const heldMs = openedAt ? fill.time - openedAt : null;
    await db.clearOpenPosition(traderAddress, coin);
    await broadcast(bot, coin, traderAddress, formatCloseAlert({
      trader, coin, entryPrice, exitPrice: px,
      pnlUsd: Number(fill.closedPnl) || 0, heldMs
    }), trader);
    await settleDemoPositions(bot, coin, traderAddress, px).catch((err) =>
      console.error('[auto-copy] demo settle error:', err.message)
    );
    return;
  }

  if (info.action === 'flip') {
    const existing = await db.getOpenPosition(traderAddress, coin);
    if (existing) {
      const heldMs = Date.now() - new Date(existing.opened_at).getTime();
      await broadcast(bot, coin, traderAddress, formatCloseAlert({
        trader, coin,
        entryPrice: existing.entry_price,
        exitPrice: px,
        pnlUsd: Number(fill.closedPnl) || 0,
        heldMs
      }), trader);
    }
    await settleDemoPositions(bot, coin, traderAddress, px).catch((err) =>
      console.error('[auto-copy] demo settle error:', err.message)
    );
    await db.upsertOpenPosition({
      trader_address: traderAddress,
      coin,
      side: info.to,
      entry_price: px,
      size: sz,
      opened_at: new Date(fill.time).toISOString(),
    });
    const liveByCoin = await fetchLivePositionsByCoin(traderAddress);
    const live = liveByCoin[coin] || {};
    await broadcast(bot, coin, traderAddress, formatOpenAlert({
      trader,
      coin,
      side: info.to,
      entryPrice: px,
      positionUsd,
      time: fill.time,
      leverage: live.leverage,
      liquidationPx: live.liquidationPx,
    }), trader, { side: info.to, px });
    await executeAutoCopyTrades(bot, coin, info.to, traderAddress, px).catch((err) =>
      console.error('[auto-copy] unexpected error:', err.message)
    );
  }
}

async function broadcast(bot, coin, traderAddress, message, trader, signalData = null) {
  // Get people following the coin OR this specific trader
  const [coinSubs, traderSubs] = await Promise.all([
    db.getSubscribersForCoin(coin.toUpperCase()),
    db.getSubscribersForTrader(traderAddress),
  ]);

  const allChatIds = [...new Set([...coinSubs, ...traderSubs])];

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔍 View Trader', url: `https://app.hyperliquid.xyz/explorer/address/${traderAddress}` },
        { text: '➕ Follow Trader', callback_data: `follow_trader:${traderAddress}` }
      ]
    ]
  };

  if (signalData) {
    keyboard.inline_keyboard.push([
      { text: '📋 Copy Signal', callback_data: `copy_signal:${coin}:${signalData.side}:${signalData.px}` }
    ]);
  }

  await Promise.all(
    allChatIds.map((chatId) =>
      bot.sendMessage(chatId, message, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
        disable_web_page_preview: true,
      }).catch((err) => console.error(`[telegram] failed to send to ${chatId}:`, err.message))
    )
  );
}

async function executeAutoCopyTrades(bot, coin, side, traderAddress, px) {
  let chatIds;
  try {
    chatIds = await db.getAutoCopySubscribers(traderAddress);
  } catch (err) {
    console.error('[auto-copy] failed to load subscribers:', err.message);
    return;
  }
  if (!chatIds.length) return;

  for (const chatId of chatIds) {
    try {
      const account = await db.getTradingAccount(chatId);
      if (!account || !account.auto_trade_enabled) continue;

      if (account.is_demo) {
        await simulateDemoOpen(bot, account, coin, side, traderAddress, px);
        continue;
      }

      if (!AUTO_TRADE_ENABLED) continue; // global kill switch — real trading only

      const accountValue = await getAccountValue(account.main_address);
      const rawUsdSize = accountValue * (Number(account.capital_pct) / 100);
      const usdSize = Math.min(rawUsdSize, Number(account.max_position_usd));

      if (!(usdSize > 0)) {
        await db.logTradeExecution({
          chat_id: chatId, trader_address: traderAddress, coin, side,
          usd_size: usdSize, status: 'failed',
          error_message: `Computed size non-positive (accountValue=${accountValue})`,
        });
        continue;
      }

      const agentPrivateKey = decryptSecret({
        ciphertext: account.agent_key_ciphertext,
        iv: account.agent_key_iv,
        tag: account.agent_key_tag,
      });

      const { result, size, limitPx } = await placeCopyOrder({
        agentPrivateKey, coin, side, usdSize,
      });

      await db.logTradeExecution({
        chat_id: chatId, trader_address: traderAddress, coin, side,
        usd_size: usdSize, order_result: result, status: 'submitted',
      });

      const coinSafe = escapeMarkdownV2(coin);
      const sideText = side === 'long' ? 'LONG' : 'SHORT';
      await bot.sendMessage(
        chatId,
        `🤖 *AUTO\\-COPY EXECUTED*\n\n` +
          `${sideText} ${coinSafe} — size ~${escapeMarkdownV2(fmtUsd(usdSize))} \\(${escapeMarkdownV2(String(size))} ${coinSafe}\\)\n` +
          `Order price: ${escapeMarkdownV2(String(limitPx))}\n\n` +
          `_Check Hyperliquid directly to confirm the fill\\._`,
        { parse_mode: 'MarkdownV2' }
      ).catch(() => {});
    } catch (err) {
      console.error(`[auto-copy] failed for chat ${chatId}:`, err.message);
      await db.logTradeExecution({
        chat_id: chatId, trader_address: traderAddress, coin, side,
        status: 'failed', error_message: err.message,
      }).catch(() => {});
      await bot.sendMessage(
        chatId,
        `⚠️ Auto\\-copy order failed for ${escapeMarkdownV2(coin)}: ${escapeMarkdownV2(err.message)}`,
        { parse_mode: 'MarkdownV2' }
      ).catch(() => {});
    }
  }
}

// Demo mode never touches Hyperliquid's exchange API — it just uses the
// real trader's own fill price (already known from the fill we're
// processing) to simulate an identical, instant entry with fake money.
async function simulateDemoOpen(bot, account, coin, side, traderAddress, px) {
  const chatId = account.chat_id;
  const usdSize = Math.min(
    Number(account.demo_balance) * (Number(account.capital_pct) / 100),
    Number(account.max_position_usd)
  );

  if (!(usdSize > 0)) {
    await db.logTradeExecution({
      chat_id: chatId, trader_address: traderAddress, coin, side,
      usd_size: usdSize, status: 'failed',
      error_message: `Demo balance too low (balance=${account.demo_balance})`,
    }).catch(() => {});
    return;
  }

  await db.upsertDemoPosition({
    chat_id: chatId, trader_address: traderAddress, coin,
    side, entry_price: px, usd_size: usdSize,
    opened_at: new Date().toISOString(),
  });

  await db.logTradeExecution({
    chat_id: chatId, trader_address: traderAddress, coin, side,
    usd_size: usdSize, status: 'demo_open',
  });

  const coinSafe = escapeMarkdownV2(coin);
  const sideText = side === 'long' ? 'LONG' : 'SHORT';
  await bot.sendMessage(
    chatId,
    `🧪 *DEMO AUTO\\-COPY OPENED*\n\n` +
      `${sideText} ${coinSafe} — ${escapeMarkdownV2(fmtUsdPrecise(usdSize))} \\(fake money\\)\n` +
      `Entry: ${escapeMarkdownV2(String(px))}\n` +
      `Demo balance: ${escapeMarkdownV2(fmtUsdPrecise(account.demo_balance))}`,
    { parse_mode: 'MarkdownV2' }
  ).catch(() => {});
}

// Settles any open demo position(s) across all demo-mode auto-copiers of
// this trader, whenever the real trader closes (or flips) that coin.
async function settleDemoPositions(bot, coin, traderAddress, exitPx) {
  let chatIds;
  try {
    chatIds = await db.getAutoCopySubscribers(traderAddress);
  } catch {
    return;
  }
  if (!chatIds.length) return;

  for (const chatId of chatIds) {
    try {
      const account = await db.getTradingAccount(chatId);
      if (!account || !account.is_demo) continue;

      const pos = await db.getDemoPosition(chatId, traderAddress, coin);
      if (!pos) continue;

      const direction = pos.side === 'long' ? 1 : -1;
      const pnlPct = ((exitPx - pos.entry_price) / pos.entry_price) * direction;
      const pnlUsd = pos.usd_size * pnlPct;
      const newBalance = Number(account.demo_balance) + pnlUsd;

      await db.clearDemoPosition(chatId, traderAddress, coin);
      await db.upsertTradingAccount(chatId, { demo_balance: newBalance });
      await db.logTradeExecution({
        chat_id: chatId, trader_address: traderAddress, coin, side: pos.side,
        usd_size: pos.usd_size, status: 'demo_close',
        error_message: `pnl=${pnlUsd.toFixed(2)}`,
      });

      const coinSafe = escapeMarkdownV2(coin);
      const pnlIcon = pnlUsd >= 0 ? '✅' : '❌';
      await bot.sendMessage(
        chatId,
        `🧪 *DEMO POSITION CLOSED* — ${coinSafe}\n\n` +
          `${pnlIcon} PnL: ${escapeMarkdownV2(fmtUsdPrecise(pnlUsd))} \\(${escapeMarkdownV2(fmtPct(pnlPct * 100))}\\)\n` +
          `New demo balance: *${escapeMarkdownV2(fmtUsdPrecise(newBalance))}*`,
        { parse_mode: 'MarkdownV2' }
      ).catch(() => {});
    } catch (err) {
      console.error(`[demo-settle] failed for chat ${chatId}:`, err.message);
    }
  }
}

module.exports = { processFill, classify };
