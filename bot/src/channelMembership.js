import { requiredChannel } from "./content/botLinks.js";

export function deliversContent(method) {
  return /^(send|copyMessage|copyMessages|forwardMessage|forwardMessages|editMessage)/.test(String(method));
}

export async function checkChannelMembership(env, userId) {
  let target = null;
  if (!/^[1-9][0-9]*$/.test(String(userId || ""))) {
    return { member: false, reason: "private_chat_required", joinUrl: null };
  }
  try {
    target = await requiredChannel(env);
    const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/getChatMember", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: target.chatId, user_id: String(userId) }),
    });
    const body = await response.json();
    if (!response.ok || !body || body.ok !== true || !body.result) {
      return { member: false, reason: "unavailable", joinUrl: target.joinUrl,
        retryAfter: Math.max(0, Number(body?.parameters?.retry_after) || 0) };
    }
    const status = body.result.status;
    const member = ["creator", "administrator", "member"].includes(status)
      || (status === "restricted" && body.result.is_member === true);
    return { member, reason: member ? null : "not_member", status, joinUrl: target.joinUrl, channelId: target.chatId };
  } catch {
    return { member: false, reason: "unavailable", joinUrl: target?.joinUrl || null };
  }
}

export function membershipError(result) {
  const error = new Error(result.reason === "unavailable" ? "Channel membership verification unavailable" : "Channel membership required");
  error.name = "ChannelMembershipError";
  error.membershipRequired = result.reason !== "unavailable";
  error.status = result.reason === "unavailable" ? 503 : 403;
  error.retryAfter = result.retryAfter || 0;
  return error;
}

export async function requireChannelMembership(env, userId) {
  const result = await checkChannelMembership(env, userId);
  if (!result.member) throw membershipError(result);
  return result;
}

// All direct Bot API deliveries, including multipart certificates and admin previews.
// Membership prompts are deliberately sent only by sendMembershipPrompt below.
export async function memberFetch(env, url, init = {}) {
  const method = new URL(String(url)).pathname.split("/").pop();
  if (deliversContent(method)) {
    let payload;
    try {
      payload = init.body instanceof FormData ? { chat_id: init.body.get("chat_id") } : JSON.parse(init.body || "{}");
    } catch {
      payload = {};
    }
    const result = await checkChannelMembership(env, payload.chat_id);
    if (!result.member) {
      const unavailable = result.reason === "unavailable";
      return new Response(JSON.stringify({ ok: false, error_code: unavailable ? 503 : 403,
        description: unavailable ? "Membership verification unavailable" : "Channel membership required",
        membership_required: !unavailable, membership_unavailable: unavailable,
        parameters: { retry_after: result.retryAfter || 0 } }),
        { status: unavailable ? 503 : 403, headers: { "Content-Type": "application/json" } });
    }
  }
  return fetch(url, init);
}

export async function sendMembershipPrompt(ctx, result, retry = false) {
  if (ctx.chat?.type !== "private" || !ctx.from?.id) return;
  const unavailable = result.reason === "unavailable";
  const text = unavailable
    ? "بررسی عضویت در کانال فعلاً ممکن نیست. لطفاً کمی بعد دوباره روی «تأیید عضویت» بزنید."
    : retry
      ? "هنوز عضویت شما در کانال تأیید نشده است. ابتدا عضو کانال شوید و سپس «تأیید عضویت» را بزنید."
      : "برای استفاده از ربات، ابتدا عضو کانال آکادمی شوید و سپس «تأیید عضویت» را بزنید.";
  const rows = [];
  if (result.joinUrl) rows.push([{ text: "📢 عضویت در کانال", url: result.joinUrl }]);
  rows.push([{ text: "✅ تأیید عضویت", callback_data: "CHECK_MEMBERSHIP" }]);
  await fetch("https://api.telegram.org/bot" + ctx.env.BOT_TOKEN + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ chat_id: ctx.from.id, text, reply_markup: { inline_keyboard: rows } }),
  });
}
