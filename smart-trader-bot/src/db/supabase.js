const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = require('../config');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---- traders ----
async function upsertTraders(traders) {
  if (!traders.length) return;
  const { error } = await supabase.from('traders').upsert(traders, { onConflict: 'address' });
  if (error) throw error;
}

async function deactivateTradersNotIn(addresses) {
  if (!addresses.length) return;

  const { error } = await supabase
    .from('traders')
    .update({ active: false })
    .eq('active', true)
    .not('address', 'in', `(${addresses.map((a) => `"${a}"`).join(',')})`);

  if (error) throw error;
}

async function getActiveTraders() {
  const { data, error } = await supabase.from('traders').select('*').eq('active', true);
  if (error) throw error;
  return data || [];
}

async function getActiveTradersByPool(pool) {
  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('active', true)
    .eq('pool', pool);
  if (error) throw error;
  return data || [];
}

async function getTrader(address) {
  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('address', address)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- coin subscriptions ----
async function follow(chatId, coin) {
  const { error } = await supabase.from('subscriptions').upsert({ chat_id: chatId, coin });
  if (error) throw error;
}

async function unfollow(chatId, coin) {
  const { error } = await supabase
    .from('subscriptions')
    .delete()
    .eq('chat_id', chatId)
    .eq('coin', coin);
  if (error) throw error;
}

async function getFollowedCoins(chatId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('coin')
    .eq('chat_id', chatId);
  if (error) throw error;
  return (data || []).map((r) => r.coin);
}

async function getSubscribersForCoin(coin) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('chat_id')
    .eq('coin', coin);
  if (error) throw error;
  return (data || []).map((r) => r.chat_id);
}

// ---- trader subscriptions ----
async function followTrader(chatId, traderAddress) {
  const { error } = await supabase
    .from('trader_subscriptions')
    .upsert({ chat_id: chatId, trader_address: traderAddress });
  if (error) throw error;
}

async function unfollowTrader(chatId, traderAddress) {
  const { error } = await supabase
    .from('trader_subscriptions')
    .delete()
    .eq('chat_id', chatId)
    .eq('trader_address', traderAddress);
  if (error) throw error;
}

async function getFollowedTraders(chatId) {
  const { data, error } = await supabase
    .from('trader_subscriptions')
    .select('trader_address, auto_copy')
    .eq('chat_id', chatId);
  if (error) throw error;
  return (data || []).map((r) => ({ address: r.trader_address, autoCopy: r.auto_copy }));
}

async function getSubscribersForTrader(traderAddress) {
  const { data, error } = await supabase
    .from('trader_subscriptions')
    .select('chat_id')
    .eq('trader_address', traderAddress);
  if (error) throw error;
  return (data || []).map((r) => r.chat_id);
}

// ---- auto-trading ----
async function setAutoCopy(chatId, traderAddress, enabled) {
  const { error } = await supabase
    .from('trader_subscriptions')
    .update({ auto_copy: enabled })
    .eq('chat_id', chatId)
    .eq('trader_address', traderAddress);
  if (error) throw error;
}

// Chat IDs that are both following AND auto-copying this trader.
async function getAutoCopySubscribers(traderAddress) {
  const { data, error } = await supabase
    .from('trader_subscriptions')
    .select('chat_id')
    .eq('trader_address', traderAddress)
    .eq('auto_copy', true);
  if (error) throw error;
  return (data || []).map((r) => r.chat_id);
}

async function upsertTradingAccount(chatId, fields) {
  const { error } = await supabase
    .from('trading_accounts')
    .upsert(
      { chat_id: chatId, updated_at: new Date().toISOString(), ...fields },
      { onConflict: 'chat_id' }
    );
  if (error) throw error;
}

async function getTradingAccount(chatId) {
  const { data, error } = await supabase
    .from('trading_accounts')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function logTradeExecution(entry) {
  const { error } = await supabase.from('trade_executions').insert(entry);
  if (error) throw error;
}

async function getRecentTradeExecutions(chatId, limit = 10) {
  const { data, error } = await supabase
    .from('trade_executions')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---- demo mode ----
async function upsertDemoPosition(pos) {
  const { error } = await supabase
    .from('demo_positions')
    .upsert(pos, { onConflict: 'chat_id,trader_address,coin' });
  if (error) throw error;
}

async function getDemoPosition(chatId, traderAddress, coin) {
  const { data, error } = await supabase
    .from('demo_positions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('trader_address', traderAddress)
    .eq('coin', coin)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function clearDemoPosition(chatId, traderAddress, coin) {
  const { error } = await supabase
    .from('demo_positions')
    .delete()
    .eq('chat_id', chatId)
    .eq('trader_address', traderAddress)
    .eq('coin', coin);
  if (error) throw error;
}

// ---- open positions ----
async function getOpenPosition(traderAddress, coin) {
  const { data, error } = await supabase
    .from('open_positions')
    .select('*')
    .eq('trader_address', traderAddress)
    .eq('coin', coin)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getAllOpenPositions() {
  const { data, error } = await supabase
    .from('open_positions')
    .select('*')
    .order('opened_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function upsertOpenPosition(pos) {
  const { error } = await supabase
    .from('open_positions')
    .upsert(pos, { onConflict: 'trader_address,coin' });
  if (error) throw error;
}

async function clearOpenPosition(traderAddress, coin) {
  const { error } = await supabase
    .from('open_positions')
    .delete()
    .eq('trader_address', traderAddress)
    .eq('coin', coin);
  if (error) throw error;
}

// ---- fill dedup ----
async function isFillSeen(tid) {
  const { data, error } = await supabase
    .from('seen_fills')
    .select('tid')
    .eq('tid', tid)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markFillSeen(tid) {
  await supabase.from('seen_fills').upsert({ tid }, { onConflict: 'tid', ignoreDuplicates: true });
}

async function pruneOldFills(olderThanHours = 48) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
  await supabase.from('seen_fills').delete().lt('seen_at', cutoff);
}

async function upsertBotUser(chatId, username) {
  const { error } = await supabase
    .from('bot_users')
    .upsert(
      { chat_id: chatId, username: username || null, last_seen: new Date().toISOString() },
      { onConflict: 'chat_id' }
    );
  if (error) throw error;
}

async function getAllBotUsers() {
  const { data, error } = await supabase
    .from('bot_users')
    .select('*')
    .order('first_seen', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function countBotUsers() {
  const { count, error } = await supabase.from('bot_users').select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

module.exports = {
  supabase,
  upsertTraders,
  deactivateTradersNotIn,
  getActiveTraders,
  getActiveTradersByPool,
  getTrader,
  follow,
  unfollow,
  getFollowedCoins,
  getSubscribersForCoin,
  followTrader,
  unfollowTrader,
  getFollowedTraders,
  getSubscribersForTrader,
  setAutoCopy,
  getAutoCopySubscribers,
  upsertTradingAccount,
  getTradingAccount,
  logTradeExecution,
  getRecentTradeExecutions,
  upsertDemoPosition,
  getDemoPosition,
  clearDemoPosition,
  getOpenPosition,
  getAllOpenPositions,
  upsertOpenPosition,
  clearOpenPosition,
  isFillSeen,
  markFillSeen,
  pruneOldFills,
  upsertBotUser,
  getAllBotUsers,
  countBotUsers,
};
