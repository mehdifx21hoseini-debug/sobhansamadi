import { InlineKeyboard } from "grammy";
import { defineSchema } from "./schemaGate.js";
import { getLinks } from "./content/botLinks.js";
import { recordUserSource } from "./db.js";

export const LIVE_PAYLOAD = "live_20261118";
export const LIVE_START = "2026-11-17T20:30:00.000Z";
export const LIVE_END = "2026-11-18T20:30:00.000Z";
export const LIVE_TEXT = "📺 برای دیدن لایو تریدهای آکادمی سبحان صمدی، می‌توانید از طریق دکمهٔ زیر وارد کانال شوید. 👇";
const DDL = `CREATE TABLE IF NOT EXISTS live_trade_entries (
  telegram_user_id TEXT PRIMARY KEY, campaign TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, sent_at TEXT)`;
export const ensureLiveTradeSchema = defineSchema("live_trade_entries", DDL, async (env) => {
  await env.DB.prepare(DDL).run();
});
export function liveCampaignActive(now = new Date()) {
  const iso = now.toISOString();
  return iso >= LIVE_START && iso < LIVE_END;
}

// Capture the deep link before the membership gate interrupts /start.
export async function prepareLiveTradeEntry(ctx) {
  if (!liveCampaignActive() || ctx.chat?.type !== "private" || !ctx.from?.id) return false;
  const text = ctx.message?.text || "";
  const entering = /^\/start(?:@[A-Za-z0-9_]+)?\s+live_20261118\s*$/.test(text);
  const checking = ctx.callbackQuery?.data === "CHECK_MEMBERSHIP";
  if (!entering && !checking) return false;
  await ensureLiveTradeSchema(ctx.env);
  const id = String(ctx.from.id);
  if (entering) {
    await ctx.env.DB.prepare(`INSERT INTO live_trade_entries (telegram_user_id, campaign, created_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM user_state WHERE telegram_user_id = ?
        AND (source_first_seen < ? OR source_first_seen IS NULL))
      ON CONFLICT(telegram_user_id) DO NOTHING`)
      .bind(id, LIVE_PAYLOAD, new Date().toISOString(), id, LIVE_START).run();
    await recordUserSource(ctx.env, id, LIVE_PAYLOAD);
  }
  const row = await ctx.env.DB.prepare(`SELECT status FROM live_trade_entries
    WHERE telegram_user_id = ? AND campaign = ?`).bind(id, LIVE_PAYLOAD).first();
  return row?.status === "pending";
}

// Atomic claim: retries and parallel Telegram updates cannot send twice.
export async function sendLiveTradeWelcome(ctx) {
  if (!liveCampaignActive()) return false;
  const links = await getLinks(ctx.env);
  const claimed = await ctx.env.DB.prepare(`UPDATE live_trade_entries SET status = 'sending'
    WHERE telegram_user_id = ? AND campaign = ? AND status = 'pending'
    RETURNING telegram_user_id`).bind(String(ctx.from.id), LIVE_PAYLOAD).first();
  if (!claimed) return false;
  await ctx.reply(LIVE_TEXT, {
    reply_markup: new InlineKeyboard().url("📺 ورود به کانال لایو ترید", links.TG_CHANNEL),
  });
  await ctx.env.DB.prepare(`UPDATE live_trade_entries SET status = 'sent', sent_at = ?
    WHERE telegram_user_id = ? AND campaign = ?`)
    .bind(new Date().toISOString(), String(ctx.from.id), LIVE_PAYLOAD).run();
  return true;
}
