#!/usr/bin/env node
/* ============================================================================
   大阪生活 · 自动配图脚本（Pexels 免费图库）
   ----------------------------------------------------------------------------
   给 data.js 里【还没有 cover】的条目，各拉一张同类美食/景点的真实图填进 cover。
   - 用 Pexels 免费图库（图片可商用，无需署名）。
   - 只补没有 cover 的条目；已有 cover（含你自己放的实拍）会跳过，不会覆盖。
   - 直接在 data.js 原文里插入一行，保留你的注释和排版。

   ⚠️ 这些是「同类」通用图，不是那家店的实拍。要换实拍，把 cover 改成
      你自己的 images/xxx.jpg 即可（再跑本脚本也不会动它）。

   Key 怎么给（二选一，都不会写进仓库）：
     1) 环境变量：  PEXELS_API_KEY=xxxx node scripts/fetch-images.mjs
     2) 放文件：    scripts/pexels.key（已在 .gitignore 里，单独一行写 key）

   想重新换某条的图：把它的 cover 那行删掉，再跑一次本脚本。
   ============================================================================ */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data.js");
const KEY_FILE = join(__dirname, "pexels.key");
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 每条的搜索词（英文 Pexels 命中率高）。新条目可在 data.js 里加 imgQuery 覆盖。 */
const SEED_QUERIES = {
  101: "chinese hot pot", 102: "chinese hand pulled noodles",
  111: "snow crab dish", 112: "ramen bowl", 113: "sushi plate", 114: "okonomiyaki",
  121: "thai green curry", 122: "thai papaya salad",
  131: "korean bbq grill", 132: "korean stew jjigae",
  201: "osaka castle", 202: "dotonbori osaka night", 203: "tsutenkaku osaka",
  204: "aquarium jellyfish", 205: "osaka night skyline", 206: "roller coaster theme park",
  301: "hot pot dinner friends", 302: "cherry blossom picnic",
  401: "studying language books cafe", 402: "kyoto travel street",
  501: "wooden desk office chair", 502: "city bicycle",
};
const CAT_QUERY = { chinese: "chinese food", japanese: "japanese food", thai: "thai food", korean: "korean food" };
const queryFor = (it) =>
  it.imgQuery || SEED_QUERIES[it.id] || (it.category && CAT_QUERY[it.category]) ||
  (it.module === "travel" ? "japan travel" : "asian food");

function getKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
  try { return readFileSync(KEY_FILE, "utf8").trim(); } catch { return ""; }
}

function loadData() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(DATA_PATH, "utf8"), sandbox, { timeout: 3000 });
  return sandbox.window.OSAKA_DATA;
}

async function pexelsPhoto(query, key) {
  const url = "https://api.pexels.com/v1/search?orientation=portrait&per_page=3&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Authorization: key } });
  if (res.status === 429) throw new Error("Pexels 限流(429)，稍后再试");
  if (!res.ok) throw new Error("Pexels HTTP " + res.status);
  const d = await res.json();
  const p = d.photos && d.photos[0];
  return p ? p.src.large : null;
}

/* 在 data.js 原文里，对应 id 那行后面插入一行 cover，保留缩进与注释 */
function insertCover(text, id, url) {
  const re = new RegExp("^([ \\t]*)id:\\s*" + id + "\\b[^\\n]*\\n", "m");
  if (!re.test(text)) return text;
  return text.replace(re, (m, indent) => m + indent + 'cover: "' + url + '",\n');
}

(async function main() {
  const key = getKey();
  if (!key) {
    log("❌ 没找到 Pexels Key。用环境变量 PEXELS_API_KEY=xxx 运行，或把 key 写进 scripts/pexels.key");
    process.exit(1);
  }
  const data = loadData();
  let text = readFileSync(DATA_PATH, "utf8");
  const todo = data.items.filter((it) => !it.cover);
  log(`共 ${data.items.length} 条，需配图 ${todo.length} 条（已有 cover 的跳过）。`);

  let ok = 0, fail = 0;
  for (const it of todo) {
    const q = queryFor(it);
    try {
      const url = await pexelsPhoto(q, key);
      if (url) { text = insertCover(text, it.id, url); ok++; log(`  ✅ [${it.id}] "${q}" → ${url.slice(0, 60)}…`); }
      else { fail++; log(`  ⚠️ [${it.id}] "${q}" 没搜到图`); }
    } catch (e) { fail++; log(`  ⚠️ [${it.id}] "${q}" 失败：${e.message}`); }
    await sleep(250); // 对接口友好一点
  }

  // 顺手把 updatedAt 更新成今天
  text = text.replace(/updatedAt:\s*"[^"]*"/, 'updatedAt: "' + new Date().toISOString().slice(0, 10) + '"');

  writeFileSync(DATA_PATH, text, "utf8");
  log(`完成：成功 ${ok}，失败/跳过 ${fail}。已写回 data.js ✅`);
})();
