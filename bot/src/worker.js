import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN تنظیم نشده است (به‌عنوان secret در Cloudflare ست کنید)", {
        status: 500,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    // مسیر تشخیصی موقت - فقط یک‌بار برای ساختن جدول‌های D1 اجرا می‌شود.
    // با همون BOT_TOKEN محافظت می‌شود تا کسی دیگه نتواند صداش بزند.
    if (url.pathname === "/debug/init-db") {
      if (url.searchParams.get("key") !== env.BOT_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const statements = [
        `CREATE TABLE IF NOT EXISTS user_state (
          telegram_user_id TEXT PRIMARY KEY,
          current_flow TEXT,
          current_step TEXT,
          temp_data TEXT,
          phone TEXT,
          intro_progress INTEGER DEFAULT 0,
          source_first_seen TEXT,
          last_interaction_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_type TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          username TEXT,
          name TEXT,
          phone TEXT,
          course TEXT,
          level TEXT,
          topic TEXT,
          preferred_time TEXT,
          confirmed TEXT DEFAULT 'false',
          source TEXT,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_tickets (
          ticket_id TEXT PRIMARY KEY,
          telegram_user_id TEXT NOT NULL,
          telegram_username TEXT,
          first_name TEXT,
          last_name TEXT,
          message TEXT,
          status TEXT DEFAULT 'باز',
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS content_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_user_id TEXT NOT NULL,
          username TEXT,
          content_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          delivered INTEGER DEFAULT 0
        )`,
      ];
      try {
        for (const sql of statements) {
          await env.DB.prepare(sql).run();
        }
        return new Response("ok - tables created", { status: 200 });
      } catch (err) {
        return new Response("error: " + String(err), { status: 500 });
      }
    }

    // مسیر webhook شامل خود توکن است تا کسی نتواند بدون دانستن توکن
    // درخواست جعلی به این آدرس بفرستد.
    if (url.pathname === `/webhook/${env.BOT_TOKEN}`) {
      const bot = createBot(env.BOT_TOKEN, env);
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    return new Response("not found", { status: 404 });
  },
};
