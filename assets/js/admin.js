/* ==========================================================================
   义乌AI圈 · 账房后台
   单文件 SPA：hash 路由 + 七个模块，全部数据可在界面里改。
   ========================================================================== */
(function () {
  "use strict";

  var DB = window.AdminDB;
  var db = DB.db;
  var SKEY = "ywai.admin.session.v1";
  var DAY = 86400000;

  var gate = document.getElementById("gate");
  var app = document.getElementById("app");
  var navEl = document.getElementById("nav");
  var viewEl = document.getElementById("view");
  var crumbEl = document.getElementById("crumb");
  var dateEl = document.getElementById("today");

  var drawer = document.getElementById("drawer");
  var drawerVeil = document.getElementById("veil");
  var drawerBody = document.getElementById("drawerBody");
  var drawerFoot = document.getElementById("drawerFoot");
  var drawerKicker = document.getElementById("drawerKicker");
  var drawerTitle = document.getElementById("drawerTitle");
  var drawerSub = document.getElementById("drawerSub");

  var modal = document.getElementById("amodal");
  var modalBody = document.getElementById("amodalBody");
  var modalFoot = document.getElementById("amodalFoot");
  var modalKicker = document.getElementById("amodalKicker");
  var modalTitle = document.getElementById("amodalTitle");
  var modalSub = document.getElementById("amodalSub");
  var modalSheet = document.getElementById("amodalSheet");

  var state = {
    route: "dashboard",
    formSave: null,
    del: null,
    f: {
      users: { q: "", plan: "all", status: "all" },
      billing: { status: "all" },
      merchants: { q: "", zone: "all", status: "all" },
      products: { q: "", cat: "all", status: "all" },
      articles: { q: "", type: "all", status: "all" },
      posts: { q: "", status: "all" }
    }
  };

  /* ---------------- tiny utils ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function $(s) { return document.querySelector(s); }

  function opts(list, cur) {
    return list.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(cur) ? " selected" : "") + ">" + esc(o.t) + "</option>";
    }).join("");
  }

  function money(n) { return DB.money(n); }

  function toneClass(t) {
    return ["", "", "avatar--red", "avatar--teal", "avatar--gold"][Number(t) || 0] || "";
  }

  function planPill(id) {
    var p = DB.planOf(id);
    var cls = id === "free" ? "pill--mute" : id === "pro" ? "pill--red" : "pill--ink";
    return '<span class="pill ' + cls + '">' + esc(p.name) + "</span>";
  }

  function userPill(s) {
    if (s === "active") return '<span class="pill pill--ok">正常</span>';
    if (s === "expired") return '<span class="pill pill--warn">已过期</span>';
    return '<span class="pill pill--red">已冻结</span>';
  }

  function orderPill(s) {
    if (s === "paid") return '<span class="pill pill--ok">已支付</span>';
    if (s === "pending") return '<span class="pill pill--warn">待支付</span>';
    return '<span class="pill pill--red">已退款</span>';
  }

  function merchantPill(s) {
    if (s === "approved") return '<span class="pill pill--ok">已通过</span>';
    if (s === "pending") return '<span class="pill pill--warn">待审核</span>';
    return '<span class="pill pill--red">已拒绝</span>';
  }

  function articlePill(s) {
    return s === "published" ? '<span class="pill pill--ok">已发布</span>' : '<span class="pill pill--warn">草稿</span>';
  }

  function dayLabels(n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * DAY);
      out.push(String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    }
    return out;
  }

  function toast(msg) {
    var stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-out");
      setTimeout(function () { el.remove(); }, 240);
    }, 2600);
  }

  function lineChart(values, labels) {
    values = labels.map(function (_, index) { return Number(values[index]) || 0; });
    var W = 720, H = 208, L = 40, R = 10, T = 12, B = 26;
    var max = Math.max.apply(null, values) * 1.14 || 1;
    var iw = W - L - R, ih = H - T - B;
    var step = iw / (values.length - 1);
    var pts = values.map(function (v, i) {
      return [L + i * step, T + ih - (v / max) * ih];
    });
    var d = pts.map(function (p, i) {
      return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join(" ");
    var area = d + " L " + (L + iw).toFixed(1) + " " + (T + ih) + " L " + L + " " + (T + ih) + " Z";

    var grid = "";
    for (var i = 0; i <= 4; i++) {
      var y = T + ih - (ih * i) / 4;
      grid += '<line class="axis" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
      grid += '<text x="' + (L - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + Math.round((max * i) / 4) + "</text>";
    }

    var xl = "";
    labels.forEach(function (l, idx) {
      if (idx % 2 === 0 || idx === labels.length - 1) {
        xl += '<text x="' + pts[idx][0].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + l + "</text>";
      }
    });

    var dots = pts.map(function (p) {
      return '<circle class="dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.4"/>';
    }).join("");

    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="近 12 日流水">' +
      grid + xl + '<path class="area" d="' + area + '"/>' +
      '<path class="line" d="' + d + '"/>' + dots + "</svg>";
  }

  /* ---------------- drawer / modal ---------------- */
  function openDrawer(o) {
    drawerKicker.textContent = o.kicker || "";
    drawerTitle.textContent = o.title || "";
    drawerSub.textContent = o.sub || "";
    drawerBody.innerHTML = o.body || "";
    drawerFoot.innerHTML = o.foot || "";
    drawer.classList.toggle("drawer--wide", !!o.wide);
    state.formSave = o.save || null;
    drawerVeil.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    var first = drawerBody.querySelector("input, select, textarea");
    if (first) setTimeout(function () { first.focus(); }, 130);
  }

  function closeDrawer() {
    if (drawer.contains(document.activeElement)) document.activeElement.blur();
    drawerVeil.classList.remove("is-open");
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    state.formSave = null;
  }

  function openModal(o) {
    modalKicker.textContent = o.kicker || "";
    modalTitle.textContent = o.title || "";
    modalSub.textContent = o.sub || "";
    modalBody.innerHTML = '<form id="modalForm" class="amodal__body">' + (o.body || "") + "</form>";
    modalFoot.innerHTML = o.foot || "";
    modalSheet.className = "modal__sheet" + (o.lg ? " modal__sheet--lg" : "");
    state.formSave = o.save || null;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    var first = modalBody.querySelector("input, select, textarea");
    if (first) setTimeout(function () { first.focus(); }, 130);
  }

  function closeModal() {
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    state.formSave = null;
  }

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.id !== "drawerForm" && f.id !== "modalForm") return;
    e.preventDefault();
    var data = {};
    new FormData(f).forEach(function (v, k) { data[k] = v; });
    if (typeof state.formSave === "function") state.formSave(data, f);
  });

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-close-drawer]")) { closeDrawer(); return; }
    if (e.target.closest("[data-close-modal]")) { closeModal(); return; }
    var sw = e.target.closest("[data-toggle]");
    if (sw) {
      var on = sw.getAttribute("aria-checked") === "true";
      sw.setAttribute("aria-checked", String(!on));
      var hidden = sw.parentElement.querySelector('input[type="hidden"]');
      if (hidden) hidden.value = on ? "0" : "1";
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("is-open")) closeModal();
    else if (drawer.classList.contains("is-open")) closeDrawer();
  });

  drawerVeil.addEventListener("click", closeDrawer);

  /* ---------------- nav ---------------- */
  /* 扩展模块（如活动报名 admin-events.js）登记的角标、动作 */
  var EXTRA_BADGES = {};
  var ACTIONS = {};

  function counts() {
    return {
      users: db.users.length,
      orders: db.orders.filter(function (o) { return o.status === "pending"; }).length,
      merchants: db.merchants.filter(function (m) { return m.status === "pending"; }).length,
      articles: db.articles.filter(function (a) { return a.status === "draft"; }).length,
      posts: db.posts.filter(function (p) { return p.status === "reported"; }).length,
      leads: EXTRA_BADGES.leads || 0
    };
  }

  var NAV = [
    { group: "概览", items: [{ id: "dashboard", label: "总览", i: "01" }] },
    {
      group: "用户与订阅", items: [
        { id: "users", label: "用户", i: "02", badge: "users" },
        { id: "billing", label: "方案与订单", i: "03", badge: "orders" }
      ]
    },
    {
      group: "商家与产品", items: [
        { id: "merchants", label: "商家档口", i: "04", badge: "merchants" },
        { id: "products", label: "AI 工具", i: "05" }
      ]
    },
    {
      group: "内容运营", items: [
        { id: "articles", label: "资讯与政策", i: "06", badge: "articles" },
        { id: "posts", label: "社区帖子", i: "07", badge: "posts" }
      ]
    },
    {
      group: "活动运营", items: [
        { id: "events", label: "活动报名", i: "10" },
        { id: "leads", label: "客资", i: "11", badge: "leads" },
        { id: "partners", label: "合作伙伴", i: "12" }
      ]
    },
    { group: "系统", items: [{ id: "settings", label: "站点设置", i: "08" }, { id: "audit", label: "操作日志", i: "09" }] }
  ];

  var TITLES = {
    dashboard: "总览",
    users: "用户",
    billing: "方案与订单",
    merchants: "商家档口",
    products: "AI 工具",
    articles: "资讯与政策",
    posts: "社区帖子",
    settings: "站点设置",
    audit: "操作日志",
    events: "活动报名",
    leads: "客资",
    partners: "合作伙伴"
  };

  function renderNav() {
    var c = counts();
    navEl.innerHTML = NAV.map(function (g) {
      return '<div class="side__group">' + g.group + "</div>" +
        g.items.map(function (it) {
          var n = it.badge ? c[it.badge] : 0;
          return '<a class="side__link' + (state.route === it.id ? " is-on" : "") + '" href="#/' + it.id + '">' +
            '<span class="i">' + it.i + "</span>" + it.label +
            (n ? '<span class="side__badge">' + n + "</span>" : "") + "</a>";
        }).join("");
    }).join("");
  }

  /* ---------------- router ---------------- */
  function routeName() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    return Object.prototype.hasOwnProperty.call(TITLES, h) ? h : "dashboard";
  }

  var PAINT = {};

  function render() {
    state.route = routeName();
    renderNav();
    crumbEl.textContent = TITLES[state.route];
    var v = VIEWS[state.route];
    viewEl.innerHTML = v.html();
    if (PAINT[state.route]) PAINT[state.route]();
  }

  window.addEventListener("hashchange", render);

  document.addEventListener("click", function (e) {
    var go = e.target.closest("[data-go]");
    if (go) {
      e.preventDefault();
      location.hash = "#/" + go.dataset.go;
    }
  });

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  var VIEWS = {};

  VIEWS.dashboard = {
    html: function () {
      var paid = db.users.filter(function (u) { return u.plan !== "free" && u.status === "active"; });
      var revenue = db.stats.revenue.reduce(function (a, b) { return a + b; }, 0);
      var c = counts();
      var tasks = c.merchants + c.articles + c.posts + db.users.filter(function (u) { return u.status === "expired"; }).length;

      var planRows = db.plans.map(function (p) {
        var n = db.users.filter(function (u) { return u.plan === p.id; }).length;
        var pct = db.users.length ? Math.round((n / db.users.length) * 100) : 0;
        return '<div class="dist__row">' +
          '<div class="dist__top"><b>' + esc(p.name) + "</b>" +
          '<span>' + n + " 人 · " + pct + "%</span></div>" +
          '<div class="dist__track"><i class="' + (p.id === "pro" ? "red" : p.id === "studio" ? "teal" : "") + '" style="width:' + pct + '%"></i></div>' +
          "</div>";
      }).join("");

      var recent = db.orders.slice().sort(function (a, b) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }).slice(0, 6);

      var orderRows = recent.map(function (o) {
        return "<tr class=\"is-static\">" +
          '<td class="num">' + esc(o.id) + "</td>" +
          '<td class="strong">' + esc(o.userName) + "</td>" +
          "<td>" + planPill(o.plan) + "</td>" +
          '<td class="num">' + money(o.amount) + "</td>" +
          "<td>" + orderPill(o.status) + "</td>" +
          '<td class="num muted">' + esc(o.createdAt) + "</td>" +
          "</tr>";
      }).join("");

      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>00</b><span>今日经营</span></div>' +
        "<h1>总览</h1>" +
        '<p class="ahead__sub">查看用户、订阅、商家和内容。数据同步状态显示在页面顶部。</p></div>' +
        '<div class="ahead__actions">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-go="articles">发一条资讯</button>' +
        '<button class="btn btn--sm btn--red" type="button" data-go="users">管理用户</button>' +
        "</div></div>" +

        '<div class="kpis">' +
        '<div class="kpi"><div class="kpi__label"><span>总用户</span><i>TOTAL</i></div>' +
        '<div class="kpi__value">' + db.users.length + "</div>" +
        '<div class="kpi__foot">活跃 <b>' + db.users.filter(function (u) { return u.status === "active"; }).length + "</b> · 冻结 <b>" +
        db.users.filter(function (u) { return u.status === "frozen"; }).length + "</b></div></div>" +
        '<div class="kpi"><div class="kpi__label"><span>付费订阅</span><i>PAID</i></div>' +
        '<div class="kpi__value">' + paid.length + '<small> / ' + db.users.length + "</small></div>" +
        '<div class="kpi__foot">付费率 <b>' + (db.users.length ? Math.round((paid.length / db.users.length) * 100) : 0) + "%</b></div></div>" +
        '<div class="kpi"><div class="kpi__label"><span>近 12 日流水</span><i>GMV</i></div>' +
        '<div class="kpi__value">' + money(revenue) + "</div>" +
        '<div class="kpi__foot kpi__up"><b>+23.4%</b> 较上周期</div></div>' +
        '<div class="kpi"><div class="kpi__label"><span>待处理</span><i>TODO</i></div>' +
        '<div class="kpi__value">' + tasks + "</div>" +
        '<div class="kpi__foot">审核 <b>' + c.merchants + '</b> · 草稿 <b>' + c.articles + "</b> · 举报 <b>" + c.posts +
        "</b> · 过期 <b>" + db.users.filter(function (u) { return u.status === "expired"; }).length + "</b></div></div>" +
        "</div>" +

        '<div class="grid-2">' +
        '<div class="panel"><div class="panel__head"><div class="panel__title">流水趋势 <span class="mono">近 12 日</span></div>' +
        '<div class="chart-legend"><span><i></i>每日流水</span></div></div>' +
        '<div class="panel__body">' + lineChart(db.stats.revenue, dayLabels(12)) + "</div></div>" +
        '<div class="panel"><div class="panel__head"><div class="panel__title">订阅分布</div>' +
        '<span class="mono" style="color:var(--ink-40)">方案</span></div>' +
        '<div class="panel__body"><div class="dist">' + planRows + "</div>" +
        '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--ink-12);display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-55)">' +
        "<span>本月新增订阅</span><b style=\"font-family:var(--f-mono);color:var(--ink)\">" +
        db.orders.filter(function (o) { return o.status === "paid"; }).length + " 单</b></div></div></div>" +
        "</div>" +

        '<div class="grid-2 grid-2--even">' +
        '<div class="panel"><div class="panel__head"><div class="panel__title">最近订单</div>' +
        '<a class="panel__link" href="#/billing">全部订单 →</a></div>' +
        '<div class="panel__body panel__body--flush"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>订单号</th><th>用户</th><th>方案</th><th>金额</th><th>状态</th><th>日期</th>" +
        "</tr></thead><tbody>" + orderRows + "</tbody></table></div></div></div>" +

        '<div class="panel"><div class="panel__head"><div class="panel__title">待办</div>' +
        '<span class="mono" style="color:var(--red)">' + tasks + " 项</span></div>" +
        '<div class="todo">' +
        todoItem(1, "商家入驻待审核", c.merchants + " 家 · 超 24 小时未处理", "merchants", c.merchants > 0) +
        todoItem(2, "资讯草稿待发布", c.articles + " 篇 · 政策与选题", "articles", c.articles > 0) +
        todoItem(3, "社区举报待处理", c.posts + " 条 · 含广告与引流", "posts", c.posts > 0) +
        todoItem(4, "订阅到期提醒", db.users.filter(function (u) { return u.status === "expired"; }).length + " 位用户已过期", "users", false) +
        "</div></div></div>";
    }
  };

  function todoItem(n, title, sub, go, hot) {
    return '<a class="todo__item' + (hot ? " is-hot" : "") + '" href="#/' + go + '">' +
      '<span class="todo__n">' + n + "</span>" +
      '<span class="todo__body"><strong>' + esc(title) + "</strong><span>" + esc(sub) + "</span></span>" +
      '<span class="mono" style="color:var(--ink-30)">→</span></a>';
  }

  /* ======================================================================
     USERS
     ====================================================================== */
  VIEWS.users = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>02</b><span>用户与订阅</span></div>' +
        "<h1>用户</h1><p class=\"ahead__sub\">这里是前台真实注册的用户。改方案、改到期、冻结账号都会立即生效：冻结后对方会被登出，无法再登录、发帖和评论。</p></div>" +
        '<div class="ahead__actions"><button class="btn btn--sm btn--red" type="button" data-act="user:new">新增用户</button></div></div>' +

        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索昵称或手机号" data-f="q" value="' + esc(state.f.users.q) + '"></label>' +
        chipGroup("users", "plan", [["all", "全部方案"], ["free", "体验版"], ["pro", "经营者"], ["studio", "老板娘"]]) +
        chipGroup("users", "status", [["all", "全部状态"], ["active", "正常"], ["expired", "已过期"], ["frozen", "已冻结"]]) +
        '<span class="filters__count">共 <b id="uCount">0</b> 人</span>' +
        '</div><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>用户</th><th>方案</th><th>状态</th><th>到期</th><th>累计消费</th><th>发帖</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="uBody"></tbody></table></div></div>';
    }
  };

  function chipGroup(view, group, list) {
    var cur = state.f[view][group];
    return '<div style="display:flex;gap:5px;flex-wrap:wrap">' + list.map(function (it) {
      return '<button class="chip' + (cur === it[0] ? " is-on" : "") + '" type="button" data-filter="' + group + '" data-val="' + esc(it[0]) + '">' + esc(it[1]) + "</button>";
    }).join("") + "</div>";
  }

  PAINT.users = function () {
    var f = state.f.users;
    var rows = db.users.filter(function (u) {
      if (f.plan !== "all" && u.plan !== f.plan) return false;
      if (f.status !== "all" && u.status !== f.status) return false;
      if (f.q && (u.name + u.phone).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });

    $("#uBody").innerHTML = rows.length ? rows.map(function (u) {
      var left = DB.daysLeft(u.expire);
      var expTxt = u.expire ? u.expire : "—";
      var expCls = left !== null && left <= 7 ? "color:var(--red)" : "";
      return '<tr data-act="user:open" data-id="' + esc(u.id) + '">' +
        '<td><div class="tbl__user"><span class="avatar ' + toneClass(u.tone) + '">' + esc(u.name.slice(0, 1)) + "</span>" +
        "<div><strong>" + esc(u.name) + "</strong><span>" + esc(u.phone) + "</span></div></div></td>" +
        "<td>" + planPill(u.plan) + "</td>" +
        "<td>" + userPill(u.status) + "</td>" +
        '<td class="num" style="' + expCls + '">' + esc(expTxt) + "</td>" +
        '<td class="num">' + money(u.spend) + "</td>" +
        '<td class="num muted">' + (u.posts || 0) + "</td>" +
        '<td><div class="tbl__acts">' +
        '<button class="row-btn" type="button" data-act="user:renew" data-id="' + esc(u.id) + '">+30 天</button>' +
        '<button class="row-btn" type="button" data-act="user:open" data-id="' + esc(u.id) + '">编辑</button>' +
        '<button class="row-btn ' + (u.status === "frozen" ? "" : "row-btn--red") + '" type="button" data-act="user:freeze" data-id="' + esc(u.id) + '">' +
        (u.status === "frozen" ? "解冻" : "冻结") + "</button>" +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="7"><div class="aempty"><strong>' + (db.users.length ? "没有匹配的用户" : "还没有人注册") + "</strong>" +
      (db.users.length ? "换个关键词，或者新增一个。" : "前台有人用手机号注册后，会自动出现在这里。") + "</div></td></tr>";

    $("#uCount").textContent = rows.length;
  };

  function openUser(id) {
    var u = id ? DB.userOf(id) : null;
    var isNew = !u;
    if (!u) {
      u = { id: "", name: "", phone: "", plan: "free", status: "active", joined: DB.addDays("", 0), expire: "", spend: 0, posts: 0, tone: 1, note: "" };
    }
    openDrawer({
      kicker: isNew ? "新增用户" : "用户 " + u.id,
      title: isNew ? "新增用户" : u.name,
      sub: isNew ? "手动建号，适合线下转化的客户。" : u.phone + " · 注册于 " + u.joined,
      body: '<form id="drawerForm" class="dgrid">' +
        field("昵称", '<input class="input" name="name" value="' + esc(u.name) + '" required maxlength="16" placeholder="怎么称呼">', "full") +
        field("手机号", '<input class="input" name="phone" value="' + esc(u.phone) + '" maxlength="11" inputmode="numeric" placeholder="11 位手机号"' + (isNew ? "" : " readonly") + ">", "", isNew ? "对方用这个手机号收验证码登录" : "手机号是登录凭证，不能在后台修改") +
        field("订阅方案", '<select name="plan">' + opts([{ v: "free", t: "体验版" }, { v: "pro", t: "经营者" }, { v: "studio", t: "老板娘" }], u.plan) + "</select>") +
        field("账号状态", '<select name="status">' + opts([{ v: "active", t: "正常" }, { v: "expired", t: "已过期" }, { v: "frozen", t: "已冻结" }], u.status) + "</select>") +
        field("到期日", '<input class="input" type="date" name="expire" value="' + esc(u.expire) + '">') +
        field("累计消费", '<input class="input" type="number" name="spend" min="0" step="1" value="' + esc(u.spend) + '">') +
        field("发帖数", '<input class="input" value="' + (u.posts || 0) + '" readonly>', "", "按真实帖子统计") +
        field("备注", '<textarea name="note" placeholder="内部备注，只有后台可见">' + esc(u.note) + "</textarea>", "full") +
        '<p class="dhint full">到期日留空表示不限；冻结后对方立即被登出，且无法再次登录。</p>' +
        "</form>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="user:delete" data-id="' + esc(u.id) + '">删除</button>' +
        '<a class="row-btn" href="profile.html?u=' + encodeURIComponent(u.phone) + '" target="_blank" rel="noopener">查看主页</a>') +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm">保存</button>',
      save: function (d) {
        var target = isNew ? null : DB.userOf(u.id);
        if (!target) {
          if (!/^1[3-9]\d{9}$/.test(d.phone.trim())) { toast("请输入有效的 11 位手机号"); return; }
          var nu = {
            id: DB.nextId("NEW", db.users),
            name: d.name.trim(), phone: d.phone.trim(), plan: d.plan, status: d.status,
            joined: DB.addDays("", 0), expire: d.expire || "",
            spend: Number(d.spend) || 0, posts: 0,
            tone: (db.users.length % 3) + 1, note: d.note
          };
          db.users.unshift(nu);
          toast("已新增用户 " + nu.name);
        } else {
          target.name = d.name.trim();
          target.plan = d.plan;
          target.status = d.status;
          target.expire = d.expire || "";
          target.spend = Number(d.spend) || 0;
          target.note = d.note;
          toast("已保存 " + target.name);
        }
        DB.save();
        closeDrawer();
        render();
      }
    });
  }

  function field(label, control, cls, hint) {
    return '<div class="dfield ' + (cls || "") + '"><label>' + label + "</label>" + control +
      (hint ? '<span class="dhint">' + hint + "</span>" : "") + "</div>";
  }

  function confirmDelete(kind, id, name, sub) {
    state.del = { kind: kind, id: id };
    openModal({
      kicker: "危险操作",
      title: "删除「" + name + "」？",
      sub: sub || "删除后无法恢复，操作会记录在操作日志里。",
      body: '<p class="dhint">真实环境建议先隐藏或冻结，保留经营记录。</p>',
      foot: '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="delete:confirm">确认删除</button>'
    });
  }

  /* ======================================================================
     BILLING
     ====================================================================== */
  VIEWS.billing = {
    html: function () {
      var planCards = db.plans.map(function (p) {
        var n = db.users.filter(function (u) { return u.plan === p.id; }).length;
        return '<div class="plan ' + (p.id === "pro" ? "plan--pro" : "") + '">' +
          '<div class="plan__head"><div><div class="plan__name">' + esc(p.name) + '</div>' +
          '<div class="plan__id">' + esc(p.id) + " / " + (p.active ? "在售" : "已下架") + "</div></div>" +
          '<button class="row-btn" type="button" data-act="plan:edit" data-id="' + esc(p.id) + '">编辑</button></div>' +
          '<div class="plan__price">' + (p.price ? money(p.price) : "免费") + " <small>" + (p.price ? "/ " + esc(p.unit) : "") + "</small></div>" +
          '<ul class="plan__feats">' + p.features.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" +
          '<div class="plan__foot"><span class="plan__count">' + n + " 位用户</span>" +
          '<span style="margin-left:auto" class="mono">' + (p.active ? "ON" : "OFF") + "</span></div></div>";
      }).join("");

      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>03</b><span>订阅与收款</span></div>' +
        "<h1>方案与订单</h1><p class=\"ahead__sub\">改价格、改权益、手动开通、标记退款。前台登录后的订阅状态以这里为准。</p></div>" +
        '<div class="ahead__actions"><button class="btn btn--sm btn--red" type="button" data-act="order:grant">手动开通 / 续费</button></div></div>' +

        '<div class="plans">' + planCards + "</div>" +

        '<div class="panel"><div class="panel__head"><div class="panel__title">订单流水 <span class="mono">ORDERS</span></div>' +
        '<span class="mono" style="color:var(--ink-40)">近 30 日</span></div>' +
        '<div class="filters">' +
        chipGroup("billing", "status", [["all", "全部"], ["paid", "已支付"], ["pending", "待支付"], ["refund", "已退款"]]) +
        '<span class="filters__count">共 <b id="oCount">0</b> 单</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>订单号</th><th>用户</th><th>方案</th><th>金额</th><th>渠道</th><th>状态</th><th>日期</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="oBody"></tbody></table></div></div>';
    }
  };

  PAINT.billing = function () {
    var f = state.f.billing;
    var rows = db.orders.filter(function (o) {
      return f.status === "all" || o.status === f.status;
    }).slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });

    var methodMap = { alipay: "支付宝", wechat: "微信支付", bank: "对公转账" };

    $("#oBody").innerHTML = rows.length ? rows.map(function (o) {
      return '<tr class="is-static">' +
        '<td class="num">' + esc(o.id) + "</td>" +
        '<td class="strong">' + esc(o.userName) + "</td>" +
        "<td>" + planPill(o.plan) + "</td>" +
        '<td class="num">' + money(o.amount) + "</td>" +
        '<td class="muted">' + esc(methodMap[o.method] || o.method) + "</td>" +
        "<td>" + orderPill(o.status) + "</td>" +
        '<td class="num muted">' + esc(o.createdAt) + "</td>" +
        '<td><div class="tbl__acts">' +
        (o.status === "pending"
          ? '<button class="row-btn" type="button" data-act="order:paid" data-id="' + esc(o.id) + '">标记已付</button>'
          : o.status === "refund"
            ? '<button class="row-btn" type="button" data-act="order:paid" data-id="' + esc(o.id) + '">重新入账</button>'
            : "") +
        (o.status !== "refund"
          ? '<button class="row-btn row-btn--red" type="button" data-act="order:refund" data-id="' + esc(o.id) + '">退款</button>'
          : "") +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="8"><div class="aempty"><strong>没有订单</strong>换个状态筛选看看。</div></td></tr>';

    $("#oCount").textContent = rows.length;
  };

  function openPlan(id) {
    var p = DB.planOf(id);
    openDrawer({
      kicker: "方案 " + p.id,
      title: "编辑「" + p.name + "」",
      sub: "价格与权益会同步到前台定价区。",
      body: '<form id="drawerForm" class="dgrid">' +
        field("方案名称", '<input class="input" name="name" value="' + esc(p.name) + '" required>', "full") +
        field("价格（元）", '<input class="input" type="number" name="price" min="0" step="1" value="' + esc(p.price) + '">') +
        field("计价单位", '<input class="input" name="unit" value="' + esc(p.unit) + '">') +
        field("一句话描述", '<input class="input" name="desc" value="' + esc(p.desc) + '">', "full") +
        field("权益（每行一条）", '<textarea name="features" style="min-height:130px">' + esc(p.features.join("\n")) + "</textarea>", "full") +
        field("是否在售", '<select name="active">' + opts([{ v: "1", t: "在售" }, { v: "0", t: "下架" }], p.active ? "1" : "0") + "</select>") +
        "</form>",
      foot: '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm">保存方案</button>',
      save: function (d) {
        p.name = d.name.trim();
        p.price = Number(d.price) || 0;
        p.unit = d.unit.trim() || "月";
        p.desc = d.desc;
        p.features = d.features.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        p.active = d.active === "1";
        DB.save();
        closeDrawer();
        render();
        toast("方案已更新");
      }
    });
  }

  function openGrant() {
    if (!db.users.length) { toast("还没有注册用户，可以先在「用户」里新增"); return; }
    var userOpts = db.users.map(function (u) {
      return { v: u.id, t: u.name + " · " + u.phone + "（" + DB.planOf(u.plan).name + "）" };
    });
    openModal({
      kicker: "手动开通",
      title: "开通 / 续费",
      sub: "线下收款、赠送或补单，都在这里生成一条已支付订单。",
      body: field("选择用户", '<select name="userId">' + opts(userOpts, userOpts[0].v) + "</select>", "full") +
        field("订阅方案", '<select name="plan">' + opts(db.plans.map(function (p) { return { v: p.id, t: p.name + " · ¥" + esc(p.price) + "/" + p.unit }; }), "pro") + "</select>") +
        field("时长（月）", '<input class="input" type="number" name="months" value="1" min="1" max="36">') +
        field("支付方式", '<select name="method">' + opts([{ v: "alipay", t: "支付宝" }, { v: "wechat", t: "微信支付" }, { v: "bank", t: "对公转账" }, { v: "manual", t: "线下/赠送" }], "alipay") + "</select>") +
        field("实收金额", '<input class="input" type="number" name="amount" value="399" min="0" step="1">') +
        "<p class=\"dhint full\">到期日会在用户现有到期日基础上顺延；方案会自动切换。</p>",
      foot: '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="modalForm">确认开通</button>',
      save: function (d) {
        var u = DB.userOf(d.userId);
        if (!u) return;
        var plan = DB.planOf(d.plan);
        var months = Math.max(1, Number(d.months) || 1);
        var base = u.expire && DB.daysLeft(u.expire) > 0 ? u.expire : DB.addDays("", 0);
        u.expire = DB.addDays(base, months * 30);
        u.plan = plan.id;
        u.status = "active";
        u.spend = (u.spend || 0) + (Number(d.amount) || 0);
        var order = {
          id: DB.orderId(),
          userId: u.id,
          userName: u.name,
          plan: plan.id,
          amount: Number(d.amount) || 0,
          method: d.method,
          status: "paid",
          createdAt: DB.addDays("", 0)
        };
        db.orders.unshift(order);
        DB.save();
        closeModal();
        render();
        toast("已开通 · " + u.name + " 至 " + u.expire);
      }
    });

    var mf = document.getElementById("modalForm");
    if (mf) {
      var planSel = mf.querySelector('[name="plan"]');
      var monthInput = mf.querySelector('[name="months"]');
      var amountInput = mf.querySelector('[name="amount"]');
      var sync = function () {
        var p = DB.planOf(planSel.value);
        amountInput.value = Math.round((p.price || 0) * Math.max(1, Number(monthInput.value) || 1));
      };
      planSel.addEventListener("change", sync);
      monthInput.addEventListener("input", sync);
    }
  }

  /* ---------------- shared console helpers ---------------- */
  state.sel = { merchants: {}, products: {} };

  function selMap(kind) { return state.sel[kind]; }
  function selCount(kind) { return Object.keys(selMap(kind)).length; }
  function isSel(kind, id) { return !!selMap(kind)[id]; }
  function clearSel(kind) { state.sel[kind] = {}; }

  function statline(items) {
    return '<div class="statline">' + items.map(function (it) {
      return '<div class="statline__item"><span>' + esc(it[0]) + "</span><b>" + esc(it[1]) + "</b>" +
        (it[2] ? "<em>" + esc(it[2]) + "</em>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function dtabs(items) {
    return '<div class="dtabs">' + items.map(function (t, i) {
      return '<button type="button" class="dtab' + (i ? "" : " is-on") + '" data-dtab="' + t.v + '">' + t.t + "</button>";
    }).join("") + "</div>";
  }

  function pane(v, html, on) {
    return '<div class="dtab-pane' + (on ? " is-on" : "") + '" data-pane="' + v + '">' + html + "</div>";
  }

  function dictOpts(list, cur) {
    var arr = (list || []).slice();
    if (cur && !arr.some(function (x) { return x.v === cur; })) arr.push({ v: cur, t: cur + "（已停用）" });
    return opts(arr, cur);
  }

  function dictLabel(list, v) {
    var hit = (list || []).filter(function (x) { return x.v === v; })[0];
    return hit ? hit.t : v;
  }

  function levelTag(l) {
    if (l === "diamond") return '<span class="lvl lvl--diamond">钻石</span>';
    if (l === "gold") return '<span class="lvl lvl--gold">金牌</span>';
    return '<span class="lvl">普通</span>';
  }

  function syncBatch(kind) {
    var bar = document.getElementById(kind === "merchants" ? "mBatch" : "pBatch");
    if (!bar) return;
    var n = selCount(kind);
    var cnt = bar.querySelector("[data-sel-count]");
    if (cnt) cnt.textContent = n;
    bar.hidden = n === 0;
    var all = document.querySelector('[data-sel-all="' + kind + '"]');
    if (!all) return;
    var boxes = document.querySelectorAll("#" + (kind === "merchants" ? "mBody" : "pBody") + " [data-sel]");
    var checked = 0;
    Array.prototype.forEach.call(boxes, function (b) { if (b.checked) checked++; });
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }

  /* ======================================================================
     MERCHANTS
     ====================================================================== */
  VIEWS.merchants = {
    html: function () {
      var ms = db.merchants;
      var pending = ms.filter(function (m) { return m.status === "pending"; }).length;
      var verified = ms.filter(function (m) { return m.verified && m.status === "approved"; }).length;
      var leads = ms.reduce(function (s, m) { return s + (m.leads || 0); }, 0);
      var zoneChips = [["all", "全部区域"]].concat(db.dicts.zones.map(function (z) { return [z.v, z.t]; }));

      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>04</b><span>商家档口</span></div>' +
        "<h1>商家档口</h1><p class=\"ahead__sub\">审核、认证、等级、推荐位与排序权重，都在这里配置。通过后才会出现在前台商家名录。</p></div>" +
        '<div class="ahead__actions">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-act="dict:open">区域与品类字典</button>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="m:new">新增商家</button></div></div>' +

        statline([
          ["商家总数", ms.length, ""],
          ["待审核", pending, pending ? "需要处理" : "已清空"],
          ["已认证", verified, "执照 + 实拍"],
          ["累计联系申请", leads, "近 30 日"]
        ]) +

        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索商家、铺位、负责人" data-f="q" value="' + esc(state.f.merchants.q) + '"></label>' +
        chipGroup("merchants", "zone", zoneChips) +
        chipGroup("merchants", "status", [["all", "全部状态"], ["approved", "已通过"], ["pending", "待审核"], ["rejected", "已拒绝"]]) +
        '<span class="filters__count">共 <b id="mCount">0</b> 家</span></div>' +
        '<div class="batchbar" id="mBatch" hidden>' +
        '<span>已选 <b data-sel-count="merchants">0</b> 家</span>' +
        '<button class="bb-btn" type="button" data-act="m:bulk-approve">批量通过</button>' +
        '<button class="bb-btn bb-btn--red" type="button" data-act="m:bulk-reject">批量拒绝</button>' +
        '<button class="bb-btn" type="button" data-act="m:bulk-feature">批量推荐</button>' +
        '<span class="spacer"></span>' +
        '<button class="bb-btn" type="button" data-act="m:bulk-clear">取消选择</button>' +
        "</div>" +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th class="cbx-h"><input class="cbx" type="checkbox" data-sel-all="merchants" aria-label="全选"></th>' +
        "<th>铺位</th><th>商家</th><th>区域</th><th>主营</th><th>认证</th><th>状态</th><th>联系</th>" +
        '<th style="text-align:right">操作</th>' +
        '</tr></thead><tbody id="mBody"></tbody></table></div></div>';
    }
  };

  PAINT.merchants = function () {
    var f = state.f.merchants;
    var rows = db.merchants.filter(function (m) {
      if (f.zone !== "all" && m.zone !== f.zone) return false;
      if (f.status !== "all" && m.status !== f.status) return false;
      if (f.q && (m.name + m.stall + m.owner).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });

    $("#mBody").innerHTML = rows.length ? rows.map(function (m) {
      var expLeft = DB.daysLeft(m.certExpire);
      var certCls = m.verified && expLeft !== null && expLeft <= 30 ? "color:var(--red);font-weight:600" : "";
      return '<tr data-act="m:open" data-id="' + esc(m.id) + '">' +
        '<td class="cbx-c"><input class="cbx" type="checkbox" data-sel="merchants" value="' + esc(m.id) + '"' +
        (isSel("merchants", m.id) ? " checked" : "") + ' aria-label="选择 ' + esc(m.name) + '"></td>' +
        '<td class="num strong">' + esc(m.stall) +
        '<div class="muted" style="font-size:9px;letter-spacing:.08em">' + esc(m.id) + "</div></td>" +
        '<td class="strong">' + esc(m.name) + " " + (m.live ? '<span class="pill pill--red" title="前台用户提交的认证申请">认证申请</span>' : levelTag(m.level)) +
        '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(m.owner) + "</div></td>" +
        '<td class="muted">' + esc(m.zoneName) + "</td>" +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' +
        (m.tags || []).slice(0, 3).map(function (t) {
          return '<span class="tag" style="height:19px;font-size:9px">' + esc(t) + "</span>";
        }).join("") + "</div></td>" +
        "<td>" + (m.verified
          ? '<span class="pill pill--teal">已认证</span><div class="muted" style="font-size:9px;margin-top:3px;' + certCls + '">' +
            (m.certExpire ? "至 " + esc(m.certExpire) : "") + "</div>"
          : '<span class="pill pill--mute">未认证</span>') + "</td>" +
        "<td>" + merchantPill(m.status) + "</td>" +
        '<td class="num muted">' + (m.leads || 0) + "</td>" +
        '<td><div class="tbl__acts">' +
        (m.status === "pending"
          ? '<button class="row-btn" type="button" data-act="m:approve" data-id="' + esc(m.id) + '">通过</button>' +
            '<button class="row-btn row-btn--red" type="button" data-act="m:reject" data-id="' + esc(m.id) + '">拒绝</button>'
          : '<button class="row-btn" type="button" data-act="m:feature" data-id="' + esc(m.id) + '">' +
            (m.featured ? "取消推荐" : "推荐") + "</button>") +
        '<button class="row-btn" type="button" data-act="m:open" data-id="' + esc(m.id) + '">编辑</button>' +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="9"><div class="aempty"><strong>没有匹配的商家</strong>换个区域或状态看看。</div></td></tr>';

    $("#mCount").textContent = rows.length;
    syncBatch("merchants");
  };

  function openMerchant(id) {
    var m = id ? db.merchants.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !m;
    if (!m) {
      m = {
        id: "", name: "", stall: "", zone: (db.dicts.zones[0] || {}).v || "tradecity", zoneName: "",
        owner: "", phone: "", wechat: "", tags: [], intro: "", level: "normal",
        minOrder: "1 件", leadTime: "当天", hours: "08:30 - 17:30",
        license: "", certExpire: "", verified: false, status: "pending", rejectReason: "",
        featured: false, weight: 60, views: 0, leads: 0,
        joined: DB.addDays("", 0), updated: DB.addDays("", 0)
      };
    }

    var basic = '<div class="dgrid">' +
      field("商家名称", '<input class="input" name="name" value="' + esc(m.name) + '" required>') +
      field("铺位号", '<input class="input" name="stall" value="' + esc(m.stall) + '" placeholder="如 Ⅱ-17-088">') +
      field("所属区域", '<select name="zone">' + dictOpts(db.dicts.zones, m.zone) + "</select>") +
      field("区域说明", '<input class="input" name="zoneName" value="' + esc(m.zoneName) + '">') +
      field("负责人", '<input class="input" name="owner" value="' + esc(m.owner) + '">') +
      field("手机号", '<input class="input" name="phone" value="' + esc(m.phone) + '">') +
      field("微信号", '<input class="input" name="wechat" value="' + esc(m.wechat) + '">') +
      field("商家等级", '<select name="level">' + opts([{ v: "normal", t: "普通" }, { v: "gold", t: "金牌" }, { v: "diamond", t: "钻石" }], m.level) + "</select>") +
      field("商家简介", '<textarea name="intro" placeholder="两句话说清楚他做什么">' + esc(m.intro) + "</textarea>", "full") +
      "</div>";

    var biz = '<div class="dgrid">' +
      field("主营标签", '<input class="input" name="tags" value="' + esc((m.tags || []).join("、")) + '" placeholder="用、分隔">', "full") +
      field("起订量", '<input class="input" name="minOrder" value="' + esc(m.minOrder) + '">') +
      field("发货 / 交付时效", '<input class="input" name="leadTime" value="' + esc(m.leadTime) + '">') +
      field("营业时间", '<input class="input" name="hours" value="' + esc(m.hours) + '">') +
      field("排序权重", '<input class="input" type="number" name="weight" min="0" max="999" value="' + esc(m.weight) + '">') +
      field("首页推荐位", '<select name="featured">' + opts([{ v: "1", t: "推荐到首页" }, { v: "0", t: "不推荐" }], m.featured ? "1" : "0") + "</select>") +
      field("前台展示", '<select name="status">' + opts([{ v: "approved", t: "已通过（前台可见）" }, { v: "pending", t: "待审核（不可见）" }, { v: "rejected", t: "已拒绝" }], m.status) + "</select>") +
      "</div>";

    var cert = '<div class="dgrid">' +
      field("实名认证", '<select name="verified">' + opts([{ v: "1", t: "已认证" }, { v: "0", t: "未认证" }], m.verified ? "1" : "0") + "</select>") +
      field("认证到期", '<input class="input" type="date" name="certExpire" value="' + esc(m.certExpire) + '">') +
      field("营业执照号", '<input class="input" name="license" value="' + esc(m.license) + '" placeholder="统一社会信用代码">', "full") +
      field("拒绝原因", '<textarea name="rejectReason" placeholder="仅拒绝时填写，会保留在审核记录里">' + esc(m.rejectReason) + "</textarea>", "full") +
      '<p class="dhint full">认证到期前 30 天，列表会用红色标出，方便提前联系续证。</p>' +
      "</div>";

    var data = '<div class="dstats">' +
      '<div><span>主页曝光</span><b>' + (m.views || 0) + "</b></div>" +
      '<div><span>联系申请</span><b>' + (m.leads || 0) + "</b></div>" +
      '<div><span>加入时间</span><b>' + esc(m.joined || "—") + "</b></div>" +
      '<div><span>最近更新</span><b>' + esc(m.updated || "—") + "</b></div>" +
      "</div>" +
      '<p class="dhint">曝光与联系申请为演示指标，接入统计接口后会自动更新。</p>' +
      '<p class="dhint">排序权重越大越靠前；同权重时按最近更新排序。</p>';

    openDrawer({
      wide: true,
      kicker: isNew ? "新增商家" : "商家 " + m.id,
      title: isNew ? "新增商家" : m.name,
      sub: isNew ? "录入后默认进入待审核。" : m.stall + " · " + m.zoneName,
      body: '<form id="drawerForm">' +
        dtabs([{ v: "basic", t: "基本资料" }, { v: "biz", t: "经营与展示" }, { v: "cert", t: "认证与审核" }, { v: "data", t: "数据" }]) +
        pane("basic", basic, true) + pane("biz", biz) + pane("cert", cert) + pane("data", data) +
        "</form>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="m:delete" data-id="' + esc(m.id) + '">删除</button>') +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm">保存</button>',
      save: function (d) {
        var tags = d.tags.split(/[、,，]+/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (d.status === "rejected" && !d.rejectReason.trim()) {
          toast("拒绝时请填写原因");
          return;
        }
        var patch = {
          name: d.name.trim(), stall: d.stall.trim(), zone: d.zone, zoneName: d.zoneName.trim(),
          owner: d.owner.trim(), phone: d.phone.trim(), wechat: d.wechat.trim(), tags: tags,
          intro: d.intro.trim(), level: d.level, minOrder: d.minOrder.trim(),
          leadTime: d.leadTime.trim(), hours: d.hours.trim(), weight: Number(d.weight) || 0,
          verified: d.verified === "1", status: d.status, rejectReason: d.rejectReason.trim(),
          featured: d.featured === "1", license: d.license.trim(), certExpire: d.certExpire,
          updated: DB.addDays("", 0)
        };
        if (isNew) {
          patch.id = DB.nextId("M", db.merchants);
          patch.views = 0;
          patch.leads = 0;
          patch.joined = DB.addDays("", 0);
          db.merchants.unshift(patch);
          toast("已新增商家");
        } else {
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) m[k] = patch[k];
          }
          toast("商家配置已保存");
        }
        DB.save();
        closeDrawer();
        render();
      }
    });
  }

  /* ======================================================================
     PRODUCTS
     ====================================================================== */
  VIEWS.products = {
    html: function () {
      var ps = db.products;
      var on = ps.filter(function (p) { return p.status === "on"; }).length;
      var featured = ps.filter(function (p) { return p.featured; }).length;
      var sales = ps.reduce(function (s, p) { return s + (p.sales || 0); }, 0);
      var revenue = ps.reduce(function (s, p) { return s + (p.revenue || 0); }, 0);
      var catChips = [["all", "全部品类"]].concat(db.dicts.cats.map(function (c) { return [c.v, c.t]; }));

      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>05</b><span>AI 工具</span></div>' +
        "<h1>AI 工具</h1><p class=\"ahead__sub\">定价、抽成、交付方式、角标与推荐位，一件工具的全部配置都在这里。</p></div>" +
        '<div class="ahead__actions">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-act="dict:open">区域与品类字典</button>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="p:new">新增工具</button></div></div>' +

        statline([
          ["在架工具", on, "共 " + ps.length + " 个"],
          ["首页推荐", featured, "推荐位"],
          ["累计销量", Number(sales).toLocaleString("zh-CN"), "按件 / 条 / 单"],
          ["估算收入", money(revenue), "近 12 个月"]
        ]) +

        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索工具或供应商" data-f="q" value="' + esc(state.f.products.q) + '"></label>' +
        chipGroup("products", "cat", catChips) +
        chipGroup("products", "status", [["all", "全部状态"], ["on", "已上架"], ["off", "已下架"]]) +
        '<span class="filters__count">共 <b id="pCount">0</b> 个</span></div>' +
        '<div class="batchbar" id="pBatch" hidden>' +
        '<span>已选 <b data-sel-count="products">0</b> 个</span>' +
        '<button class="bb-btn" type="button" data-act="p:bulk-on">批量上架</button>' +
        '<button class="bb-btn" type="button" data-act="p:bulk-off">批量下架</button>' +
        '<button class="bb-btn" type="button" data-act="p:bulk-feature">批量推荐</button>' +
        '<span class="spacer"></span>' +
        '<button class="bb-btn" type="button" data-act="p:bulk-clear">取消选择</button>' +
        "</div>" +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th class="cbx-h"><input class="cbx" type="checkbox" data-sel-all="products" aria-label="全选"></th>' +
        "<th>编号</th><th>名称</th><th>品类</th><th>平台</th><th>价格</th><th>销量</th><th>状态</th>" +
        '<th style="text-align:right">操作</th>' +
        '</tr></thead><tbody id="pBody"></tbody></table></div></div>';
    }
  };

  PAINT.products = function () {
    var f = state.f.products;
    var rows = db.products.filter(function (p) {
      if (f.cat !== "all" && p.cat !== f.cat) return false;
      if (f.status !== "all" && p.status !== f.status) return false;
      if (f.q && (p.name + p.vendor).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });

    $("#pBody").innerHTML = rows.length ? rows.map(function (p) {
      return '<tr data-act="p:open" data-id="' + esc(p.id) + '">' +
        '<td class="cbx-c"><input class="cbx" type="checkbox" data-sel="products" value="' + esc(p.id) + '"' +
        (isSel("products", p.id) ? " checked" : "") + ' aria-label="选择 ' + esc(p.name) + '"></td>' +
        '<td class="num muted">' + esc(p.id) + "</td>" +
        '<td class="strong">' + esc(p.name) +
        (p.badge ? ' <span class="pill pill--red" style="height:17px;font-size:8px">' + esc(p.badge) + "</span>" : "") +
        (p.featured ? ' <span class="pill pill--ink" style="height:17px;font-size:8px">推荐</span>' : "") + "</td>" +
        '<td class="muted">' + esc(dictLabel(db.dicts.cats, p.cat)) + "</td>" +
        '<td class="muted">' + esc(p.platform) + "</td>" +
        '<td class="num">' + (p.price ? money(p.price) + '<span class="muted">/' + esc(p.unit) + "</span>" : '<span class="muted">免费</span>') + "</td>" +
        '<td class="num muted">' + Number(p.sales || 0).toLocaleString("zh-CN") + "</td>" +
        "<td>" + (p.status === "on" ? '<span class="pill pill--ok">已上架</span>' : '<span class="pill pill--mute">已下架</span>') + "</td>" +
        '<td><div class="tbl__acts">' +
        '<button class="row-btn" type="button" data-act="p:toggle" data-id="' + esc(p.id) + '">' + (p.status === "on" ? "下架" : "上架") + "</button>" +
        '<button class="row-btn" type="button" data-act="p:feature" data-id="' + esc(p.id) + '">' + (p.featured ? "取消推荐" : "推荐") + "</button>" +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="9"><div class="aempty"><strong>没有匹配的工具</strong>换个品类或状态看看。</div></td></tr>';

    $("#pCount").textContent = rows.length;
    syncBatch("products");
  };

  var BILLING_NAME = { monthly: "按月订阅", yearly: "按年订阅", "per-unit": "按次计费", free: "免费 / 内测" };

  function openProduct(id) {
    var p = id ? db.products.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !p;
    if (!p) {
      p = {
        id: "", name: "", cat: (db.dicts.cats[0] || {}).v || "tool", platform: "全平台",
        price: 0, unit: "月", billing: "monthly", trial: 0, commission: 10,
        delivery: "网页端", langs: "中文 / 英文", vendor: "", desc: "", badge: "",
        status: "on", featured: false, sales: 0, revenue: 0, weight: 60,
        updated: DB.addDays("", 0)
      };
    }

    var vendorList = '<datalist id="vendorList">' +
      db.merchants.map(function (m) { return '<option value="' + esc(m.name) + '"></option>'; }).join("") +
      "</datalist>";

    var basic = '<div class="dgrid">' +
      field("工具名称", '<input class="input" name="name" value="' + esc(p.name) + '" required>') +
      field("品号", '<input class="input" name="pid" value="' + esc(p.id) + '" placeholder="留空自动生成">') +
      field("品类", '<select name="cat">' + dictOpts(db.dicts.cats, p.cat) + "</select>") +
      field("适配平台", '<select name="platform">' + opts([{ v: "全平台", t: "全平台" }, { v: "TikTok Shop", t: "TikTok Shop" }, { v: "亚马逊", t: "亚马逊" }, { v: "独立站", t: "独立站" }, { v: "1688", t: "1688" }], p.platform) + "</select>") +
      field("供应商", '<input class="input" name="vendor" value="' + esc(p.vendor) + '" list="vendorList" placeholder="可从商家名录里选">' + vendorList) +
      field("工具简介", '<textarea name="desc" placeholder="一句话说明它替用户做什么">' + esc(p.desc) + "</textarea>", "full") +
      "</div>";

    var pricing = '<div class="dgrid">' +
      field("价格（元）", '<input class="input" type="number" name="price" min="0" step="0.1" value="' + esc(p.price) + '">') +
      field("计价单位", '<input class="input" name="unit" value="' + esc(p.unit) + '" placeholder="如 月 / 条 / 张">') +
      field("计费方式", '<select name="billing">' + opts([
        { v: "monthly", t: "按月订阅" }, { v: "yearly", t: "按年订阅" },
        { v: "per-unit", t: "按次计费" }, { v: "free", t: "免费 / 内测" }
      ], p.billing) + "</select>") +
      field("试用天数", '<input class="input" type="number" name="trial" min="0" max="90" value="' + esc(p.trial) + '">') +
      field("平台抽成（%）", '<input class="input" type="number" name="commission" min="0" max="100" step="1" value="' + esc(p.commission) + '">') +
      field("对客展示价", '<input class="input" value="' + (p.price ? "¥" + esc(p.price) + " / " + esc(p.unit) : "免费") + '" disabled>') +
      '<p class="dhint full">抽成用于结算记录；展示价由价格与单位自动拼出，不用单独维护。</p>' +
      "</div>";

    var delivery = '<div class="dgrid">' +
      field("交付形式", '<select name="delivery">' + opts([
        { v: "网页端", t: "网页端" }, { v: "API / 网页", t: "API / 网页" },
        { v: "浏览器插件", t: "浏览器插件" }, { v: "App + 后台", t: "App + 后台" },
        { v: "小程序", t: "小程序" }, { v: "报告 PDF", t: "报告 PDF" }, { v: "实物货盘", t: "实物货盘" }
      ], p.delivery) + "</select>") +
      field("支持语言", '<input class="input" name="langs" value="' + esc(p.langs) + '">') +
      field("首页角标", '<select name="badge">' + opts([
        { v: "", t: "无" }, { v: "热门", t: "热门" }, { v: "新上", t: "新上" },
        { v: "内测", t: "内测" }, { v: "限量", t: "限量" }
      ], p.badge) + "</select>") +
      field("排序权重", '<input class="input" type="number" name="weight" min="0" max="999" value="' + esc(p.weight) + '">') +
      field("上架状态", '<select name="status">' + opts([{ v: "on", t: "已上架" }, { v: "off", t: "已下架" }], p.status) + "</select>") +
      field("首页推荐", '<select name="featured">' + opts([{ v: "1", t: "推荐" }, { v: "0", t: "不推荐" }], p.featured ? "1" : "0") + "</select>") +
      "</div>";

    var data = '<div class="dstats">' +
      '<div><span>累计销量</span><b>' + Number(p.sales || 0).toLocaleString("zh-CN") + "</b></div>" +
      '<div><span>估算收入</span><b>' + money(p.revenue || 0) + "</b></div>" +
      '<div><span>计费方式</span><b>' + (BILLING_NAME[p.billing] || p.billing) + "</b></div>" +
      '<div><span>最近更新</span><b>' + esc(p.updated || "—") + "</b></div>" +
      "</div>" +
      '<div class="dgrid" style="margin-top:12px">' +
      field("手工修正销量", '<input class="input" type="number" name="sales" min="0" step="1" value="' + esc(p.sales) + '">') +
      field("收入（元）", '<input class="input" type="number" name="revenue" min="0" step="1" value="' + esc(p.revenue) + '">') +
      '<p class="dhint full">销量与收入用于后台报表；真实环境应由订单流水汇总。</p>' +
      "</div>";

    openDrawer({
      wide: true,
      kicker: isNew ? "新增工具" : "工具 " + p.id,
      title: isNew ? "新增 AI 工具" : p.name,
      sub: isNew ? "上架后会出现在前台的 AI 工具列表里。" : (BILLING_NAME[p.billing] || p.billing) + " · 销量 " + Number(p.sales || 0).toLocaleString("zh-CN"),
      body: '<form id="drawerForm">' +
        dtabs([{ v: "basic", t: "基本资料" }, { v: "pricing", t: "定价与计费" }, { v: "delivery", t: "交付与展示" }, { v: "data", t: "数据" }]) +
        pane("basic", basic, true) + pane("pricing", pricing) + pane("delivery", delivery) + pane("data", data) +
        "</form>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="p:delete" data-id="' + esc(p.id) + '">删除</button>') +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm">保存</button>',
      save: function (d) {
        var patch = {
          name: d.name.trim(), cat: d.cat, platform: d.platform,
          price: Number(d.price) || 0, unit: d.unit.trim() || "月",
          billing: d.billing, trial: Number(d.trial) || 0,
          commission: Number(d.commission) || 0,
          delivery: d.delivery, langs: d.langs.trim(), vendor: d.vendor.trim(),
          desc: d.desc.trim(), badge: d.badge, status: d.status,
          featured: d.featured === "1", weight: Number(d.weight) || 0,
          sales: Number(d.sales) || 0, revenue: Number(d.revenue) || 0,
          updated: DB.addDays("", 0)
        };
        if (isNew) {
          patch.id = d.pid.trim() || DB.nextId("AI", db.products);
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(patch.id) || ["__proto__", "constructor", "prototype"].includes(patch.id)) {
            toast("品号仅支持 1–64 位字母、数字、下划线或减号"); return;
          }
          if (db.products.some(function (item) { return item.id === patch.id; })) { toast("品号已存在"); return; }
          db.products.unshift(patch);
          toast("已上架新工具");
        } else {
          for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
          }
          toast("工具配置已保存");
        }
        DB.save();
        closeDrawer();
        render();
      }
    });
  }

  /* ---------------- dictionaries ---------------- */
  function dictColumn(kind, title, list) {
    return '<div class="dict-col"><div class="dict-col__head">' + title + " · " + list.length + "</div>" +
      '<div class="dict-list" data-dict="' + kind + '">' +
      list.map(function (x) {
        return '<div class="dict-row" data-dict-item data-v="' + esc(x.v) + '">' +
          '<input class="input" value="' + esc(x.t) + '">' +
          '<span class="mono">' + esc(x.v) + "</span>" +
          '<button type="button" data-dict-del aria-label="删除">✕</button></div>';
      }).join("") + "</div>" +
      '<button class="row-btn" type="button" data-dict-add="' + kind + '">＋ 新增一项</button></div>';
  }

  function openDicts() {
    openModal({
      lg: true,
      kicker: "区域与品类字典",
      title: "区域与品类配置",
      sub: "这两份字典决定筛选条和下拉选项。删掉某项后，已使用该值的记录会显示为「已停用」。",
      body: '<div class="dgrid">' +
        dictColumn("zones", "商家区域", db.dicts.zones) +
        dictColumn("cats", "工具品类", db.dicts.cats) +
        "</div>" +
        '<p class="dhint" style="grid-column:1/-1">新增项会自动生成内部键；名称可随时改，已用旧值的记录不受影响。</p>',
      foot: '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="dict:save">保存字典</button>'
    });
  }

  function saveDicts() {
    var next = { zones: [], cats: [] };
    ["zones", "cats"].forEach(function (kind) {
      var list = document.querySelector('[data-dict="' + kind + '"]');
      if (!list) return;
      Array.prototype.forEach.call(list.querySelectorAll("[data-dict-item]"), function (row) {
        var input = row.querySelector("input");
        var name = (input ? input.value : "").trim();
        if (!name) return;
        var v = row.getAttribute("data-v");
        if (!v) v = (kind === "zones" ? "z_" : "c_") + Math.random().toString(36).slice(2, 7);
        next[kind].push({ v: v, t: name });
      });
    });
    if (!next.zones.length || !next.cats.length) {
      toast("区域和品类至少各保留一项");
      return;
    }
    db.dicts = next;
    DB.save();
    closeModal();
    render();
    toast("字典已保存");
  }

  /* ======================================================================
     ARTICLES
     ====================================================================== */
  VIEWS.articles = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>06</b><span>资讯与政策</span></div>' +
        "<h1>资讯与政策</h1><p class=\"ahead__sub\">政策速递、行业观察、平台公告。置顶会出现在前台首页的情报区。</p></div>" +
        '<div class="ahead__actions"><button class="btn btn--sm btn--red" type="button" data-act="a:new">新建资讯</button></div></div>' +

        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索标题或来源" data-f="q" value="' + esc(state.f.articles.q) + '"></label>' +
        chipGroup("articles", "type", [["all", "全部类型"], ["政策", "政策"], ["资讯", "资讯"], ["公告", "公告"]]) +
        chipGroup("articles", "status", [["all", "全部状态"], ["published", "已发布"], ["draft", "草稿"]]) +
        '<span class="filters__count">共 <b id="aCount">0</b> 篇</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>标题</th><th>类型</th><th>来源</th><th>状态</th><th>置顶</th><th>日期</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="aBody"></tbody></table></div></div>';
    }
  };

  PAINT.articles = function () {
    var f = state.f.articles;
    var rows = db.articles.filter(function (a) {
      if (f.type !== "all" && a.type !== f.type) return false;
      if (f.status !== "all" && a.status !== f.status) return false;
      if (f.q && (a.title + a.source).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });

    $("#aBody").innerHTML = rows.length ? rows.map(function (a) {
      return '<tr data-act="a:open" data-id="' + esc(a.id) + '">' +
        '<td class="strong" style="white-space:normal;max-width:330px">' + esc(a.title) + "</td>" +
        '<td><span class="tag" style="height:19px;font-size:9px">' + esc(a.type) + "</span></td>" +
        '<td class="muted">' + esc(a.source) + "</td>" +
        "<td>" + articlePill(a.status) + "</td>" +
        "<td>" + (a.pinned ? '<span class="pill pill--red">置顶</span>' : '<span class="pill pill--mute">—</span>') + "</td>" +
        '<td class="num muted">' + esc(a.date) + "</td>" +
        '<td><div class="tbl__acts">' +
        '<button class="row-btn" type="button" data-act="a:toggle" data-id="' + esc(a.id) + '">' + (a.status === "published" ? "转草稿" : "发布") + "</button>" +
        '<button class="row-btn" type="button" data-act="a:pin" data-id="' + esc(a.id) + '">' + (a.pinned ? "取消置顶" : "置顶") + "</button>" +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="7"><div class="aempty"><strong>没有匹配的内容</strong>换个类型或状态看看。</div></td></tr>';

    $("#aCount").textContent = rows.length;
  };

  function openArticle(id) {
    var a = id ? db.articles.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !a;
    if (!a) {
      a = { id: "", title: "", type: "政策", source: "", status: "draft", pinned: false, date: DB.addDays("", 0), summary: "", body: "" };
    }
    openModal({
      lg: true,
      kicker: isNew ? "新建资讯" : "资讯 " + a.id,
      title: isNew ? "新建资讯" : "编辑资讯",
      sub: "标题、来源、摘要会直接出现在前台的情报列表里。",
      body: '<div class="dgrid">' +
        field("标题", '<input class="input" name="title" value="' + esc(a.title) + '" required>', "full") +
        field("类型", '<select name="type">' + opts([{ v: "政策", t: "政策" }, { v: "资讯", t: "资讯" }, { v: "公告", t: "公告" }], a.type) + "</select>") +
        field("来源", '<input class="input" name="source" value="' + esc(a.source) + '" placeholder="如 义乌市商务局">') +
        field("发布日期", '<input class="input" type="date" name="date" value="' + esc(a.date) + '">') +
        field("状态", '<select name="status">' + opts([{ v: "published", t: "已发布" }, { v: "draft", t: "草稿" }], a.status) + "</select>") +
        field("是否置顶", '<select name="pinned">' + opts([{ v: "1", t: "置顶" }, { v: "0", t: "不置顶" }], a.pinned ? "1" : "0") + "</select>") +
        field("摘要", '<textarea name="summary" style="min-height:88px" placeholder="两句话说明这条政策影响什么">' + esc(a.summary) + "</textarea>", "full") +
        field("正文（可选）", '<textarea name="body" style="min-height:110px" placeholder="详细解读，可留空">' + esc(a.body) + "</textarea>", "full") +
        "</div>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="a:delete" data-id="' + esc(a.id) + '">删除</button>') +
        '<span style="flex:1"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="modalForm">保存</button>',
      save: function (d) {
        if (isNew) {
          db.articles.unshift({
            id: DB.nextId("A", db.articles), title: d.title.trim(), type: d.type,
            source: d.source.trim(), status: d.status, pinned: d.pinned === "1",
            date: d.date, summary: d.summary, body: d.body
          });
          toast("已新建资讯");
        } else {
          a.title = d.title.trim();
          a.type = d.type;
          a.source = d.source.trim();
          a.status = d.status;
          a.pinned = d.pinned === "1";
          a.date = d.date;
          a.summary = d.summary;
          a.body = d.body;
          toast("资讯已保存");
        }
        DB.save();
        closeModal();
        render();
      }
    });
  }

  /* ======================================================================
     POSTS
     ====================================================================== */
  VIEWS.posts = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>07</b><span>社区帖子</span></div>' +
        "<h1>社区帖子</h1><p class=\"ahead__sub\">圈友在前台发的真实帖子。隐藏后前台立即不可见，数据保留，可随时恢复；删除会连同点赞和评论一起清除。</p></div>" +
        '<div class="ahead__actions"><a class="btn btn--sm btn--ghost" href="posts.html" target="_blank" rel="noopener">打开社区</a></div></div>' +

        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索标题或作者" data-f="q" value="' + esc(state.f.posts.q) + '"></label>' +
        chipGroup("posts", "status", [["all", "全部"], ["normal", "正常"], ["hidden", "已隐藏"]]) +
        '<span class="filters__count">共 <b id="poCount">0</b> 条</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>帖子</th><th>作者</th><th>板块</th><th>赞 / 评</th><th>状态</th><th>日期</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="poBody"></tbody></table></div></div>';
    }
  };

  PAINT.posts = function () {
    var f = state.f.posts;
    var rows = db.posts.filter(function (p) {
      if (f.status !== "all" && p.status !== f.status) return false;
      if (f.q && (p.title + p.author).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });

    $("#poBody").innerHTML = rows.length ? rows.map(function (p) {
      var hot = p.status === "reported";
      return '<tr class="is-static' + (hot ? "" : "") + '"' + (hot ? ' style="background:rgba(196,53,28,.045)"' : "") + ">" +
        '<td class="strong" style="white-space:normal;max-width:360px">' + esc(p.title) +
        (p.body ? '<div class="muted" style="font-weight:400;font-size:12px;margin-top:2px">' + esc(String(p.body).slice(0, 60)) + (String(p.body).length > 60 ? "…" : "") + "</div>" : "") + "</td>" +
        '<td class="muted">' + esc(p.author) + "</td>" +
        '<td><span class="tag" style="height:19px;font-size:9px">' + esc(p.tag) + "</span></td>" +
        '<td class="num muted">' + esc(p.likes) + " / " + esc(p.comments) + "</td>" +
        "<td>" + (p.status === "reported"
          ? '<span class="pill pill--red">被举报 ' + esc(p.reports) + "</span>"
          : p.status === "hidden"
            ? '<span class="pill pill--mute">已隐藏</span>'
            : '<span class="pill pill--ok">正常</span>') + "</td>" +
        '<td class="num muted">' + esc(p.date) + "</td>" +
        '<td><div class="tbl__acts">' +
        (p.status === "hidden"
          ? '<button class="row-btn" type="button" data-act="post:show" data-id="' + esc(p.id) + '">恢复</button>'
          : '<button class="row-btn" type="button" data-act="post:hide" data-id="' + esc(p.id) + '">隐藏</button>') +
        '<button class="row-btn row-btn--red" type="button" data-act="post:delete" data-id="' + esc(p.id) + '">删除</button>' +
        "</div></td></tr>";
    }).join("") : '<tr class="is-static"><td colspan="7"><div class="aempty"><strong>' + (db.posts.length ? "没有匹配的帖子" : "社区里还没有圈友发帖") + "</strong>" +
      (db.posts.length ? "换个状态看看。" : "圈友在前台发帖后会出现在这里。") + "</div></td></tr>";

    $("#poCount").textContent = rows.length;
  };

  /* ======================================================================
     AUDIT LOG
     ====================================================================== */
  VIEWS.audit = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>09</b><span>安全</span></div>' +
        "<h1>操作日志</h1><p class=\"ahead__sub\">谁在什么时候改了什么：登录、改账号、保存数据、处理用户与帖子、审核认证，都会记录在这里（保留最近 500 条）。</p></div></div>" +
        '<div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>时间</th><th>操作人</th><th>操作</th><th>内容</th><th>IP</th>" +
        '</tr></thead><tbody id="auBody"><tr class="is-static"><td colspan="5"><div class="aempty">加载中…</div></td></tr></tbody></table></div></div>';
    }
  };

  PAINT.audit = function () {
    DB.auditLog().then(function (r) {
      var body = document.getElementById("auBody");
      if (!body) return;
      var items = (r && r.items) || [];
      body.innerHTML = items.length ? items.map(function (it) {
        var d = new Date(it.at);
        var ts = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") +
          " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        var bad = /失败|删除|冻结/.test(it.action);
        return '<tr class="is-static"><td class="num muted" style="white-space:nowrap">' + ts + "</td>" +
          '<td class="strong">' + esc(it.user) + "</td>" +
          "<td>" + '<span class="pill ' + (bad ? "pill--red" : "pill--mute") + '">' + esc(it.action) + "</span></td>" +
          '<td style="white-space:normal;max-width:520px">' + esc(it.detail || "—") + "</td>" +
          '<td class="num muted">' + esc(it.ip || "") + "</td></tr>";
      }).join("") : '<tr class="is-static"><td colspan="5"><div class="aempty"><strong>还没有记录</strong>后台的操作会出现在这里。</div></td></tr>';
    });
  };

  /* ======================================================================
     SETTINGS
     ====================================================================== */
  function accountPanel() {
    var acc = DB.account || { user: "", name: "管理员" };
    if (acc.source === "env") {
      return '<div class="crow-note"><p class="dhint">当前账号 <b>' + esc(acc.user) + "</b> 由服务器环境变量 ADMIN_USER / ADMIN_PASS 管理，" +
        "需要在服务器上修改后重启服务。</p></div>";
    }
    return '<form id="accountForm" class="dgrid" autocomplete="off">' +
      field("登录账号", '<input class="input" name="user" value="' + esc(acc.user) + '" autocomplete="username">') +
      field("显示名称", '<input class="input" name="name" value="' + esc(acc.name) + '">') +
      field("当前密码", '<input class="input" type="password" name="current" autocomplete="current-password" required>', "full") +
      field("新密码", '<input class="input" type="password" name="pass" autocomplete="new-password" placeholder="' +
        "留空则不修改" + '">', "full", "至少 10 位，同时包含字母和数字") +
      '<div class="full" style="display:flex;justify-content:flex-end;gap:8px;align-items:center">' +
      '<span class="dhint" style="margin-right:auto">保存后其他设备上的后台登录会全部失效。</span>' +
      '<button class="btn btn--sm btn--red" type="submit">更新账号</button></div></form>';
  }

  VIEWS.settings = {
    html: function () {
      var s = db.settings;
      var t = s.toggles;

      function toggleRow(key, title, desc) {
        return '<div class="switch-row"><div class="switch-row__t"><strong>' + title + "</strong><span>" + desc + "</span></div>" +
          '<button class="switch" type="button" role="switch" aria-checked="' + (t[key] ? "true" : "false") + '" data-toggle="' + key + '" aria-label="' + title + '"></button>' +
          '<input type="hidden" name="t_' + key + '" value="' + (t[key] ? "1" : "0") + '"></div>';
      }

      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>08</b><span>全站配置</span></div>' +
        "<h1>站点设置</h1><p class=\"ahead__sub\">站点文案、功能开关、收款账号与管理员口令，全在这张表里。</p></div>" +
        '<div class="ahead__actions"><button class="btn btn--sm btn--red" type="submit" form="settingsForm">保存全部修改</button></div></div>' +

        '<form id="settingsForm"><div class="set-grid">' +
        '<div class="set-col">' +

        '<div class="panel"><div class="panel__head"><div class="panel__title">站点信息</div>' +
        '<span class="mono" style="color:var(--ink-40)">基本信息</span></div>' +
        '<div class="panel__body"><div class="dgrid">' +
        field("站点名称", '<input class="input" name="siteName" value="' + esc(s.siteName) + '">') +
        field("一句话标语", '<input class="input" name="tagline" value="' + esc(s.tagline) + '">') +
        field("站点描述", '<textarea name="description" style="min-height:70px">' + esc(s.description) + "</textarea>", "full") +
        field("顶部滚动公告（每行一条，附加在实时汇率、舱位之后）", '<textarea name="ticker" style="min-height:120px">' + esc(s.ticker.join("\n")) + "</textarea>", "full") +
        "</div></div></div>" +

        '<div class="panel"><div class="panel__head"><div class="panel__title">交易与收款</div>' +
        '<span class="mono" style="color:var(--ink-40)">支付与通知</span></div>' +
        '<div class="panel__body"><div class="dgrid">' +
        field("支付宝账号", '<input class="input" name="payAlipay" value="' + esc(s.pay.alipay) + '">') +
        field("微信收款号", '<input class="input" name="payWechat" value="' + esc(s.pay.wechat) + '">') +
        field("对公账户", '<input class="input" name="payBank" value="' + esc(s.pay.bank) + '">', "full") +
        field("试用天数", '<input class="input" type="number" name="trialDays" min="0" value="' + esc(s.pay.trialDays) + '">') +
        field("自动续费默认", '<select name="autoRenew">' + opts([{ v: "1", t: "开启" }, { v: "0", t: "关闭" }], s.pay.autoRenew ? "1" : "0") + "</select>") +
        '</div><p class="dhint" style="margin-top:12px">演示环境不发起真实扣款，订单在「方案与订单」里手动标记。</p></div></div>' +

        "</div><div class=\"set-col\">" +

        '<div class="panel"><div class="panel__head"><div class="panel__title">功能开关</div>' +
        '<span class="mono" style="color:var(--ink-40)">功能开关</span></div>' +
        '<div class="panel__body" style="padding-top:4px;padding-bottom:6px">' +
        toggleRow("register", "开放注册", "关闭后新手机号无法注册，老用户照常登录；可在「用户」里手动建号") +
        toggleRow("comment", "允许评论", "关闭后前台隐藏评论入口，接口也会拒绝新评论") +
        toggleRow("showPrice", "前台展示价格", "关闭后未登录访客看到的价格显示为「登录可见」") +
        toggleRow("merchantApply", "接受商家入驻申请", "关闭后隐藏前台「申请入驻」入口，认证接口也会拒绝提交") +
        toggleRow("maintenance", "维护模式", "开启后前台所有页面显示维护页；已登录后台的管理员仍可正常浏览") +
        "</div></div>" +

        "</div></div></form>" +

        '<div class="set-grid" style="margin-top:16px"><div class="set-col">' +
        '<div class="panel" id="accountPanel"><div class="panel__head"><div class="panel__title">管理员账号</div>' +
        '<span class="mono" style="color:var(--ink-40)">访问与权限</span></div>' +
        '<div class="panel__body">' + accountPanel() + "</div></div>" +
        "</div><div class=\"set-col\">" +
        '<div class="panel"><div class="panel__head"><div class="panel__title">数据</div>' +
        '<span class="mono" style="color:var(--ink-40)">数据管理</span></div>' +
        '<div class="panel__body" style="display:grid;gap:10px">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="data:export">导出脱敏 JSON</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="data:clear-demo">清空演示订单与统计</button>' +
        (DB.demoAllowed() ? '<button class="btn btn--ghost btn--sm" type="button" data-act="data:reset">恢复初始内容</button>' : "") +
        '<p class="dhint">数据保存在服务器（data/db.json），修改后自动同步。' +
        (DB.live ? "当前真实注册用户 " + DB.live.users + " 人，社区发帖 " + DB.live.posts + " 条，待处理认证申请 " + DB.live.applications + " 份。" : "") + "</p>" +
        "</div></div>" +
        "</div></div>";

    }
  };

  /* ======================================================================
     GLOBAL ACTIONS
     ====================================================================== */
  document.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-dtab]");
    if (tab) {
      var tform = tab.closest("#drawerForm");
      if (tform) {
        Array.prototype.forEach.call(tform.querySelectorAll("[data-dtab]"), function (b) {
          b.classList.toggle("is-on", b === tab);
        });
        Array.prototype.forEach.call(tform.querySelectorAll("[data-pane]"), function (p) {
          p.classList.toggle("is-on", p.dataset.pane === tab.dataset.dtab);
        });
      }
      return;
    }

    var cb = e.target.closest("[data-sel]");
    if (cb) {
      var ckind = cb.dataset.sel;
      if (cb.checked) selMap(ckind)[cb.value] = true;
      else delete selMap(ckind)[cb.value];
      syncBatch(ckind);
      return;
    }

    var cbAll = e.target.closest("[data-sel-all]");
    if (cbAll) {
      var akind = cbAll.dataset.selAll;
      var abody = document.getElementById(akind === "merchants" ? "mBody" : "pBody");
      var aboxes = abody ? abody.querySelectorAll("[data-sel]") : [];
      if (cbAll.checked) {
        Array.prototype.forEach.call(aboxes, function (b) {
          selMap(akind)[b.value] = true;
          b.checked = true;
        });
      } else {
        clearSel(akind);
        Array.prototype.forEach.call(aboxes, function (b) { b.checked = false; });
      }
      syncBatch(akind);
      return;
    }

    var dictAdd = e.target.closest("[data-dict-add]");
    if (dictAdd) {
      var dkind = dictAdd.dataset.dictAdd;
      var dlist = document.querySelector('[data-dict="' + dkind + '"]');
      if (dlist) {
        var drow = document.createElement("div");
        drow.className = "dict-row";
        drow.setAttribute("data-dict-item", "");
        drow.setAttribute("data-v", "");
        drow.innerHTML = '<input class="input" placeholder="新名称"><span class="mono">NEW</span>' +
          '<button type="button" data-dict-del aria-label="删除">✕</button>';
        dlist.appendChild(drow);
        drow.querySelector("input").focus();
      }
      return;
    }

    var dictDel = e.target.closest("[data-dict-del]");
    if (dictDel) {
      var dItem = dictDel.closest("[data-dict-item]");
      if (dItem) dItem.remove();
      return;
    }

    var fbtn = e.target.closest("[data-filter]");
    if (fbtn) {
      var group = fbtn.dataset.filter;
      state.f[state.route][group] = fbtn.dataset.val;
      var wrap = fbtn.parentElement;
      Array.prototype.forEach.call(wrap.children, function (b) { b.classList.toggle("is-on", b === fbtn); });
      if (PAINT[state.route]) PAINT[state.route]();
      return;
    }

    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.dataset.act;
    var id = btn.dataset.id;

    switch (act) {
      case "user:open": openUser(id); break;
      case "user:new": openUser(null); break;
      case "user:renew": {
        var u = DB.userOf(id);
        var base = u.expire && DB.daysLeft(u.expire) > 0 ? u.expire : DB.addDays("", 0);
        u.expire = DB.addDays(base, 30);
        u.status = "active";
        DB.save();
        render();
        toast(u.name + " 已续费 30 天");
        break;
      }
      case "user:freeze": {
        var uf = DB.userOf(id);
        uf.status = uf.status === "frozen" ? "active" : "frozen";
        DB.save();
        render();
        toast(uf.name + (uf.status === "frozen" ? " 已冻结" : " 已解冻"));
        break;
      }
      case "user:delete": {
        var du = DB.userOf(id);
        confirmDelete("user", id, du.name, "账号和个人主页会被删除，对方已发的帖子保留。想暂时限制对方，建议用「冻结」。");
        break;
      }
      case "delete:confirm": {
        var t = state.del;
        if (!t) return;
        if (t.kind === "user") db.users = db.users.filter(function (x) { return x.id !== t.id; });
        if (t.kind === "merchant") db.merchants = db.merchants.filter(function (x) { return x.id !== t.id; });
        if (t.kind === "product") db.products = db.products.filter(function (x) { return x.id !== t.id; });
        if (t.kind === "article") db.articles = db.articles.filter(function (x) { return x.id !== t.id; });
        if (t.kind === "post") db.posts = db.posts.filter(function (x) { return x.id !== t.id; });
        DB.save();
        closeModal();
        closeDrawer();
        render();
        toast("已删除");
        state.del = null;
        break;
      }

      case "plan:edit": openPlan(id); break;
      case "order:grant": openGrant(); break;
      case "order:paid": {
        var o = db.orders.filter(function (x) { return x.id === id; })[0];
        o.status = "paid";
        DB.save();
        render();
        toast("已标记为已支付");
        break;
      }
      case "order:refund": {
        var orf = db.orders.filter(function (x) { return x.id === id; })[0];
        orf.status = "refund";
        DB.save();
        render();
        toast("已标记退款");
        break;
      }

      case "m:open": openMerchant(id); break;
      case "m:new": openMerchant(null); break;
      case "m:approve": {
        var m = db.merchants.filter(function (x) { return x.id === id; })[0];
        m.status = "approved";
        m.verified = true;
        DB.save();
        render();
        toast(m.name + " 已通过审核");
        break;
      }
      case "m:reject": {
        var mr = db.merchants.filter(function (x) { return x.id === id; })[0];
        mr.status = "rejected";
        mr.verified = false;
        if (!mr.rejectReason) mr.rejectReason = "资料不完整，请补充后重新提交";
        DB.save();
        render();
        toast(mr.name + " 已拒绝");
        break;
      }
      case "m:feature": {
        var mf = db.merchants.filter(function (x) { return x.id === id; })[0];
        mf.featured = !mf.featured;
        DB.save();
        render();
        toast(mf.featured ? "已加入首页推荐" : "已取消推荐");
        break;
      }
      case "m:delete": {
        var dm = db.merchants.filter(function (x) { return x.id === id; })[0];
        confirmDelete("merchant", id, dm.name);
        break;
      }
      case "m:bulk-approve":
      case "m:bulk-reject":
      case "m:bulk-feature": {
        var mids = Object.keys(state.sel.merchants);
        if (!mids.length) break;
        mids.forEach(function (mid) {
          var mm = db.merchants.filter(function (x) { return x.id === mid; })[0];
          if (!mm) return;
          if (act === "m:bulk-approve") {
            mm.status = "approved";
            mm.verified = true;
            mm.rejectReason = "";
          } else if (act === "m:bulk-reject") {
            mm.status = "rejected";
            mm.verified = false;
            mm.rejectReason = "批量拒绝：资料不完整，请补充后重新提交";
          } else {
            mm.featured = true;
          }
          mm.updated = DB.addDays("", 0);
        });
        DB.save();
        clearSel("merchants");
        render();
        toast("已批量处理 " + mids.length + " 家商家");
        break;
      }
      case "m:bulk-clear":
        clearSel("merchants");
        PAINT.merchants();
        break;

      case "p:open": openProduct(id); break;
      case "p:new": openProduct(null); break;
      case "p:toggle": {
        var p = db.products.filter(function (x) { return x.id === id; })[0];
        p.status = p.status === "on" ? "off" : "on";
        DB.save();
        render();
        toast(p.status === "on" ? "已上架" : "已下架");
        break;
      }
      case "p:feature": {
        var pf = db.products.filter(function (x) { return x.id === id; })[0];
        pf.featured = !pf.featured;
        DB.save();
        render();
        toast(pf.featured ? "已设为首页推荐" : "已取消推荐");
        break;
      }
      case "p:delete": {
        var dp = db.products.filter(function (x) { return x.id === id; })[0];
        confirmDelete("product", id, dp.name);
        break;
      }
      case "p:bulk-on":
      case "p:bulk-off":
      case "p:bulk-feature": {
        var pids = Object.keys(state.sel.products);
        if (!pids.length) break;
        pids.forEach(function (pid) {
          var pp = db.products.filter(function (x) { return x.id === pid; })[0];
          if (!pp) return;
          if (act === "p:bulk-on") pp.status = "on";
          else if (act === "p:bulk-off") pp.status = "off";
          else pp.featured = true;
          pp.updated = DB.addDays("", 0);
        });
        DB.save();
        clearSel("products");
        render();
        toast("已批量处理 " + pids.length + " 个工具");
        break;
      }
      case "p:bulk-clear":
        clearSel("products");
        PAINT.products();
        break;
      case "dict:open":
        openDicts();
        break;
      case "dict:save":
        saveDicts();
        break;

      case "a:open": openArticle(id); break;
      case "a:new": openArticle(null); break;
      case "a:toggle": {
        var a = db.articles.filter(function (x) { return x.id === id; })[0];
        a.status = a.status === "published" ? "draft" : "published";
        DB.save();
        render();
        toast(a.status === "published" ? "已发布" : "已转为草稿");
        break;
      }
      case "a:pin": {
        var ap = db.articles.filter(function (x) { return x.id === id; })[0];
        ap.pinned = !ap.pinned;
        DB.save();
        render();
        toast(ap.pinned ? "已置顶" : "已取消置顶");
        break;
      }
      case "a:delete": {
        var da = db.articles.filter(function (x) { return x.id === id; })[0];
        confirmDelete("article", id, da.title);
        break;
      }

      case "post:hide": {
        var po = db.posts.filter(function (x) { return x.id === id; })[0];
        po.status = "hidden";
        DB.save();
        render();
        toast("帖子已隐藏");
        break;
      }
      case "post:show": {
        var ps = db.posts.filter(function (x) { return x.id === id; })[0];
        ps.status = "normal";
        ps.reports = 0;
        DB.save();
        render();
        toast("帖子已恢复");
        break;
      }
      case "post:delete": {
        var pd = db.posts.filter(function (x) { return x.id === id; })[0];
        confirmDelete("post", id, pd ? pd.title : "这条帖子", "帖子连同点赞、评论一起删除，无法恢复。只想下线的话，用「隐藏」。");
        break;
      }

      case "data:export": {
        var blob = new Blob([JSON.stringify(db, function (key, value) {
          return ["phone", "wechat", "license", "alipay", "bank", "pass", "pwHash"].includes(key) ? "" : value;
        }, 2)], { type: "application/json" });
        var a2 = document.createElement("a");
        a2.href = URL.createObjectURL(blob);
        a2.download = "ywai-admin-db-" + DB.addDays("", 0) + ".json";
        a2.click();
        toast("已导出脱敏数据");
        setTimeout(function () { URL.revokeObjectURL(a2.href); }, 1000);
        break;
      }
      case "data:clear-demo": {
        db.orders = [];
        db.stats = { revenue: [], signups: [], visits: [] };
        DB.save();
        render();
        toast("已清空演示订单与统计");
        break;
      }
      case "data:reset": {
        openModal({
          kicker: "危险操作",
          title: "恢复初始内容？",
          sub: "商家、AI 工具、资讯、方案和订单会回到初始内容，你的修改会被覆盖。真实用户、帖子和认证申请不受影响。",
          body: '<p class="dhint">如需保留完整数据，请先备份服务器数据目录。</p>',
          foot: '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
            '<button class="btn btn--sm btn--red" type="button" data-act="data:reset-confirm">确认重置</button>'
        });
        break;
      }
      case "data:reset-confirm": DB.reset().then(function (r) {
        if (r.ok) { closeModal(); render(); toast("已恢复初始内容"); }
      }); break;
      default:
        if (ACTIONS[act]) ACTIONS[act](id, btn, e);
    }
  });

  /* ---------------- filter inputs ---------------- */
  viewEl.addEventListener("input", function (e) {
    var input = e.target.closest("[data-f]");
    if (!input) return;
    state.f[state.route][input.dataset.f] = input.value;
    if (PAINT[state.route]) PAINT[state.route]();
  });

  /* ---------------- account form ---------------- */
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "accountForm") return;
    e.preventDefault();
    var d = {};
    new FormData(e.target).forEach(function (v, k) { d[k] = v; });
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    DB.changeAccount({ current: d.current, user: d.user.trim(), name: d.name.trim(), pass: d.pass }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { toast(r.message || "保存失败"); return; }
      paintWho();
        render();
      toast("账号已更新，其他设备需要重新登录");
    });
  });

  /* ---------------- settings form ---------------- */
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "settingsForm") return;
    e.preventDefault();
    var d = {};
    new FormData(e.target).forEach(function (v, k) { d[k] = v; });
    var s = db.settings;
    s.siteName = d.siteName.trim();
    s.tagline = d.tagline.trim();
    s.description = d.description;
    s.ticker = d.ticker.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    s.pay.alipay = d.payAlipay.trim();
    s.pay.wechat = d.payWechat.trim();
    s.pay.bank = d.payBank.trim();
    s.pay.trialDays = Number(d.trialDays) || 0;
    s.pay.autoRenew = d.autoRenew === "1";
    ["register", "inviteOnly", "comment", "showPrice", "merchantApply", "maintenance"].forEach(function (k) {
      s.toggles[k] = d["t_" + k] === "1";
    });
    DB.save();
    toast("正在提交设置");
    render();
  });

  /* ======================================================================
     AUTH GATE
     ====================================================================== */
  var gateForm = document.getElementById("gateForm");
  var gateUser = document.getElementById("gateUser");
  var gatePass = document.getElementById("gatePass");
  var gateErr = document.getElementById("gateErr");
  var gateBtn = document.getElementById("gateBtn");
  var fails = 0;
  var lockUntil = 0;

  function paintWho() {
    var acc = DB.account || { name: "管理员", user: "admin" };
    document.getElementById("sideName").textContent = acc.name || "管理员";
    document.getElementById("sideRole").textContent = "账号 " + acc.user;
    var av = document.getElementById("sideAvatar");
    av.textContent = (acc.name || "管").slice(0, 1);
  }

  var syncEl = document.getElementById("syncState");
  var SYNC_TEXT = { pending: "有未保存的修改", saving: "保存中…", saved: "已保存", loaded: "已同步", error: "保存失败", conflict: "请刷新后核对数据", expired: "登录已过期" };
  DB.onSync(function (st, detail) {
    if (st !== "pending") {
      var locked = ["saving", "conflict", "expired"].includes(st);
      viewEl.inert = locked;
      drawer.inert = locked;
      modal.inert = locked;
    }
    if (syncEl) {
      syncEl.textContent = SYNC_TEXT[st] || "";
      syncEl.dataset.state = st;
    }
    if (st === "conflict") toast(detail || "其他管理员刚刚修改过数据，请刷新后重新应用修改");
    if (st === "error") toast(detail || "同步到服务器失败，请检查网络");
    if (st === "expired") { toast("后台登录已过期，请重新登录"); setTimeout(function () { location.reload(); }, 1200); }
    if (st === "saved" || (st === "error" && DB.isOnline())) render();
  });

  function showApp() {
    gate.style.display = "none";
    app.hidden = false;
    paintWho();
    if (!location.hash) location.hash = "#/dashboard";
    render();
  }

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (Date.now() < lockUntil) {
      gateErr.textContent = "尝试次数过多，请稍后再试";
      gateErr.classList.add("is-on");
      return;
    }
    var u = gateUser.value.trim();
    var p = gatePass.value;
    if (!u || !p) {
      gateErr.textContent = "请输入账号与密码";
      gateErr.classList.add("is-on");
      return;
    }
    gateBtn.disabled = true;
    gateBtn.textContent = "核对中…";
    DB.login(u, p).then(function (r) {
      if (r.ok) return DB.pull();
      return r;
    }).then(function (r) {
      gateBtn.disabled = false;
      gateBtn.textContent = "进入后台";
      if (r.ok) {
        gateErr.classList.remove("is-on");
        gatePass.value = "";
        showApp();
        toast("欢迎回来，" + ((DB.account && DB.account.name) || "管理员"));
      } else if (r.error !== "bad_credentials") {
        gateErr.textContent = r.message || "请稍后再试";
        gateErr.classList.add("is-on");
      } else {
        fails++;
        if (fails >= 5) {
          lockUntil = Date.now() + 60000;
          gateErr.textContent = "连续 5 次错误，锁定 60 秒";
        } else {
          gateErr.textContent = "账号或密码不正确，还可尝试 " + (5 - fails) + " 次";
        }
        gateErr.classList.add("is-on");
        gatePass.value = "";
        gatePass.focus();
        gateForm.classList.remove("shake");
        void gateForm.offsetWidth;
        gateForm.classList.add("shake");
      }
    });
  });

  document.getElementById("sideOut").addEventListener("click", function () {
    localStorage.removeItem(SKEY);
    DB.logout().then(function (r) {
      if (r.ok) location.reload();
      else toast(r.message || "退出失败，请重试");
    });
  });



  /* ---------------- 扩展接口：其他后台模块在这里注册页面和动作 ---------------- */
  window.AdminUI = {
    VIEWS: VIEWS,
    PAINT: PAINT,
    ACTIONS: ACTIONS,
    BADGES: EXTRA_BADGES,
    state: state,
    esc: esc,
    opts: opts,
    field: field,
    toast: toast,
    render: render,
    renderNav: renderNav,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    openModal: openModal,
    closeModal: closeModal
  };

  /* ---------------- boot ---------------- */
  dateEl.textContent = (function () {
    var d = new Date();
    return d.getFullYear() + " · " + String(d.getMonth() + 1).padStart(2, "0") + " · " + String(d.getDate()).padStart(2, "0");
  })();

  gate.style.display = "none";
  app.hidden = true;
  DB.pull().then(function (r) {
    if (r.ok) { showApp(); return; }
    showGate();
  });

  function showGate() {
    gate.style.display = "grid";
    app.hidden = true;
    setTimeout(function () { gateUser.focus(); }, 300);
  }
})();
