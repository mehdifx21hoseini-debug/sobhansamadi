import { handleStart } from "./commands/start.js";
import { prepareLiveTradeEntry, sendLiveTradeWelcome } from "./liveTradeCampaign.js";
import { checkChannelMembership, sendMembershipPrompt } from "./channelMembership.js";

export const GATE_CHANNEL = "@sobhanforex";

// No owner/certificate exemptions; every interaction gets a fresh Telegram check.
export function membershipGate() {
  return async (ctx, next) => {
    if (!ctx.from?.id || ctx.chat?.type !== "private") return;
    const retry = ctx.callbackQuery?.data === "CHECK_MEMBERSHIP";
    const result = await checkChannelMembership(ctx.env, ctx.from.id);
    if (retry) await ctx.answerCallbackQuery().catch(() => {});
    if (!result.member) return sendMembershipPrompt(ctx, result, retry);
    const liveEntry = await prepareLiveTradeEntry(ctx);
    if (retry) await handleStart(ctx);
    else await next();
    if (liveEntry) await sendLiveTradeWelcome(ctx);
  };
}
