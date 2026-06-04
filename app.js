/* ============================================================
   大阪生活 · Osaka Life —— 交互逻辑（普通脚本，读 window.OSAKA_DATA）
   ============================================================ */
(function () {
  "use strict";

  var DATA = window.OSAKA_DATA || { modules: [], foodCategories: [], areas: [], items: [] };
  var $ = function (s) { return document.querySelector(s); };

  /* 主题：决定封面渐变 + 角标配色 + 角标文字。
     food 用 category 做 key，其他模块用 module 做 key。 */
  var THEME = {
    chinese:  { grad: ["#ffd1a3", "#ff8a4c"], color: "#ff6b35", label: "中餐" },
    japanese: { grad: ["#ffc9c2", "#e8675c"], color: "#d4574e", label: "日料" },
    thai:     { grad: ["#cdeec0", "#74b65a"], color: "#5aa469", label: "泰餐" },
    korean:   { grad: ["#ffd0b0", "#e8804d"], color: "#e06a3d", label: "韩餐" },
    travel:   { grad: ["#bfe0f2", "#5a9fc9"], color: "#3f8fb9", label: "旅游" },
    events:   { grad: ["#ffe1a8", "#f0a93d"], color: "#e8932d", label: "同城" },
    social:   { grad: ["#e0d2f7", "#9a74e0"], color: "#8a5cd6", label: "交友" },
    market:   { grad: ["#c4ecdc", "#5ab48f"], color: "#3fa37a", label: "二手" },
  };
  var RATIOS = ["3 / 4", "4 / 5", "1 / 1", "4 / 3", "3 / 4", "1 / 1", "4 / 5"];

  /* 状态 */
  var curModule = (DATA.modules[0] && DATA.modules[0].key) || "food";
  var curCat = "all";
  var curArea = "all";
  var kw = "";
  var activeId = null;
  var RENDER_CAP = 150; // 单次最多渲染卡片数；数据量大时用分类/区域/搜索缩小范围

  /* ---------- 工具 ---------- */
  function themeOf(it) { return THEME[it.module === "food" ? it.category : it.module] || THEME.travel; }
  function coverBg(it) { var g = themeOf(it).grad; return "linear-gradient(150deg," + g[0] + "," + g[1] + ")"; }
  function coverSrc(it) { return it.cover || (it.images && it.images[0]) || ""; }   // 真实封面图（没有则用 emoji 占位）
  function ratioOf(id) { return RATIOS[id % RATIOS.length]; }
  function moduleLabel(key) {
    for (var i = 0; i < DATA.modules.length; i++) if (DATA.modules[i].key === key) return DATA.modules[i].label;
    return key;
  }
  function mapQuery(it) { return it.mapQuery || it.address || (it.title + " 大阪"); }
  function embedUrl(it) { return "https://maps.google.com/maps?q=" + encodeURIComponent(mapQuery(it)) + "&z=16&output=embed"; }
  function navUrl(it) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery(it)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ---------- 筛选 ---------- */
  function filtered() {
    var k = kw.trim().toLowerCase();
    return DATA.items.filter(function (it) {
      if (it.module !== curModule) return false;
      if (curModule === "food" && curCat !== "all" && it.category !== curCat) return false;
      if (curArea !== "all" && it.area !== curArea) return false;
      if (!k) return true;
      var hay = [it.title, it.desc, it.area, (it.author && it.author.name), (it.tags || []).join(" ")].join(" ").toLowerCase();
      return hay.indexOf(k) !== -1;
    });
  }

  /* ---------- 渲染：模块导航 ---------- */
  function renderModules() {
    $("#modules").innerHTML = DATA.modules.map(function (m) {
      return '<button class="mod ' + (m.key === curModule ? "on" : "") + '" data-mod="' + m.key + '">' +
        '<span class="c">' + m.icon + "</span>" + m.label + "</button>";
    }).join("");
    Array.prototype.forEach.call($("#modules").querySelectorAll(".mod"), function (el) {
      el.onclick = function () { curModule = el.dataset.mod; curCat = "all"; curArea = "all"; $("#areaSelect").value = "all"; refresh(); };
    });
  }

  /* ---------- 渲染：子分类（仅美食）---------- */
  function renderCats() {
    var box = $("#cats");
    if (curModule !== "food") { box.innerHTML = ""; return; }
    var cats = [{ key: "all", label: "全部", icon: "✨" }].concat(DATA.foodCategories);
    box.innerHTML = cats.map(function (c) {
      return '<button class="pill ' + (c.key === curCat ? "on" : "") + '" data-cat="' + c.key + '">' +
        '<span>' + c.icon + "</span>" + c.label + "</button>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".pill"), function (el) {
      el.onclick = function () { curCat = el.dataset.cat; refresh(); };
    });
  }

  /* ---------- 渲染：区域下拉 ---------- */
  function renderAreaSelect() {
    var sel = $("#areaSelect");
    if (sel.options.length) return; // 只填一次
    var opts = ['<option value="all">全部区域</option>'];
    DATA.areas.forEach(function (a) { opts.push('<option value="' + esc(a) + '">' + esc(a) + "</option>"); });
    sel.innerHTML = opts.join("");
    sel.onchange = function () { curArea = sel.value; refresh(); };
  }

  /* ---------- 渲染：瀑布流 ---------- */
  function renderFeed() {
    var list = filtered();
    var shown = list.slice(0, RENDER_CAP);
    $("#empty").style.display = list.length ? "none" : "block";
    $("#feed").innerHTML = shown.map(function (it) {
      var th = themeOf(it);
      var au = it.author || { name: "Osaka Life", avatar: "🌸" };
      var src = coverSrc(it);
      var coverInner = '<span class="chip" style="background:' + th.color + '">' + th.label + "</span>" +
        (src
          ? '<img class="cover-img" loading="lazy" src="' + esc(src) + '" alt="">'
          : '<span class="emoji">' + (it.emoji || "🌸") + '</span><span class="ph-tag">示例图 · 换成实拍</span>');
      return '<article class="card" data-id="' + it.id + '">' +
        '<div class="cover" style="aspect-ratio:' + ratioOf(it.id) + ";background:" + coverBg(it) + '">' +
          coverInner +
        "</div>" +
        '<div class="body">' +
          '<div class="title">' + esc(it.title) + "</div>" +
          (it.area ? '<div class="area-tag">📍 ' + esc(it.area) + "</div>" : "") +
          '<div class="row">' +
            '<span class="author"><span class="av">' + (au.avatar || "🌸") + '</span><span class="nm">' + esc(au.name) + "</span></span>" +
            '<span class="likes"><span class="h">❤</span> ' + esc(it.likes || "0") + "</span>" +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("");
    Array.prototype.forEach.call($("#feed").querySelectorAll(".card"), function (el) {
      el.onclick = function () { openDetail(+el.dataset.id); };
    });
    $("#feedTitle").textContent = moduleLabel(curModule);
    $("#feedCount").textContent = "共 " + list.length + " 条" +
      (list.length > shown.length ? "（显示前 " + shown.length + "，用分类/区域/搜索缩小范围）" : "");
    $("#updated").textContent = DATA.updatedAt ? "更新于 " + DATA.updatedAt : "";
  }

  function refresh() { renderModules(); renderCats(); renderFeed(); }

  /* ---------- 详情抽屉 ---------- */
  function infoRow(emoji, key, valHtml) {
    return '<div class="d-row"><span class="e">' + emoji + '</span><span class="k">' + key + '</span><span class="v">' + valHtml + "</span></div>";
  }

  // 详情页大图：有真实图就显示图片，否则回退到 emoji 占位
  function setHero(src, emoji) {
    var img = $("#dCoverImg"), em = $("#dEmoji"), tag = $("#dCoverTag");
    if (src) {
      img.src = src; img.style.display = "block";
      em.style.display = "none"; if (tag) tag.style.display = "none";
    } else {
      img.removeAttribute("src"); img.style.display = "none";
      em.style.display = ""; em.textContent = emoji; if (tag) tag.style.display = "";
    }
  }

  function openDetail(id) {
    var it = null;
    for (var i = 0; i < DATA.items.length; i++) if (DATA.items[i].id === id) { it = DATA.items[i]; break; }
    if (!it) return;
    activeId = id;
    var th = themeOf(it);
    var au = it.author || { name: "Osaka Life", avatar: "🌸" };

    $("#dCover").style.background = coverBg(it);
    setHero(coverSrc(it), it.emoji || "🌸");

    var chips = '<span class="d-chip" style="background:' + th.color + '">' + th.label + "</span>";
    if (it.area) chips += '<span class="d-chip" style="background:#5b5d6b">📍 ' + esc(it.area) + "</span>";

    var info = "";
    if (it.price)   info += infoRow("💰", "人均", esc(it.price));
    if (it.hours)   info += infoRow("🕒", "营业", esc(it.hours));
    if (it.date)    info += infoRow("📅", "时间", esc(it.date));
    if (it.contact) info += infoRow("✉️", "联系", esc(it.contact));
    if (it.address) info += infoRow("📍", "地址", esc(it.address) + '<span class="copy" id="dCopy">复制</span>');

    var tags = (it.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");

    var gallery = "";
    if (it.images && it.images.length) {
      gallery = '<div class="d-gallery">' +
        it.images.map(function (u) { return '<img loading="lazy" src="' + esc(u) + '" alt="">'; }).join("") +
        "</div>";
    }

    var mapBlock = "";
    var actions = "";
    if (it.address || it.mapQuery) {   // 有地址或坐标(mapQuery)就显示地图
      mapBlock = '<div class="d-map-label">🗺️ 位置（Google 地图）</div>' +
        '<div class="d-map"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' + embedUrl(it) + '"></iframe></div>';
      actions = '<div class="d-actions">' +
        (it.address ? '<button class="btn ghost" id="dCopy2">📋 复制地址</button>' : '') +
        '<a class="btn primary" target="_blank" rel="noopener" href="' + navUrl(it) + '">🧭 Google 导航</a>' +
      "</div>";
    }

    $("#dBody").innerHTML =
      '<div class="d-chips">' + chips + "</div>" +
      '<h2 class="d-title">' + esc(it.title) + "</h2>" +
      '<div class="d-author"><span class="av">' + (au.avatar || "🌸") + "</span>" +
        '<div><div class="nm">' + esc(au.name) + '</div><div class="meta">' + moduleLabel(it.module) + " · 笔记</div></div></div>" +
      '<div class="d-stats">' +
        '<div class="it"><span class="v red">' + esc(it.likes || "0") + '</span><span class="k">点赞</span></div>' +
        '<div class="it"><span class="v">' + esc(it.collects || "0") + '</span><span class="k">收藏</span></div>' +
        '<div class="it"><span class="v">' + esc(it.comments || "0") + '</span><span class="k">评论</span></div>' +
      "</div>" +
      gallery +
      '<div class="d-desc">' + esc(it.desc) + "</div>" +
      (info ? '<div class="d-info">' + info + "</div>" : "") +
      (tags ? '<div class="d-tags">' + tags + "</div>" : "") +
      mapBlock +
      actions;

    // 复制地址（两处按钮共用）
    var copyAddr = function () { copyText(it.address); };
    if ($("#dCopy")) $("#dCopy").onclick = copyAddr;
    if ($("#dCopy2")) $("#dCopy2").onclick = copyAddr;

    // 点图廊小图切换大图
    Array.prototype.forEach.call($("#dBody").querySelectorAll(".d-gallery img"), function (im) {
      im.onclick = function () { setHero(im.src, ""); };
    });

    $("#dBody").scrollTop = 0;
    $("#scrim").classList.add("show");
    $("#drawer").classList.add("show");
    $("#drawer").setAttribute("aria-hidden", "false");
  }

  function closeDetail() {
    $("#scrim").classList.remove("show");
    $("#drawer").classList.remove("show");
    $("#drawer").setAttribute("aria-hidden", "true");
    activeId = null;
  }

  function copyText(text) {
    var done = function () { toast("已复制 ✓"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动复制"); }
    document.body.removeChild(ta);
  }

  /* ---------- footer ---------- */
  function renderFoot() {
    $("#foot").innerHTML =
      "内容为示例/整理，仅供参考。配图来自 Pexels 免费图库，为同类通用图、非该店实拍，可换成你自己的实拍。" +
      "地址用 Google 地图嵌入展示，位置以地图实际为准。本站模仿小红书的浏览体验，不抓取其实际内容/图片。" +
      "<br>想加内容 / 改分类：直接编辑 <b>data.js</b>。";
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    var input = $("#search");
    input.addEventListener("input", function () {
      kw = input.value;
      $("#searchClear").style.display = kw ? "block" : "none";
      renderFeed();
    });
    $("#searchClear").onclick = function () {
      input.value = ""; kw = ""; $("#searchClear").style.display = "none"; input.focus(); renderFeed();
    };
    $("#dClose").onclick = closeDetail;
    $("#scrim").onclick = closeDetail;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });
  }

  /* ---------- 启动 ---------- */
  renderAreaSelect();
  renderModules();
  renderCats();
  renderFeed();
  renderFoot();
  bindEvents();
})();
