const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_BOT_TOKEN, ADMIN_CHAT_IDS, AUTO_TRADE_ENABLED, MAX_CAPITAL_PCT_ALLOWED, HYPERLIQUID_IS_TESTNET } = require('../config');
const db = require('../db/supabase');
const state = require('../state');
const { fetchLivePositionsByCoin } = require('../hyperliquid/positions');
const { encryptSecret } = require('../crypto');
const { fmtUsd, fmtUsdPrecise, fmtPrice, fmtPct, formatDuration, formatOpenAlert, escapeMarkdownV2 } = require('./formatAlert');

function createBot() {
  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  const mainMenu = {
    reply_markup: {
      keyboard: [
        [{ text: '🏆 Top 10 Traders' }, { text: '⚡ Most Active' }],
        [{ text: '🔥 Live Signals' }, { text: '📊 Open Positions' }],
        [{ text: '📋 My Following' }, { text: '📖 How it works' }],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };

  async function sendTop10(chatId) {
    const traders = await db.getActiveTradersByPool('quality');

    if (!traders.length) {
      return bot.sendMessage(chatId, 'No traders loaded yet. Please wait a minute and try again.', mainMenu);
    }

    const sorted = traders
      .sort((a, b) => (b.pnl_30d_usd || 0) - (a.pnl_30d_usd || 0))
      .slice(0, 10);

    let text = `🏆 *TOP 10 PROFITABLE TRADERS*\n_\\(Last 30 days\\)_\n\n`;

    sorted.forEach((t, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}\\.`;
      const name = escapeMarkdownV2(t.display_name);
      const pnl = escapeMarkdownV2(fmtUsd(t.pnl_30d_usd));
      const win = escapeMarkdownV2(String(t.win_rate_pct || '?'));
      text += `${medal} *${name}*\n`;
      text += `   \\+${pnl}  •  ${win}% win rate\n\n`;
    });

    const buttons = [];
    for (let i = 0; i < sorted.length; i += 2) {
      const row = [];
      row.push({
        text: `➕ ${sorted[i].display_name.slice(0, 14)}`,
        callback_data: `follow_trader:${sorted[i].address}`,
      });
      if (sorted[i + 1]) {
        row.push({
          text: `➕ ${sorted[i + 1].display_name.slice(0, 14)}`,
          callback_data: `follow_trader:${sorted[i + 1].address}`,
        });
      }
      buttons.push(row);
    }

    buttons.push([
      { text: '➕ Follow All Top 10', callback_data: 'follow_all_top' },
      { text: '🔄 Refresh', callback_data: 'refresh_traders' },
    ]);
    buttons.push([{ text: '⚡ See Most Active Traders', callback_data: 'show_active' }]);

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async function sendActiveTraders(chatId) {
    const traders = await db.getActiveTradersByPool('activity');

    if (!traders.length) {
      return bot.sendMessage(
        chatId,
        'No active traders loaded yet. Please wait a minute and try again.',
        mainMenu
      );
    }

    const sorted = traders
      .sort((a, b) => (b.trades_per_day || 0) - (a.trades_per_day || 0))
      .slice(0, 10);

    let text = `⚡ *MOST ACTIVE TRADERS*\n_\\(By trade frequency, last few days\\)_\n\n`;

    sorted.forEach((t, i) => {
      const name = escapeMarkdownV2(t.display_name);
      const freq = escapeMarkdownV2(String(t.trades_per_day));
      const winText =
        t.win_rate_pct != null ? `${escapeMarkdownV2(String(t.win_rate_pct))}% win rate` : 'win rate n/a';
      text += `${i + 1}\\. *${name}*\n`;
      text += `   🔁 ~${freq} trades/day  •  ${winText}\n\n`;
    });

    const buttons = [];
    for (let i = 0; i < sorted.length; i += 2) {
      const row = [];
      row.push({
        text: `➕ ${sorted[i].display_name.slice(0, 14)}`,
        callback_data: `follow_trader:${sorted[i].address}`,
      });
      if (sorted[i + 1]) {
        row.push({
          text: `➕ ${sorted[i + 1].display_name.slice(0, 14)}`,
          callback_data: `follow_trader:${sorted[i + 1].address}`,
        });
      }
      buttons.push(row);
    }

    buttons.push([
      { text: '➕ Follow All Active', callback_data: 'follow_all_active' },
      { text: '🔄 Refresh', callback_data: 'refresh_active' },
    ]);
    buttons.push([{ text: '🏆 See Top 10 Traders', callback_data: 'show_traders' }]);

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async function sendLiveSignals(chatId) {
    const traders = await db.getActiveTraders();

    if (!traders.length) {
      return bot.sendMessage(chatId, 'No traders are being tracked yet.\nPlease wait a moment and try again.', mainMenu);
    }

    const sorted = traders
      .sort((a, b) => (b.pnl_30d_usd || 0) - (a.pnl_30d_usd || 0))
      .slice(0, 10);

    let text = `🔥 *LIVE SIGNALS*\n\n`;
    text += `I am currently watching *${traders.length}* traders in real\\-time \\(top 10 shown below\\)\\.\n`;
    text += `The moment any of them opens or closes a trade, you will get an instant alert\\.\n\n`;
    text += `────────────────────\n`;

    sorted.forEach((t, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}\\.`;
      const name = escapeMarkdownV2(t.display_name);
      const pnl = escapeMarkdownV2(fmtUsd(t.pnl_30d_usd));
      const win = escapeMarkdownV2(String(t.win_rate_pct || '?'));
      text += `${medal} *${name}*\n`;
      text += `   Profit: \\+${pnl}  •  Win rate: ${win}%\n\n`;
    });

    text += `────────────────────\n`;
    text += `_Alerts are sent instantly via WebSocket — no delay\\._`;

    const buttons = [
      [
        { text: '🏆 Full Top 10', callback_data: 'show_traders' },
        { text: '📋 My Following', callback_data: 'my_following' },
      ],
      [{ text: '➕ Follow All Top 10', callback_data: 'follow_all_top' }],
    ];

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async function sendHowItWorks(chatId) {
    const text =
      `📖 *How this bot works*\n\n` +
      `1️⃣ Every 15 minutes we scan Hyperliquid for two groups: the *Top* traders by profit \\+ win rate, and the *Most Active* traders by trade frequency\\.\n\n` +
      `2️⃣ We watch all of them *24/7* in real time\\.\n\n` +
      `3️⃣ The second any of them opens or closes a trade → you get an instant notification\\.\n\n` +
      `4️⃣ You can follow individual traders, whole groups, or specific coins\\.\n\n` +
      `Follow the *Top* traders for quality, or the *Most Active* traders if you want frequent signals\\.`;

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏆 See Top Traders', callback_data: 'show_traders' }],
          [{ text: '⚡ See Most Active', callback_data: 'show_active' }],
          [{ text: '📋 What am I following?', callback_data: 'my_following' }],
        ],
      },
    });
  }

  async function sendOpenPositions(chatId) {
    const positions = await db.getAllOpenPositions();

    if (!positions.length) {
      return bot.sendMessage(
        chatId,
        '📊 No open positions right now.\n\nAll tracked traders are flat — check back soon.',
        mainMenu
      );
    }

    let text = `📊 *OPEN POSITIONS*\n\n`;
    const seenTraders = new Map();
    const liveCache = new Map(); // trader_address -> { coin: liveInfo }

    for (const p of positions) {
      const trader = await db.getTrader(p.trader_address);
      const name = escapeMarkdownV2(
        trader ? trader.display_name : p.trader_address.slice(0, 6) + '…' + p.trader_address.slice(-4)
      );
      const coin = escapeMarkdownV2(p.coin);
      const sideEmoji = p.side === 'long' ? '🟢' : '🔴';
      const sideText = p.side === 'long' ? 'LONG' : 'SHORT';
      const entry = escapeMarkdownV2(fmtPrice(p.entry_price));
      const heldMs = Date.now() - new Date(p.opened_at).getTime();
      const held = escapeMarkdownV2(formatDuration(heldMs));

      text += `${sideEmoji} *${sideText} ${coin}* — ${name}\n`;
      text += `   Entry: ${entry}  •  Open ${held}\n`;

      // Enrich with live leverage / liquidation / unrealized PnL
      if (!liveCache.has(p.trader_address)) {
        liveCache.set(p.trader_address, await fetchLivePositionsByCoin(p.trader_address));
      }
      const live = liveCache.get(p.trader_address)[p.coin];

      if (live) {
        const pnlEmoji = live.unrealizedPnl >= 0 ? '✅' : '❌';
        const pnlSign = live.unrealizedPnl >= 0 ? '\\+' : '';
        const pnlUsd = escapeMarkdownV2(fmtUsd(live.unrealizedPnl));
        const pnlPct =
          live.returnOnEquityPct != null ? escapeMarkdownV2(fmtPct(live.returnOnEquityPct)) : null;
        text += `   ${pnlEmoji} Unrealized PnL: *${pnlSign}${pnlUsd}*` + (pnlPct ? ` \\(${pnlPct}\\)` : '') + `\n`;

        if (live.leverage != null) {
          text += `   ⚡ Leverage: *${escapeMarkdownV2(String(live.leverage))}x*`;
          if (live.liquidationPx != null) {
            text += `  •  💥 Liq\\. Price: *${escapeMarkdownV2(fmtPrice(live.liquidationPx))}*`;
          }
          text += `\n`;
        }
      } else {
        text += `   _Live data unavailable_\n`;
      }

      text += `\n`;

      if (trader && !seenTraders.has(p.trader_address)) {
        seenTraders.set(p.trader_address, trader.display_name);
      }
    }

    const buttons = [];
    for (const [address, displayName] of seenTraders) {
      buttons.push([{ text: `➕ Follow ${displayName.slice(0, 18)}`, callback_data: `follow_trader:${address}` }]);
    }
    buttons.push([{ text: '🔄 Refresh', callback_data: 'refresh_positions' }]);

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  async function sendCustomerList(chatId) {
    const users = await db.getAllBotUsers();

    if (!users.length) {
      return bot.sendMessage(chatId, 'No customers recorded yet.');
    }

    let text = `👥 *CUSTOMERS* \\(${users.length} total\\)\n\n`;
    const shown = users.slice(0, 30);

    for (const u of shown) {
      const handle = u.username ? '@' + escapeMarkdownV2(u.username) : escapeMarkdownV2(String(u.chat_id));
      const since = escapeMarkdownV2(new Date(u.first_seen).toISOString().slice(0, 10));
      text += `• ${handle} — since ${since}\n`;
    }

    if (users.length > shown.length) {
      text += `\n_\\.\\.\\.and ${users.length - shown.length} more_`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  }

  async function sendStatus(chatId) {
    const uptimeMs = Date.now() - state.startedAt;
    const uptime = escapeMarkdownV2(formatDuration(uptimeMs));
    const wsIcon = state.wsConnected ? '🟢 Connected' : '🔴 Disconnected';
    const lastRefresh = state.lastRefreshAt
      ? escapeMarkdownV2(formatDuration(Date.now() - state.lastRefreshAt)) + ' ago'
      : 'never yet';

    const text =
      `🩺 *BOT STATUS*\n\n` +
      `Uptime: *${uptime}*\n` +
      `Hyperliquid feed: ${wsIcon}\n` +
      `Tracked traders: *${state.trackedCount}*\n` +
      `Last leaderboard refresh: *${lastRefresh}*\n\n` +
      `Use /testalert to send yourself a sample trade alert and confirm delivery works\\.`;

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', ...mainMenu });
  }

  async function sendTestAlert(chatId) {
    const traders = await db.getActiveTraders();
    const trader = traders[0] || {
      display_name: 'Demo Trader',
      pnl_30d_usd: 125000,
      win_rate_pct: 68,
    };

    const fakeAlert = formatOpenAlert({
      trader,
      coin: 'BTC',
      side: 'long',
      entryPrice: 63200,
      positionUsd: 45000,
      time: Date.now(),
    });

    await bot.sendMessage(
      chatId,
      `🧪 *TEST ALERT* \\(not a real trade — this just confirms delivery works\\)\n\n` + fakeAlert,
      { parse_mode: 'MarkdownV2' }
    );
  }

  // ========== AUTO-TRADING (real execution) ==========

  function isValidAddress(addr) {
    return /^0x[a-fA-F0-9]{40}$/.test(addr);
  }

  function isValidPrivateKey(key) {
    return /^0x[a-fA-F0-9]{64}$/.test(key);
  }

  async function handleDemo(chatId) {
    const existing = await db.getTradingAccount(chatId);

    if (existing && existing.is_demo) {
      await bot.sendMessage(
        chatId,
        `🧪 You already have a demo account\\.\n\nBalance: *${escapeMarkdownV2(fmtUsdPrecise(existing.demo_balance))}*\n\nFollow a trader and tap 🤖 Auto\\-Copy in *My Following* to practice\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    if (existing && !existing.is_demo) {
      await bot.sendMessage(
        chatId,
        '⚠️ You already have a real trading account connected. Demo mode is for accounts that haven\u2019t connected a real Hyperliquid key yet.'
      );
      return;
    }

    await db.upsertTradingAccount(chatId, {
      is_demo: true,
      demo_balance: 100,
      capital_pct: 10,
      max_position_usd: 20,
      auto_trade_enabled: true, // safe by default — it's fake money
    });

    await bot.sendMessage(
      chatId,
      `🧪 *Demo account created\\!*\n\n` +
        `Starting balance: *$100* \\(fake money, no real Hyperliquid account needed\\)\n` +
        `Capital per trade: *10%*\n` +
        `Max per trade: *$20*\n\n` +
        `Now go to *🏆 Top 10 Traders* or *📋 My Following*, follow a trader, and tap 🤖 Auto\\-Copy\\. ` +
        `You'll get simulated fills and PnL as if you'd copied them for real\\.\n\n` +
        `Use \`/capital\` and \`/maxpos\` to adjust your demo settings, and \`/mytrades\` to see your history\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  async function handleConnect(chatId, messageId, args) {
    const [agentKey, mainAddress] = args;

    if (!agentKey || !mainAddress) {
      await bot.sendMessage(
        chatId,
        'Usage: `/connect <agent_private_key> <main_account_address>`\n\n' +
          'Generate an agent wallet from your Hyperliquid account settings ' +
          '(API Wallet) — never paste your main wallet\u2019s private key or seed phrase here.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Delete the message immediately so the plaintext key doesn't sit in
    // chat history — best-effort, this can fail if the bot lacks delete
    // rights, which is fine, we still proceed with onboarding.
    bot.deleteMessage(chatId, messageId).catch(() => {});

    if (!isValidPrivateKey(agentKey)) {
      await bot.sendMessage(chatId, '❌ That doesn\u2019t look like a valid private key (expected 0x + 64 hex characters). Nothing was saved.');
      return;
    }
    if (!isValidAddress(mainAddress)) {
      await bot.sendMessage(chatId, '❌ That doesn\u2019t look like a valid address (expected 0x + 40 hex characters). Nothing was saved.');
      return;
    }

    let encrypted;
    try {
      encrypted = encryptSecret(agentKey);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Could not securely store your key: ${err.message}`);
      return;
    }

    await db.upsertTradingAccount(chatId, {
      is_demo: false,
      main_address: mainAddress,
      agent_key_ciphertext: encrypted.ciphertext,
      agent_key_iv: encrypted.iv,
      agent_key_tag: encrypted.tag,
    });

    const netLabel = HYPERLIQUID_IS_TESTNET ? 'TESTNET' : 'MAINNET (real funds)';
    await bot.sendMessage(
      chatId,
      `✅ Trading account connected \\(${escapeMarkdownV2(netLabel)}\\)\\.\n\n` +
        `Your agent key is encrypted at rest and can only place/close trades — it cannot withdraw funds\\.\n\n` +
        `Next steps:\n` +
        `• \`/capital 5\` — % of your account to risk per auto\\-copied trade\n` +
        `• \`/maxpos 200\` — hard cap in USD per trade\n` +
        `• Tap 🤖 Auto\\-Copy on a trader you follow\n` +
        `• \`/autotrade on\` — flip the master switch once you're ready`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  async function handleSetCapital(chatId, args) {
    const pct = Number(args[0]);
    if (!pct || pct <= 0 || pct > MAX_CAPITAL_PCT_ALLOWED) {
      await bot.sendMessage(
        chatId,
        `Usage: \`/capital 5\` — enter a number between 0 and ${MAX_CAPITAL_PCT_ALLOWED} (percent of your account per trade).`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const account = await db.getTradingAccount(chatId);
    if (!account) {
      await bot.sendMessage(chatId, 'Connect a trading account first with `/connect`.', { parse_mode: 'Markdown' });
      return;
    }
    await db.upsertTradingAccount(chatId, { capital_pct: pct });
    await bot.sendMessage(chatId, `✅ Capital per trade set to ${pct}% of your account.`);
  }

  async function handleSetMaxPos(chatId, args) {
    const usd = Number(args[0]);
    if (!usd || usd <= 0) {
      await bot.sendMessage(chatId, 'Usage: `/maxpos 200` — max USD size per auto-copied trade.', { parse_mode: 'Markdown' });
      return;
    }
    const account = await db.getTradingAccount(chatId);
    if (!account) {
      await bot.sendMessage(chatId, 'Connect a trading account first with `/connect`.', { parse_mode: 'Markdown' });
      return;
    }
    await db.upsertTradingAccount(chatId, { max_position_usd: usd });
    await bot.sendMessage(chatId, `✅ Max position size set to ${fmtUsd(usd)} per trade.`);
  }

  async function handleAutoTradeToggle(chatId, args) {
    const arg = (args[0] || '').toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
      await bot.sendMessage(chatId, 'Usage: `/autotrade on` or `/autotrade off`.', { parse_mode: 'Markdown' });
      return;
    }

    const account = await db.getTradingAccount(chatId);
    if (!account) {
      await bot.sendMessage(chatId, 'Connect a trading account first with `/connect`.', { parse_mode: 'Markdown' });
      return;
    }

    if (arg === 'on' && !AUTO_TRADE_ENABLED) {
      await bot.sendMessage(
        chatId,
        '⚠️ Auto\\-trading is globally disabled on this bot right now \\(admin has not enabled `AUTO_TRADE_ENABLED`\\)\\. Your setting will be saved but no real orders will be placed until it is turned on\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }

    await db.upsertTradingAccount(chatId, { auto_trade_enabled: arg === 'on' });
    await bot.sendMessage(chatId, arg === 'on' ? '✅ Auto-trading turned ON for your account.' : '🛑 Auto-trading turned OFF for your account.');
  }

  async function sendMyTrades(chatId) {
    const executions = await db.getRecentTradeExecutions(chatId, 10);
    if (!executions.length) {
      await bot.sendMessage(chatId, 'No auto-copy trades recorded yet.');
      return;
    }

    let text = `🤖 *RECENT AUTO\\-COPY TRADES*\n\n`;
    const icons = { submitted: '✅', demo_open: '🧪', demo_close: '🧪', failed: '❌' };
    for (const e of executions) {
      const icon = icons[e.status] || '❔';
      const coin = escapeMarkdownV2(e.coin);
      const side = e.side === 'long' ? 'LONG' : 'SHORT';
      const size = e.usd_size != null
        ? escapeMarkdownV2(e.status.startsWith('demo') ? fmtUsdPrecise(e.usd_size) : fmtUsd(e.usd_size))
        : 'n/a';
      const when = escapeMarkdownV2(new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' '));
      const label = e.status === 'demo_open' ? ' \\(demo open\\)' : e.status === 'demo_close' ? ' \\(demo close\\)' : '';
      text += `${icon} ${side} ${coin}${label} — ${size} — ${when}\n`;
      if (e.status === 'failed' && e.error_message) {
        text += `   _${escapeMarkdownV2(e.error_message.slice(0, 80))}_\n`;
      }
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  }

  async function showMyFollowing(chatId) {
    const [coins, traders] = await Promise.all([
      db.getFollowedCoins(chatId),
      db.getFollowedTraders(chatId),
    ]);

    const tradingAccount = await db.getTradingAccount(chatId);

    let text = `📋 *What you are following*\n\n`;

    if (traders.length > 0) {
      text += `*Traders:*\n`;
      for (const { address, autoCopy } of traders) {
        const t = await db.getTrader(address);
        const name = escapeMarkdownV2(t ? t.display_name : address.slice(0, 10) + '…');
        const copyTag = autoCopy ? ' 🤖 _auto\\-copying_' : '';
        text += `• ${name}${copyTag}\n`;
      }
      text += `\n`;
    }

    if (coins.length > 0) {
      text += `*Coins:* ${escapeMarkdownV2(coins.join(', '))}\n\n`;
    }

    if (traders.length === 0 && coins.length === 0) {
      text += `_You are not following anyone yet\\._\n\nTap *🏆 Top 10 Traders* to start\\.`;
    }

    if (!tradingAccount) {
      text += `\n_Want real auto\\-copy trading instead of just alerts? Use \`/connect\` to set it up\\._`;
    }

    const buttons = [];
    traders.forEach(({ address, autoCopy }) => {
      const short = address.slice(0, 6) + '…' + address.slice(-4);
      const row = [{ text: `❌ Unfollow ${short}`, callback_data: `unfollow_trader:${address}` }];
      if (tradingAccount) {
        row.push(
          autoCopy
            ? { text: '🛑 Stop Auto-Copy', callback_data: `autocopy_off:${address}` }
            : { text: '🤖 Auto-Copy', callback_data: `autocopy_on:${address}` }
        );
      }
      buttons.push(row);
    });
    coins.forEach((c) => {
      buttons.push([{ text: `❌ Unfollow ${c}`, callback_data: `unfollow_coin:${c}` }]);
    });

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
    });
  }

  // ========== MESSAGE HANDLER ==========
  bot.on('message', async (msg) => {
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    // Track every user who talks to the bot, for the admin /customers view.
    // Best-effort — never let a tracking failure block the actual command.
    db.upsertBotUser(chatId, msg.chat.username).catch((err) =>
      console.error('[bot-users] failed to record user:', err.message)
    );

    try {
      if (lower === '/start') {
        await bot.sendMessage(
          chatId,
          `👋 *Welcome to Smart Trader Bot*\n\n` +
            `I watch the *Top 10 most profitable traders* on Hyperliquid and send you *instant alerts* the moment they open or close a trade\\.\n\n` +
            `Tap a button below to get started:`,
          { parse_mode: 'MarkdownV2', ...mainMenu }
        );
        return;
      }

      if (lower.startsWith('/follow ')) {
        const coin = text.slice(8).trim().toUpperCase();
        if (!coin) {
          await bot.sendMessage(chatId, 'Usage: `/follow BTC`', { parse_mode: 'MarkdownV2', ...mainMenu });
          return;
        }
        await db.follow(chatId, coin);
        await bot.sendMessage(
          chatId,
          `✅ You are now following *${escapeMarkdownV2(coin)}*\n\nYou will get alerts when any tracked trader trades ${escapeMarkdownV2(coin)}\\.`,
          { parse_mode: 'MarkdownV2', ...mainMenu }
        );
        return;
      }

      if (lower.startsWith('/unfollow ')) {
        const coin = text.slice(10).trim().toUpperCase();
        if (!coin) {
          await bot.sendMessage(chatId, 'Usage: `/unfollow BTC`', { parse_mode: 'MarkdownV2', ...mainMenu });
          return;
        }
        await db.unfollow(chatId, coin);
        await bot.sendMessage(chatId, `❌ Unfollowed *${escapeMarkdownV2(coin)}*`, {
          parse_mode: 'MarkdownV2',
          ...mainMenu,
        });
        return;
      }

      if (lower === '/following') {
        await showMyFollowing(chatId);
        return;
      }

      if (text === '🏆 Top 10 Traders' || lower === '/traders') {
        await sendTop10(chatId);
        return;
      }

      if (text === '⚡ Most Active' || lower === '/active') {
        await sendActiveTraders(chatId);
        return;
      }

      if (text === '📊 Open Positions' || lower === '/positions') {
        await sendOpenPositions(chatId);
        return;
      }

      if (lower === '/status') {
        await sendStatus(chatId);
        return;
      }

      if (lower === '/customers') {
        if (!ADMIN_CHAT_IDS.includes(chatId)) {
          await bot.sendMessage(chatId, 'This command is restricted.');
          return;
        }
        await sendCustomerList(chatId);
        return;
      }

      if (lower === '/testalert') {
        await sendTestAlert(chatId);
        return;
      }

      if (lower === '/demo') {
        await handleDemo(chatId);
        return;
      }

      if (lower.startsWith('/connect')) {
        const args = text.split(/\s+/).slice(1);
        await handleConnect(chatId, msg.message_id, args);
        return;
      }

      if (lower.startsWith('/capital')) {
        const args = text.split(/\s+/).slice(1);
        await handleSetCapital(chatId, args);
        return;
      }

      if (lower.startsWith('/maxpos')) {
        const args = text.split(/\s+/).slice(1);
        await handleSetMaxPos(chatId, args);
        return;
      }

      if (lower.startsWith('/autotrade')) {
        const args = text.split(/\s+/).slice(1);
        await handleAutoTradeToggle(chatId, args);
        return;
      }

      if (lower === '/mytrades') {
        await sendMyTrades(chatId);
        return;
      }

      if (text === '🔥 Live Signals' || lower === '/signals') {
        await sendLiveSignals(chatId);
        return;
      }

      if (text === '📖 How it works') {
        await sendHowItWorks(chatId);
        return;
      }

      if (text === '📋 My Following') {
        await showMyFollowing(chatId);
        return;
      }
    } catch (err) {
      console.error('[message handler error]', err.message);
      await bot.sendMessage(chatId, 'Something went wrong. Please try again.').catch(() => {});
    }
  });

  // ========== CALLBACK HANDLERS ==========
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
      if (data.startsWith('follow_trader:')) {
        const address = data.split(':')[1];
        const trader = await db.getTrader(address);

        if (!trader) {
          await bot.answerCallbackQuery(query.id, { text: 'Trader not found' });
          return;
        }

        await db.followTrader(chatId, address);
        await bot.answerCallbackQuery(query.id, { text: `Following ${trader.display_name}` });
        await bot.sendMessage(
          chatId,
          `✅ You are now following *${escapeMarkdownV2(trader.display_name)}*\n\nYou will get an alert every time they trade\\.`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      if (data.startsWith('unfollow_trader:')) {
        const address = data.split(':')[1];
        await db.unfollowTrader(chatId, address);
        await bot.answerCallbackQuery(query.id, { text: 'Unfollowed' });
        await showMyFollowing(chatId);
        return;
      }

      if (data.startsWith('autocopy_on:')) {
        const address = data.split(':')[1];
        const account = await db.getTradingAccount(chatId);
        if (!account) {
          await bot.answerCallbackQuery(query.id, { text: 'Connect a trading account first with /connect' });
          return;
        }
        await db.setAutoCopy(chatId, address, true);
        await bot.answerCallbackQuery(query.id, { text: 'Auto-copy enabled for this trader' });
        await showMyFollowing(chatId);
        return;
      }

      if (data.startsWith('autocopy_off:')) {
        const address = data.split(':')[1];
        await db.setAutoCopy(chatId, address, false);
        await bot.answerCallbackQuery(query.id, { text: 'Auto-copy disabled' });
        await showMyFollowing(chatId);
        return;
      }

      if (data.startsWith('unfollow_coin:')) {
        const coin = data.split(':')[1];
        await db.unfollow(chatId, coin);
        await bot.answerCallbackQuery(query.id, { text: `Unfollowed ${coin}` });
        await showMyFollowing(chatId);
        return;
      }

      if (data.startsWith('copy_signal:')) {
        const parts = data.split(':');
        const coin = parts[1];
        const side = parts[2];
        const entryPrice = parts[3];

        const sideText = side === 'long' ? 'BUY / LONG' : 'SELL / SHORT';

        await bot.answerCallbackQuery(query.id, { text: 'Signal copied!' });
        await bot.sendMessage(
          chatId,
          `📋 *COPY SIGNAL*\n\n` +
            `Pair: *${escapeMarkdownV2(coin)}*\n` +
            `Side: *${sideText}*\n` +
            `Entry: *${escapeMarkdownV2(Number(entryPrice).toFixed(2))}*\n\n` +
            `_This is for reference only\\. DYOR before trading\\._`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      if (data === 'show_traders' || data === 'refresh_traders') {
        await bot.answerCallbackQuery(query.id);
        await sendTop10(chatId);
        return;
      }

      if (data === 'show_active' || data === 'refresh_active') {
        await bot.answerCallbackQuery(query.id);
        await sendActiveTraders(chatId);
        return;
      }

      if (data === 'refresh_positions') {
        await bot.answerCallbackQuery(query.id);
        await sendOpenPositions(chatId);
        return;
      }

      if (data === 'my_following') {
        await bot.answerCallbackQuery(query.id);
        await showMyFollowing(chatId);
        return;
      }

      if (data === 'follow_all_top') {
        const traders = await db.getActiveTradersByPool('quality');
        if (!traders.length) {
          await bot.answerCallbackQuery(query.id, { text: 'No traders available' });
          return;
        }

        for (const t of traders) {
          await db.followTrader(chatId, t.address);
        }

        await bot.answerCallbackQuery(query.id, { text: `Following ${traders.length} traders!` });
        await bot.sendMessage(
          chatId,
          `✅ You are now following all *Top ${traders.length}* traders\\.\n\nYou will receive instant alerts\\.`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      if (data === 'follow_all_active') {
        const traders = await db.getActiveTradersByPool('activity');
        if (!traders.length) {
          await bot.answerCallbackQuery(query.id, { text: 'No active traders available' });
          return;
        }

        for (const t of traders) {
          await db.followTrader(chatId, t.address);
        }

        await bot.answerCallbackQuery(query.id, { text: `Following ${traders.length} active traders!` });
        await bot.sendMessage(
          chatId,
          `✅ You are now following all *${traders.length}* active traders\\.\n\nExpect frequent alerts\\.`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
    } catch (err) {
      console.error('[callback error]', err.message);
      // If the query already expired, this recovery call will fail the same
      // way — swallow it instead of letting an unhandled rejection crash
      // the whole process.
      await bot.answerCallbackQuery(query.id, { text: 'Error occurred' }).catch(() => {});
    }
  });

  bot.on('polling_error', (err) => console.error('[telegram] polling error:', err.message));

  return bot;
}

module.exports = { createBot };
