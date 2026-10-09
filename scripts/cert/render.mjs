// رندرِ گواهی: قالبِ بی‌نام + فونت‌های آکادمی + نام → PNG.
//
// چرا Chromium و نه resvg: با همان فونتِ Yekan Bakh ExtraBlack، عرضِ نامِ
// نمونه در Photoshop ۷۷۱ پیکسل است؛ Chromium ۷۸۰ می‌دهد و resvg ۸۳۲. شکل‌دهیِ
// فارسیِ resvg برای این فونتِ سنگین ۸٪ پهن‌تر درمی‌آید و آن اختلاف ثابت هم
// نیست (نامِ دیگر ۱۲٪)، پس با یک ضریب جبران‌شدنی نیست.
//
// چرا بوم (canvas) و نه DOM: measureText اندازه‌ی جوهرِ واقعی را می‌دهد
// (actualBoundingBox)، نه جعبه‌ی پیشروی. تراز با جوهر انجام می‌شود، همان‌طور
// که چشم می‌بیند.

import { chromium } from "playwright-core";
import fs from "node:fs";
import { REF, planLine } from "./layout.mjs";
import { normalizeName } from "../../bot/src/certificate/name.js";

export class CertError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // template | name | render
  }
}

function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function launch() {
  const attempts = [
    () => chromium.launch({ channel: "chrome", args: ["--no-sandbox"] }),
    () => chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }),
    () => chromium.launch({ args: ["--no-sandbox"] }),
  ];
  let last;
  for (const go of attempts) {
    try {
      return await go();
    } catch (err) {
      last = err;
    }
  }
  throw new CertError("render", "Chrome پیدا نشد: " + (last && last.message));
}

/**
 * @param {{templatePath:string, nameFontPath:string, labelFontPath:string, layout:object}} opts
 */
export async function openRenderer({ templatePath, nameFontPath, labelFontPath, layout }) {
  const tpl = fs.readFileSync(templatePath);
  const dim = pngSize(tpl);
  if (!dim) throw new CertError("template", "قالب PNG معتبر نیست");
  if (dim.width !== layout.canvas.width || dim.height !== layout.canvas.height) {
    throw new CertError(
      "template",
      "اندازه‌ی قالب " + dim.width + "×" + dim.height + " است، نه " + layout.canvas.width + "×" + layout.canvas.height
    );
  }

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 8, height: 8 } });
    await page.setContent("<!doctype html><meta charset='utf-8'><body></body>");
    try {
      await page.evaluate(
        async ({ tplB64, nameB64, labelB64 }) => {
          const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          for (const [fam, b64] of [["CERT-NAME", nameB64], ["CERT-LABEL", labelB64]]) {
            const face = new FontFace(fam, bytes(b64).buffer);
            await face.load();
            document.fonts.add(face);
          }
          const blob = new Blob([bytes(tplB64)], { type: "image/png" });
          window.__tpl = await createImageBitmap(blob);
        },
        {
          tplB64: tpl.toString("base64"),
          nameB64: fs.readFileSync(nameFontPath).toString("base64"),
          labelB64: fs.readFileSync(labelFontPath).toString("base64"),
        }
      );
    } catch (err) {
      throw new CertError("template", "بارگذاریِ قالب یا فونت شکست خورد: " + (err && err.message));
    }

    const measure = (text, fam) =>
      page.evaluate(
        ({ text, fam, px }) => {
          const c = document.createElement("canvas").getContext("2d");
          c.font = px + 'px "' + fam + '"';
          c.direction = "rtl";
          c.textAlign = "left";
          const m = c.measureText(text);
          return { abl: m.actualBoundingBoxLeft, abr: m.actualBoundingBoxRight };
        },
        { text, fam, px: REF }
      );

    return {
      async render(rawName, gender) {
        const n = normalizeName(rawName);
        if (!n.ok) throw new CertError("name", n.reason);
        const label = layout.labels[gender];
        if (!label) throw new CertError("name", "جنسیت نامعتبر");

        const labelRef = await measure(label, "CERT-LABEL");
        const nameRef = await measure(n.name, "CERT-NAME");
        const plan = planLine(labelRef, nameRef, layout);

        const dataUrl = await page.evaluate(
          ({ plan, layout, label, name, labelRef, nameRef, REF }) => {
            const cv = document.createElement("canvas");
            cv.width = layout.canvas.width;
            cv.height = layout.canvas.height;
            const ctx = cv.getContext("2d");
            ctx.drawImage(window.__tpl, 0, 0);
            ctx.direction = "rtl";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            const put = (text, fam, size, squeeze, color, inkLeft, ref) => {
              ctx.font = size + 'px "' + fam + '"';
              ctx.fillStyle = color;
              ctx.save();
              ctx.translate(inkLeft, layout.baselineY);
              ctx.scale(squeeze, 1);
              ctx.fillText(text, (ref.abl * size) / REF, 0);
              ctx.restore();
            };
            put(name, "CERT-NAME", plan.nameSize, layout.name.squeeze, layout.name.color, plan.name.inkLeft, nameRef);
            put(label, "CERT-LABEL", plan.labelSize, layout.label.squeeze, layout.label.color, plan.label.inkLeft, labelRef);
            return cv.toDataURL("image/png");
          },
          { plan, layout, label, name: n.name, labelRef, nameRef, REF }
        );

        const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        if (!pngSize(png)) throw new CertError("render", "خروجیِ رندر PNG نیست");
        return { png, fit: plan.fit, plan };
      },
      async close() {
        await browser.close();
      },
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}
