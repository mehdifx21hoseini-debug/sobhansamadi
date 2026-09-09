// پیش‌نمایش را از همان lib/sessions.js اپ می‌سازد - نه یک کپی.
// اگر موتور عوض شود، پیش‌نمایش هم همان لحظه عوض می‌شود.
import { readFileSync, writeFileSync } from "node:fs";
const R = "/home/user/sobhansamadi/";
const P = R + "design/econ-app/preview/";
const engine = readFileSync(R + "src/econ-app/lib/sessions.js", "utf8");
const css = readFileSync(P + "preview.css", "utf8");
const js = readFileSync(P + "preview.js", "utf8");
const frozen = process.argv[2] || "";
const stamp = frozen ? `window.PREVIEW_NOW = ${JSON.stringify(frozen)};\n` : "";
const html = readFileSync(P + "index.html", "utf8")
	.replace("/* build:css */", css)
	.replace("/* build:js */", stamp + engine + "\n\n" + js);
writeFileSync(P + "dashboard.html", html);
console.log("dashboard.html ساخته شد — " + (Buffer.byteLength(html) / 1024).toFixed(1) + " کیلوبایت"
	+ (frozen ? " (زمان ثابت: " + frozen + ")" : ""));
