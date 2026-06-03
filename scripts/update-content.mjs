#!/usr/bin/env node
/* ============================================================================
   大阪生活 · 内容定时更新脚本（壳子 / 框架）
   ----------------------------------------------------------------------------
   作用：被定时任务（每天 07:00 / 19:00）调用，去「数据源」抓最新内容，
         合并进 ../data.js，并更新 updatedAt。

   ⚠️ 关于小红书爬取（必须说清楚）：
     小红书有强反爬（登录墙 + 接口签名 x-s/x-t + 设备风控），没有官方公开 API。
     无人值守的稳定爬虫无法保证，且涉及其服务条款风险。
     因此下面的 fetchFromXiaohongshu() 是【占位/待接入】，默认不抓任何东西、
     不会改动你的 data.js。把它替换成你自己的可用数据源后，本脚本即可自动跑。

   可选的「数据源」实现思路（自行评估合规与可行性）：
     1) 手动维护：直接编辑 ../data.js（最稳）；本脚本可不跑。
     2) 半自动：用你登录后的 Cookie，请求你关注/收藏的笔记接口（脆弱、会过期）。
     3) RSS/中转：若有可用的镜像/RSS 源，在这里 fetch 后映射成 item。

   用法：
     node scripts/update-content.mjs            # 正常运行（无新内容则不改文件）
     node scripts/update-content.mjs --dry-run  # 只打印，不写文件
   ============================================================================ */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "data.js");
const DRY = process.argv.includes("--dry-run");
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

/* ---------- 读取现有 data.js（在沙箱里执行，拿到对象） ---------- */
function loadData() {
  const code = readFileSync(DATA_PATH, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 3000 });
  const data = sandbox.window.OSAKA_DATA;
  if (!data || !Array.isArray(data.items)) throw new Error("data.js 解析失败：找不到 window.OSAKA_DATA.items");
  return data;
}

/* ---------- 写回 data.js（仅当有变化时调用） ---------- */
function saveData(data) {
  const header =
    "/* 自动生成：由 scripts/update-content.mjs 更新。手动新增内容也可直接编辑本文件。\n" +
    "   字段说明见 README。最近更新：" + data.updatedAt + " */\n";
  const body = "window.OSAKA_DATA = " + JSON.stringify(data, null, 2) + ";\n";
  writeFileSync(DATA_PATH, header + body, "utf8");
}

/* ---------- 【待接入】从数据源抓内容 ----------
   返回一个 item 数组（字段见 data.js 注释）。
   现在是占位：返回空数组 + 打印提示。接入真实数据源后改这里即可。 */
async function fetchFromXiaohongshu() {
  // —— 在这里实现你的抓取逻辑，把结果映射成 item，例如： ——
  // return [{
  //   id: Date.now(), module: "food", category: "japanese", area: "难波/心斋桥",
  //   emoji: "🍣", title: "...", author: { name: "...", avatar: "🌸" },
  //   likes: "1.2w", collects: "8000", comments: "300",
  //   tags: ["..."], desc: "...", address: "...",
  //   source: { platform: "xiaohongshu", url: "https://www.xiaohongshu.com/..." },
  // }];
  log("ℹ️  fetchFromXiaohongshu() 尚未接入数据源，本次不抓取任何内容。");
  log("    把脚本里的这个函数替换成你的可用数据源即可启用自动更新（见文件顶部说明）。");
  return [];
}

/* ---------- 合并：按 source.url 或 id 去重 ---------- */
function mergeItems(existing, incoming) {
  const seen = new Set(existing.map((it) => (it.source && it.source.url) || String(it.id)));
  const fresh = incoming.filter((it) => {
    const k = (it.source && it.source.url) || String(it.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { merged: existing.concat(fresh), addedCount: fresh.length };
}

function today() { return new Date().toISOString().slice(0, 10); }

/* ---------- 主流程 ---------- */
(async function main() {
  log("开始更新内容…", DRY ? "(dry-run)" : "");
  const data = loadData();
  log(`现有内容 ${data.items.length} 条。`);

  let incoming = [];
  try {
    incoming = await fetchFromXiaohongshu();
  } catch (e) {
    log("⚠️  抓取失败：", e.message, "—— 保持现有内容不变。");
    process.exit(0);
  }

  const { merged, addedCount } = mergeItems(data.items, incoming);
  if (addedCount === 0) {
    log("没有新内容，data.js 保持不变。✅");
    return;
  }

  data.items = merged;
  data.updatedAt = today();
  log(`新增 ${addedCount} 条，共 ${merged.length} 条。`);
  if (DRY) { log("dry-run：不写文件。"); return; }
  saveData(data);
  log("已写入 data.js ✅");
})();
