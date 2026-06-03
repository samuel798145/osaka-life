#!/usr/bin/env node
/* ============================================================================
   大阪生活 · 从 OpenStreetMap 批量导入餐厅（免费，无需 key / 信用卡）
   ----------------------------------------------------------------------------
   用 Overpass API 查询大阪市范围内、标了指定 cuisine 的真实餐厅，映射成 item
   追加进 ../data.js（去重：已导入过的 OSM 点 + 与现有标题重名的会跳过）。

   用法：
     node scripts/import-osm.mjs                 # 默认导入中餐(chinese)
     node scripts/import-osm.mjs --cuisine korean   # 韩餐
     node scripts/import-osm.mjs --cuisine japanese # 日料
     node scripts/import-osm.mjs --max 50           # 限制条数

   说明（诚实）：OSM 是社区数据，覆盖不全、店名多为日文、没有照片、营业时间常缺。
   导入的条目作者标为「地图收录·待完善」、互动数为 0，方便你后续补描述/换实拍图。
   配图：导入后跑 `node scripts/fetch-images.mjs` 会给它们补 Pexels 通用图。
   ============================================================================ */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data.js");
const log = (...a) => console.log(...a);
const argOf = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };

const CUISINE = argOf("cuisine", "chinese");
const MAX = parseInt(argOf("max", "80"), 10);
const CATEGORY = CUISINE; // data.js 的 category 用同名（chinese/japanese/thai/korean）

// 各 cuisine 对应的 OSM cuisine 正则 + 卡片 emoji
const CUISINE_CFG = {
  chinese:  { re: "chinese|sichuan|cantonese|shanghai|dim_sum|hot_pot|hotpot|dumpling|szechuan|taiwanese|uyghur", emoji: "🥡", zh: "中餐" },
  korean:   { re: "korean|bbq|samgyeopsal", emoji: "🥘", zh: "韩餐" },
  japanese: { re: "japanese|sushi|ramen|izakaya|udon|tempura|yakitori|okonomiyaki", emoji: "🍣", zh: "日料" },
  thai:     { re: "thai", emoji: "🍤", zh: "泰餐" },
};
const CFG = CUISINE_CFG[CUISINE] || CUISINE_CFG.chinese;

// 大阪市大致范围（south,west,north,east）
const BBOX = "34.58,135.42,34.75,135.58";

// 区域中心点 → 给导入项就近分配区域（与 data.js 的 areas 对齐）
const AREA_POINTS = {
  "难波/心斋桥": [34.668, 135.501], "梅田/大阪站": [34.702, 135.498],
  "天王寺/阿倍野": [34.646, 135.514], "新世界/通天阁": [34.652, 135.506],
  "鹤桥(韩国城)": [34.665, 135.534], "日本桥/黑门": [34.662, 135.506],
  "本町/堺筋本町": [34.683, 135.503], "京桥/大阪城": [34.687, 135.534],
  "美国村": [34.671, 135.498], "港区/天保山": [34.655, 135.430], "此花区(USJ)": [34.665, 135.432],
};
function nearestArea(lat, lng) {
  let best = "关西/其他", bd = Infinity;
  for (const [a, [y, x]] of Object.entries(AREA_POINTS)) {
    const d = (lat - y) ** 2 + (lng - x) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  return bd <= 0.0016 ? best : "关西/其他"; // ~4km 内才算该区域
}

function imgQueryFor(cuisine) {
  const c = (cuisine || "").toLowerCase();
  if (CUISINE === "korean") return c.includes("bbq") ? "korean bbq grill" : "korean food";
  if (CUISINE === "japanese") return c.includes("sushi") ? "sushi" : c.includes("ramen") ? "ramen" : "japanese food";
  if (CUISINE === "thai") return "thai food";
  if (c.includes("sichuan") || c.includes("szechuan")) return "sichuan food";
  if (c.includes("hot_pot") || c.includes("hotpot")) return "chinese hotpot";
  if (c.includes("dim_sum") || c.includes("cantonese")) return "dim sum";
  if (c.includes("dumpling")) return "chinese dumplings";
  if (c.includes("shanghai")) return "shanghai food";
  if (c.includes("uyghur")) return "lamb skewers";
  return "chinese restaurant food";
}

function loadData() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(DATA_PATH, "utf8"), sandbox, { timeout: 3000 });
  return sandbox.window.OSAKA_DATA;
}
const norm = (s) => (s || "").toLowerCase().replace(/[\s　・·,，。.、「」『』()（）]/g, "");

