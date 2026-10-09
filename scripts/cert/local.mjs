// رندرِ محلی برای آزمایش: node local.mjs <قالب> <فونتِ نام> <فونتِ برچسب> <پوشه‌ی خروجی> "<نام>" m|f [...]
import fs from "node:fs";
import path from "node:path";
import { openRenderer } from "./render.mjs";
const [tpl, nameFont, labelFont, outDir, ...rest] = process.argv.slice(2);
const layout = JSON.parse(fs.readFileSync(new URL("./layout.json", import.meta.url), "utf8"));
const r = await openRenderer({ templatePath: tpl, nameFontPath: nameFont, labelFontPath: labelFont, layout });
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < rest.length; i += 2) {
  const t0 = performance.now();
  const { png, fit, plan } = await r.render(rest[i], rest[i + 1]);
  const f = path.join(outDir, "cert_" + (i / 2) + "_" + rest[i + 1] + ".png");
  fs.writeFileSync(f, png);
  console.log(f, "fit=" + fit, "nameSize=" + plan.nameSize.toFixed(1), "line=" + Math.round(plan.totalWidth), "bytes=" + png.length, "ms=" + Math.round(performance.now() - t0));
}
await r.close();
