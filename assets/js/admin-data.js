/* ==========================================================================
   义乌AI圈 · 后台数据层
   - 后台数据全部来自服务端（/api/admin/db），浏览器不再缓存任何后台数据。
   - 「用户」「社区帖子」是真实注册用户与真实帖子；商家列表里会混入待审核的认证申请。
   - admin.js 照常修改 db 并调用 save()：这里负责把改动拆成两类同步回服务端：
       1. 商家 / 工具 / 资讯 / 方案 / 订单 / 设置 → 整库保存（带版本号，冲突时停止提交）
       2. 用户、帖子、认证申请 → 逐条调用对应接口（冻结、隐藏、通过审核等）
   ========================================================================== */
(function () {
  "use strict";

  var DAY = 86400000;

  try {
    localStorage.removeItem("ywai.admin.db.v1");
    localStorage.removeItem("ywai.admin.session.v1");
  } catch (e) {}

  function skeleton() {
    return {
      meta: {},
      stats: { revenue: [], signups: [], visits: [] },
      plans: [],
      users: [],
      orders: [],
      merchants: [],
      products: [],
      dicts: { zones: [], cats: [] },
      articles: [],
      posts: [],
      settings: {
        siteName: "", tagline: "", description: "", ticker: [],
        toggles: {},
        pay: { alipay: "", wechat: "", bank: "", trialDays: 0, autoRenew: false },
        admin: { name: "管理员" }
      }
    };
  }

  var db = skeleton();
  var rev = 0;
  var demoAllowed = false;
  var snap = { users: {}, posts: {}, apps: {} };

  /* ---------------- 请求 ---------------- */
  function req(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        d.status = r.status;
        if (!r.ok && d.ok === undefined) d.ok = false;
        return d;
      });
    }, function () {
      return { ok: false, status: 0, message: "网络异常，请稍后再试" };
    });
  }

  var listeners = [];
  function notify(state, detail) {
    listeners.forEach(function (fn) { try { fn(state, detail); } catch (e) {} });
  }

  /* ---------------- 载入服务端数据 ---------------- */
  function mapById(list) {
    var out = {};
    list.forEach(function (x) { out[x.id] = JSON.stringify(x); });
    return out;
  }

  function snapshot() {
    snap.users = mapById(db.users);
    snap.posts = mapById(db.posts);
    snap.apps = mapById(db.merchants.filter(function (m) { return m.live; }));
  }

  function replace(doc, live, newRev) {
    var base = skeleton();
    Object.keys(db).forEach(function (k) { delete db[k]; });
    Object.keys(base).forEach(function (k) { db[k] = doc && doc[k] !== undefined ? doc[k] : base[k]; });
    db.settings = Object.assign(base.settings, db.settings || {});
    live = live || { members: [], posts: [], applications: [] };
    db.users = live.members || [];
    db.posts = live.posts || [];
    db.merchants = (live.applications || []).concat((db.merchants || []).filter(function (m) { return !m.live; }));
    rev = newRev || rev;
    window.AdminDB.live = {
      users: db.users.length,
      posts: db.posts.length,
      applications: (live.applications || []).length
    };
    snapshot();
  }

  function pull() {
    return req("GET", "/api/admin/db").then(function (r) {
      if (!r.ok) return r;
      replace(r.doc, r.live, r.rev);
      window.AdminDB.account = r.account || null;
      demoAllowed = r.demoAllowed === true;
      notify("loaded");
      return r;
    });
  }

  /* ---------------- 真实数据：拆成逐条操作 ---------------- */
  function memberBody(u) {
    return { name: u.name, phone: u.phone, plan: u.plan, status: u.status, expire: u.expire || "", spend: u.spend || 0, note: u.note || "" };
  }

  function liveOps() {
    var ops = [];
    var cur = {};

    db.users.forEach(function (u) {
      cur[u.id] = true;
      if (!snap.users[u.id]) {
        ops.push({ m: "POST", url: "/api/admin/members", body: memberBody(u), label: "新增用户 " + u.name });
      } else if (snap.users[u.id] !== JSON.stringify(u)) {
        ops.push({ m: "PATCH", url: "/api/admin/members/" + u.id, body: memberBody(u), label: "保存用户 " + u.name });
      }
    });
    Object.keys(snap.users).forEach(function (id) {
      if (!cur[id]) ops.push({ m: "DELETE", url: "/api/admin/members/" + id, label: "删除用户" });
    });

    cur = {};
    db.posts.forEach(function (p) {
      cur[p.id] = true;
      var before = snap.posts[p.id] ? JSON.parse(snap.posts[p.id]) : null;
      if (before && before.status !== p.status) {
        ops.push({ m: "PATCH", url: "/api/admin/posts/" + encodeURIComponent(p.id), body: { status: p.status === "hidden" ? "hidden" : "normal" }, label: "更新帖子" });
      }
    });
    Object.keys(snap.posts).forEach(function (id) {
      if (!cur[id]) ops.push({ m: "DELETE", url: "/api/admin/posts/" + encodeURIComponent(id), label: "删除帖子" });
    });

    cur = {};
    db.merchants.forEach(function (m) {
      if (!m.live) return;
      cur[m.id] = true;
      var before = snap.apps[m.id] ? JSON.parse(snap.apps[m.id]) : null;
      if (!before || before.status === m.status) return;
      if (m.status === "approved") {
        ops.push({ m: "POST", url: "/api/admin/applications/" + m.appUid, body: { action: "approve", merchant: m }, label: "通过 " + m.name });
      } else if (m.status === "rejected") {
        ops.push({ m: "POST", url: "/api/admin/applications/" + m.appUid, body: { action: "reject", reason: m.rejectReason }, label: "拒绝 " + m.name });
      }
    });
    Object.keys(snap.apps).forEach(function (id) {
      if (!cur[id]) {
        var gone = JSON.parse(snap.apps[id]);
        ops.push({ m: "DELETE", url: "/api/admin/applications/" + gone.appUid, label: "删除申请" });
      }
    });
    return ops;
  }

  function docPayload() {
    var out = {};
    Object.keys(db).forEach(function (k) { out[k] = db[k]; });
    out.users = [];
    out.posts = [];
    out.merchants = db.merchants.filter(function (m) { return !m.live; });
    return out;
  }

  /* ---------------- 保存 ---------------- */
  var online = false;
  var pushTimer = null;
  var pushing = null;

  function runOps(ops) {
    var errors = [];
    return ops.reduce(function (p, op) {
      return p.then(function () {
        return req(op.m, op.url, op.body).then(function (r) {
          if (!r.ok) errors.push(op.label + "：" + (r.message || "失败"));
        });
      });
    }, Promise.resolve()).then(function () { return errors; });
  }

  function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!online) return Promise.resolve({ ok: false });
    if (pushing) {
      return pushing;
    }
    notify("saving");
    var ops = liveOps();

    pushing = (async function () {
      var result = await req("PUT", "/api/admin/db", { doc: docPayload(), rev: rev });
      if (result.status === 401 || result.status === 409) {
        online = false;
        notify(result.status === 401 ? "expired" : "conflict", result.message);
        return result;
      }
      if (!result.ok) {
        notify("error", result.message || "保存失败");
        return result;
      }
      rev = result.rev;
      if (ops.length) {
        var errors = await runOps(ops);
        var refreshed = await pull();
        // Some operations may already have succeeded. Require a fresh read before another write.
        if (!refreshed.ok) {
          online = false;
          notify("conflict", "操作已发送，但无法确认最新数据，请刷新后核对结果");
          return refreshed;
        }
        if (errors.length) {
          notify("error", errors.join("；"));
          return { ok: false };
        }
      }
      notify("saved");
      return result;
    })().finally(function () { pushing = null; });
    return pushing;
  }

  function save() {
    if (!online || pushing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 350);
    notify("pending");
  }

  window.addEventListener("beforeunload", function (e) {
    if (pushTimer || pushing) {
      if (pushTimer) push();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  async function reset() {
    if (!online || !demoAllowed || pushing) return { ok: false, message: "当前无法恢复演示数据" };
    clearTimeout(pushTimer);
    pushTimer = null;
    notify("saving");
    var result = await req("POST", "/api/admin/reset");
    if (result.ok) result = await pull();
    if (!result.ok) notify("error", result.message || "恢复失败，请刷新后核对数据");
    return result;
  }

  function login(user, pass) {
    return req("POST", "/api/admin/login", { user: user, pass: pass });
  }

  async function logout() {
    if (pushTimer || pushing) {
      var saved = await push();
      if (!saved.ok) return saved;
    }
    var result = await req("POST", "/api/admin/logout");
    if (result.ok) {
      online = false;
      replace(null, null, 0);
      window.AdminDB.account = null;
    }
    return result;
  }

  function changeAccount(body) {
    return req("POST", "/api/admin/account", body).then(async function (r) {
      if (r.ok) {
        var refreshed = await pull();
        if (!refreshed.ok) {
          online = false;
          notify("conflict", "账号已更新，请刷新后台同步最新数据");
        }
      }
      return r;
    });
  }

  function auditLog() {
    return req("GET", "/api/admin/audit");
  }

  /* ---------------- 工具函数 ---------------- */
  function uid(prefix, n) {
    return prefix + "-" + String(n).padStart(3, "0");
  }

  function nextId(prefix, list) {
    var max = 0;
    list.forEach(function (item) {
      var n = parseInt(String(item.id).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return uid(prefix, max + 1);
  }

  function orderId() {
    var d = new Date();
    var ymd = "" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    var today = db.orders.filter(function (o) { return o.id.indexOf("YW-" + ymd) === 0; }).length + 1;
    return "YW-" + ymd + "-" + String(today).padStart(2, "0");
  }

  function planOf(id) {
    return db.plans.filter(function (p) { return p.id === id; })[0] || db.plans[0] || { id: "free", name: "体验版", price: 0, unit: "月" };
  }

  function userOf(id) {
    return db.users.filter(function (u) { return u.id === id; })[0] || null;
  }

  function money(n) {
    return "¥" + Number(n || 0).toLocaleString("zh-CN");
  }

  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr + "T23:59:59").getTime() - Date.now()) / DAY);
  }

  function addDays(dateStr, n) {
    var base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    return new Date(base.getTime() + n * DAY).toISOString().slice(0, 10);
  }

  window.AdminDB = {
    db: db,
    live: null,
    account: null,
    save: save,
    reset: reset,
    demoAllowed: function () { return demoAllowed; },
    pull: function () {
      return pull().then(function (r) {
        if (r.ok) online = true;
        return r;
      });
    },
    push: push,
    login: login,
    logout: logout,
    changeAccount: changeAccount,
    auditLog: auditLog,
    onSync: function (fn) { listeners.push(fn); },
    isOnline: function () { return online; },
    nextId: nextId,
    orderId: orderId,
    planOf: planOf,
    userOf: userOf,
    money: money,
    daysLeft: daysLeft,
    addDays: addDays
  };
})();