function toLiteral(it) {
  const L = ["    {"];
  L.push(`      id: ${it.id}, module: "food", category: ${JSON.stringify(CATEGORY)}, area: ${JSON.stringify(it.area)}, emoji: "${CFG.emoji}",`);
  L.push(`      imgQuery: ${JSON.stringify(it.imgQuery)},`);
  L.push(`      mapQuery: ${JSON.stringify(it.mapQuery)},`);
  L.push(`      title: ${JSON.stringify(it.title)},`);
  L.push(`      author: { name: "地图收录·待完善", avatar: "🗺️" },`);
  L.push(`      likes: "0", collects: "0", comments: "0",`);
  L.push(`      tags: ${JSON.stringify(it.tags)},`);
  L.push(`      desc: ${JSON.stringify(it.desc)},`);
  if (it.address) L.push(`      address: ${JSON.stringify(it.address)},`);
  L.push(`      source: ${JSON.stringify(it.source)},`);
  L.push("    },");
  return L.join("\n");
}

(async function main() {
  log(`从 OpenStreetMap 拉「${CFG.zh}」(cuisine~${CFG.re.split("|")[0]}…) @ 大阪…`);
  const query = `[out:json][timeout:60];
(
  node["amenity"="restaurant"]["cuisine"~"${CFG.re}",i](${BBOX});
  way["amenity"="restaurant"]["cuisine"~"${CFG.re}",i](${BBOX});
);
out center tags;`;

  const ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];
  const HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
    "User-Agent": "osaka-life-import/1.0 (personal project)",
  };
  let elements = null, lastErr = "";
  for (const ep of ENDPOINTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(ep, { method: "POST", headers: HEADERS, body: "data=" + encodeURIComponent(query), signal: ctrl.signal });
      if (!res.ok) { lastErr = ep + " → HTTP " + res.status; continue; }
      elements = (await res.json()).elements || [];
      log("数据源：" + ep);
      break;
    } catch (e) { lastErr = ep + " → " + e.message; }
    finally { clearTimeout(t); }
  }
  if (!elements) { log("❌ Overpass 全部失败：", lastErr); process.exit(1); }
  log(`Overpass 返回 ${elements.length} 个点。`);

  const data = loadData();
  const existingOsm = new Set(data.items.filter((i) => i.source && i.source.platform === "osm").map((i) => i.source.id));
  const existingNames = data.items.map((i) => norm((i.title || "").split("｜")[0])).filter((s) => s.length >= 2);
  let nextId = Math.max(0, ...data.items.map((i) => +i.id || 0)) + 1;

  const seen = new Set();
  const picked = [];
  for (const el of elements) {
    if (picked.length >= MAX) break;
    const tags = el.tags || {};
    const name = tags["name:zh"] || tags.name || tags["name:en"] || tags["name:ja"];
    if (!name) continue;
    const lat = el.lat ?? (el.center && el.center.lat);
    const lng = el.lon ?? (el.center && el.center.lon);
    if (lat == null || lng == null) continue;
    const osmId = el.type + "/" + el.id;
    if (existingOsm.has(osmId)) continue;
    const nn = norm(name);
    if (seen.has(nn)) continue;
    if (existingNames.some((en) => en && (en.includes(nn) || nn.includes(en)))) continue; // 与现有重名跳过
    seen.add(nn);

    const cuisine = tags.cuisine || "";
    const extraTags = cuisine.split(/[;,]/).map((s) => s.trim()).filter((s) => s && s !== "chinese" && s !== "korean" && s !== "japanese" && s !== "thai").slice(0, 2);
    picked.push({
      id: nextId++, area: nearestArea(lat, lng),
      imgQuery: imgQueryFor(cuisine),
      mapQuery: `${lat},${lng}`,
      title: name,
      tags: [CFG.zh, ...extraTags],
      desc: `来自 OpenStreetMap 的${CFG.zh}收录${cuisine ? "（菜系：" + cuisine + "）" : ""}。招牌菜、点评和实拍图待补充——欢迎完善。`,
      address: tags["addr:full"] || "",
      source: { platform: "osm", id: osmId, name },
    });
  }

  log(`去重后可新增 ${picked.length} 条${elements.length > picked.length ? "（含重复/已存在/无名/超上限已过滤）" : ""}。`);
  if (!picked.length) { log("没有新增，data.js 不变。"); return; }

  let text = readFileSync(DATA_PATH, "utf8");
  const literals = picked.map(toLiteral).join("\n") + "\n";
  text = text.replace(/\n  \],\n\};/, "\n" + literals + "  ],\n};");
  text = text.replace(/updatedAt:\s*"[^"]*"/, 'updatedAt: "' + new Date().toISOString().slice(0, 10) + '"');
  writeFileSync(DATA_PATH, text, "utf8");
  log(`✅ 已写入 ${picked.length} 条到 data.js。接着跑 node scripts/fetch-images.mjs 配图。`);
})();
