import { mainMenuKeyboard } from "../menu.js";

export async function handleStart(ctx) {
  await ctx.reply(
    "به آکادمی سبحان صمدی خوش آمدید 👋\nاز منوی زیر بخش موردنظرتان را انتخاب کنید:",
    { reply_markup: mainMenuKeyboard() }
  );
}
