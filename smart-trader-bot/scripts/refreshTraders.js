const {
  buildQualifiedTraderList,
  buildActiveTraderList,
  buildMemeTraderList,
  fetchLeaderboard,
} = require('../src/hyperliquid/leaderboard');
const db = require('../src/db/supabase');

async function refreshTraders() {
  console.log('[refresh-traders] pulling leaderboard...');
  const rows = await fetchLeaderboard();

  const qualified = await buildQualifiedTraderList(rows);
  console.log(`[refresh-traders] ${qualified.length} quality-pool traders qualified`);

  const active = await buildActiveTraderList(
    qualified.map((t) => t.address),
    rows
  );
  console.log(`[refresh-traders] ${active.length} activity-pool traders qualified`);

  const meme = await buildMemeTraderList(
    [...qualified, ...active].map((t) => t.address),
    rows
  );
  console.log(`[refresh-traders] ${meme.length} meme-pool traders qualified`);

  const combined = [...qualified, ...active, ...meme];

  await db.upsertTraders(combined);
  if (combined.length) {
    await db.deactivateTradersNotIn(combined.map((t) => t.address));
  }
  return combined.map((t) => t.address);
}

if (require.main === module) {
  refreshTraders()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[refresh-traders] failed:', err.message);
      process.exit(1);
    });
}

module.exports = { refreshTraders };
