"use strict";

/**
 * 义乌AI圈 — 站点服务 + 业务接口
 * 运行时：Node.js 20+，仅使用内置模块，无外部依赖。
 *
 * 数据持久化在 DATA_DIR/db.json（默认 ./data），包含：
 *   用户与密码（scrypt）、个人主页、社区帖子 / 点赞 / 收藏 / 评论、商家认证申请、运营后台数据。
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStore } = require("./lib/store");

/* ------------------------------------------------------------------ 配置 */

function loadSecrets() {
  try {
    const file = path.join(__dirname, "secrets.json");
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

const SECRETS = loadSecrets();

function conf(name) {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== "") return String(fromEnv);
  if (SECRETS[name] !== undefined && SECRETS[name] !== "") return String(SECRETS[name]);
  return "";
}

const PORT = Number(conf("PORT") || 8000);
const HOST = conf("HOST") || "0.0.0.0";

/* 静态目录：显式配置优先；否则有 public/ 用 public/，没有就用项目根目录。 */
const STATIC_DIR = path.resolve(
  conf("STATIC_DIR") ||
  (fs.existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : __dirname)
);
const DATA_DIR = path.resolve(conf("DATA_DIR") || path.join(__dirname, "data"));

const WAG_BASE_URL = (conf("WAG_BASE_URL") || "https://pay.watcha.cn").replace(/\/+$/, "");
const WAG_API_KEY = conf("WAG_API_KEY").trim();
const WAG_ENTITLEMENT_ID = conf("WAG_ENTITLEMENT_ID").trim();
const CERT_PRICE = (conf("CERT_PRICE") || "99").trim();

const store = createStore(DATA_DIR);
const db = function () { return store.data; };

/* 会话密钥：未配置时生成一次并写入数据目录，保证重启后登录态仍有效。 */
const SESSION_SECRET = conf("SESSION_SECRET") || (function () {
  const file = path.join(DATA_DIR, ".session-secret");
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    const s = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch (err) {
    return crypto.randomBytes(32).toString("hex");
  }
})();

const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const SHORT_TTL_SECONDS = 12 * 3600;
const ADMIN_TTL_SECONDS = 8 * 3600;
const COOKIE_NAME = "ywai_sid";
const ADMIN_COOKIE = "ywai_admin";
/* COOKIE_SECURE：1 强制 Secure，0 关闭，留空则按请求是否 HTTPS 自动判断。 */
const COOKIE_SECURE = conf("COOKIE_SECURE");

const SMS_MODE = (conf("SMS_MODE") || "demo").toLowerCase();
const DEMO_CODE = conf("DEMO_CODE");
const SMS_SEND_URL = conf("SMS_SEND_URL").trim();
const SMS_VERIFY_URL = conf("SMS_VERIFY_URL").trim();

const ADMIN_USER = conf("ADMIN_USER");
const ADMIN_PASS = conf("ADMIN_PASS");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

/* 只对外暴露页面与 assets/，防止 server.js、data/、secrets.json 被直接下载。 */
const STATIC_ALLOW = /^\/(?:[A-Za-z0-9_-]+\.html|favicon\.ico|robots\.txt|assets\/[A-Za-z0-9_./-]+)$/;

/* ------------------------------------------------------------------ 工具 */

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function fail(res, status, error, message) {
  return sendJSON(res, status, { ok: false, error: error, message: message || "", msg: message || "" });
}

function readBody(req, limit) {
  const max = limit || 65536;
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > max) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch (err) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch (err) {
      out[key] = "";
    }
  });
  return out;
}

function setCookie(res, name, value, maxAge) {
  const parts = [name + "=" + encodeURIComponent(value), "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAge !== null) parts.push("Max-Age=" + maxAge);
  const req = res.req;
  const https = Boolean(req && (req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").indexOf("https") === 0));
  if (COOKIE_SECURE === "1" || (COOKIE_SECURE !== "0" && https)) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? [].concat(prev) : [];
  list.push(parts.join("; "));
  res.setHeader("Set-Cookie", list);
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}

function unsign(token, ttlSeconds) {
  if (!token || token.indexOf(".") < 0) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (err) {
    return null;
  }
  if (!data || !data.i) return null;
  if (Date.now() - Number(data.i) > ttlSeconds * 1000) return null;
  return data;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}

function checkPassword(pw, stored) {
  if (!stored || stored.indexOf("scrypt$") !== 0) return false;
  const parts = stored.split("$");
  const key = crypto.scryptSync(String(pw), Buffer.from(parts[1], "hex"), 32);
  const expect = Buffer.from(parts[2], "hex");
  return key.length === expect.length && crypto.timingSafeEqual(key, expect);
}

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function userIdFor(phone) {
  return "u_" + crypto.createHash("sha256").update("ywai:" + phone).digest("hex").slice(0, 24);
}

function maskPhone(phone) {
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || ""));
}

function toneFor(phone) {
  let sum = 0;
  for (let i = 0; i < phone.length; i++) sum += phone.charCodeAt(i);
  return (sum % 3) + 1;
}

function str(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

/* 简单的内存限流：key -> [时间戳] */
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}
setInterval(function () {
  const now = Date.now();
  hits.forEach(function (list, key) {
    if (!list.length || now - list[list.length - 1] > 3600e3) hits.delete(key);
  });
}, 600e3).unref();

/* ------------------------------------------------------------------ 用户 */

function ensureUser(phone) {
  const id = userIdFor(phone);
  const users = db().users;
  let isNew = false;
  if (!users[id]) {
    users[id] = {
      id: id,
      phone: phone,
      nickname: "义乌新朋友" + phone.slice(-4),
      tone: toneFor(phone),
      pwHash: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      onboarded: false
    };
    isNew = true;
    store.save();
  }
  return { user: users[id], isNew: isNew };
}

function publicMe(u) {
  return {
    userId: u.id,
    phone: maskPhone(u.phone),
    mobile: u.phone,
    nickname: u.nickname,
    tone: u.tone || 1,
    hasPassword: Boolean(u.pwHash),
    onboarded: u.onboarded !== false,
    createdAt: u.createdAt
  };
}

function currentUser(req) {
  const data = unsign(parseCookies(req)[COOKIE_NAME], SESSION_TTL_SECONDS);
  if (!data || !data.p || !isValidPhone(data.p)) return null;
  return ensureUser(data.p).user;
}

function startSession(res, user, remember) {
  setCookie(res, COOKIE_NAME, sign({ p: user.phone, i: Date.now() }), remember === false ? SHORT_TTL_SECONDS : SESSION_TTL_SECONDS);
}

/* 验证码与锁定，进程内存即可（5 分钟有效）。 */
const otps = new Map();   // phone -> { code, exp, sentAt }
const guards = new Map(); // phone -> { code, pw, lockUntil }

function guardOf(phone) {
  return guards.get(phone) || { code: 0, pw: 0, lockUntil: 0 };
}

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (err) { data = null; }
  return { status: res.status, data: data, text: text };
}

/* ----------------------------------------------------- 爱猹收 权益查询 */

async function fetchAccess(userId) {
  if (!WAG_API_KEY || !WAG_ENTITLEMENT_ID) return { ok: false, code: "payment_not_configured" };
  let res;
  try {
    res = await fetch(WAG_BASE_URL + "/v1/entitlements/access", {
      method: "POST",
      headers: { "Authorization": "Bearer " + WAG_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ entitlement_id: WAG_ENTITLEMENT_ID, user_id: userId })
    });
  } catch (err) {
    return { ok: false, code: "payment_unreachable" };
  }
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  if (res.status < 200 || res.status >= 300 || !data) {
    return { ok: false, code: "payment_unavailable", status: res.status };
  }
  const purchase = data.purchase && data.purchase.url
    ? { url: data.purchase.url, qrCodeUrl: data.purchase.qr_code_url || "" }
    : null;
  return {
    ok: true,
    access: data.access || "unavailable",
    entitlement: data.entitlement || null,
    purchase: purchase,
    reason: data.reason || null
  };
}

/* ------------------------------------------------------------- 社区数据 */

const POST_ID = /^[A-Za-z0-9_-]{1,40}$/;

function publicPost(p) {
  const author = db().users[p.uid];
  return {
    id: p.id,
    uid: p.uid,
    name: author ? author.nickname : p.name,
    tone: author ? author.tone : 1,
    title: p.title,
    body: p.body,
    tag: p.tag,
    at: p.at,
    hasProfile: Boolean(db().profiles[p.uid])
  };
}

function reactionSummary(viewerId) {
  const out = {};
  const all = db().reactions;
  Object.keys(all).forEach(function (id) {
    const r = all[id];
    out[id] = {
      likes: r.likes.length,
      marks: r.marks.length,
      liked: viewerId ? r.likes.indexOf(viewerId) >= 0 : false,
      marked: viewerId ? r.marks.indexOf(viewerId) >= 0 : false
    };
  });
  return out;
}

function commentsSummary() {
  const out = {};
  const all = db().comments;
  Object.keys(all).forEach(function (id) {
    out[id] = all[id].map(function (c) {
      const author = db().users[c.uid];
      return { id: c.id, name: author ? author.nickname : c.name, text: c.text, at: c.at };
    });
  });
  return out;
}

function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/* ------------------------------------------------------------- 个人主页 */

const DATA_IMG = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function cleanProfile(src, user) {
  const p = src && typeof src === "object" ? src : {};
  const img = function (v) { return typeof v === "string" && DATA_IMG.test(v) && v.length < 900000 ? v : ""; };
  const tone = Number(p.tone);
  return {
    nickname: str(p.nickname, 14) || user.nickname,
    role: str(p.role, 20),
    city: str(p.city, 20),
    tagline: str(p.tagline, 40),
    bio: str(p.bio, 200),
    theme: ["paper", "ink", "red", "teal"].indexOf(p.theme) >= 0 ? p.theme : "paper",
    tone: tone >= 1 && tone <= 3 ? tone : user.tone || 1,
    avatar: img(p.avatar),
    phone: isValidPhone(p.phone) ? p.phone : "",
    wechat: str(p.wechat, 30),
    joined: /^\d{4}-\d{2}-\d{2}$/.test(p.joined) ? p.joined : new Date(user.createdAt).toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    tags: (Array.isArray(p.tags) ? p.tags : []).map(function (t) { return str(t, 12); }).filter(Boolean).slice(0, 8),
    doing: (Array.isArray(p.doing) ? p.doing : []).slice(0, 3).map(function (d) {
      return { t: str(d && d.t, 24), d: str(d && d.d, 90) };
    }).filter(function (d) { return d.t; }),
    gallery: (Array.isArray(p.gallery) ? p.gallery : []).slice(0, 6).map(function (g) {
      return {
        src: img(g && g.src),
        label: str(g && g.label, 12) || "现场照片",
        glyph: str(g && g.glyph, 1) || "照",
        tone: ["ink", "red", "teal"].indexOf(g && g.tone) >= 0 ? g.tone : "ink"
      };
    })
  };
}

/* ------------------------------------------------------------- 运营后台 */

function adminCreds() {
  if (ADMIN_USER && ADMIN_PASS) return { user: ADMIN_USER, pass: ADMIN_PASS, source: "env" };
  const doc = db().admin;
  const a = doc && doc.settings && doc.settings.admin;
  if (a && a.user && a.pass) return { user: String(a.user), pass: String(a.pass), source: "db" };
  return { user: "admin", pass: "ywai2026", source: "default" };
}

function isAdmin(req) {
  const data = unsign(parseCookies(req)[ADMIN_COOKIE], ADMIN_TTL_SECONDS);
  return Boolean(data && data.a);
}

function approvedMerchants() {
  const doc = db().admin;
  if (!doc || !Array.isArray(doc.merchants)) return null;
  return doc.merchants.filter(function (m) { return m && m.status === "approved"; }).length;
}

/* ------------------------------------------------------------- 静态资源 */

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method_not_allowed");
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    return fail(res, 400, "bad_path");
  }
  if (rel === "/" || rel === "") rel = "/index.html";

  const notFound = function () {
    const page = path.join(STATIC_DIR, "404.html");
    if (fs.existsSync(page)) {
      res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return fs.createReadStream(page).pipe(res);
    }
    res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    res.end("<!DOCTYPE html><meta charset=\"utf-8\"><title>404</title><p style=\"font:16px/1.8 system-ui;padding:48px\">页面不存在。<a href=\"/\">回首页</a></p>");
  };

  if (!STATIC_ALLOW.test(rel) || rel.indexOf("..") >= 0) return notFound();

  const filePath = path.resolve(STATIC_DIR, "." + rel);
  if (!filePath.startsWith(STATIC_DIR + path.sep)) return notFound();

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) return notFound();
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const etag = 'W/"' + stat.size.toString(16) + "-" + Math.floor(stat.mtimeMs).toString(16) + '"';
    const cache = ext === ".html" || ext === ".css" || ext === ".js" ? "no-cache" : "public, max-age=86400";
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": cache });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Cache-Control": cache, "ETag": etag });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ 路由 */

const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === "function") { handler = opts; opts = {}; }
  routes.push({ method: method, pattern: pattern, opts: opts, handler: handler });
}

async function withBody(req, res, limit) {
  try {
    return await readBody(req, limit);
  } catch (err) {
    fail(res, err.message === "body_too_large" ? 413 : 400, err.message === "body_too_large" ? "too_large" : "invalid_request",
      err.message === "body_too_large" ? "内容太大了" : "请求格式不正确");
    return null;
  }
}

/* --- 基础 --- */
route("GET", "/api/health", function (req, res) {
  sendJSON(res, 200, { ok: true, service: "yiwu-ai-circle", time: Date.now() });
});

route("GET", "/api/stats", function (req, res) {
  const d = db();
  const now = Date.now();
  sendJSON(res, 200, {
    ok: true,
    users: Object.keys(d.users).length,
    posts: d.posts.length,
    postsToday: d.posts.filter(function (p) { return sameDay(p.at, now); }).length,
    merchants: approvedMerchants()
  });
});

route("GET", "/api/cert/config", function (req, res) {
  sendJSON(res, 200, {
    ok: true,
    price: CERT_PRICE,
    currency: "CNY",
    configured: Boolean(WAG_API_KEY && WAG_ENTITLEMENT_ID),
    smsMode: SMS_MODE
  });
});

/* --- 登录：发送验证码 --- */
route("POST", "/api/auth/send", async function (req, res) {
  const body = await withBody(req, res);
  if (!body) return;
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");

  const rec = otps.get(phone);
  if (rec && Date.now() - rec.sentAt < 60e3) {
    return fail(res, 429, "too_frequent", "请求过于频繁，请 " + Math.ceil((60e3 - (Date.now() - rec.sentAt)) / 1000) + " 秒后再试");
  }
  if (rateLimited("send:" + clientIp(req), 10, 3600e3)) {
    return fail(res, 429, "too_frequent", "今天发送次数太多了，请稍后再试");
  }

  if (SMS_MODE === "api") {
    if (!SMS_SEND_URL) return fail(res, 503, "sms_not_configured", "短信通道未配置");
    try {
      const r = await postForm(SMS_SEND_URL, { phone: phone });
      if (r.status >= 200 && r.status < 300 && (!r.data || r.data.ok !== false)) {
        otps.set(phone, { code: "", exp: Date.now() + 300e3, sentAt: Date.now() });
        return sendJSON(res, 200, { ok: true, expire: 300 });
      }
      return fail(res, 502, "sms_failed", (r.data && r.data.msg) || "验证码发送失败");
    } catch (err) {
      return fail(res, 502, "sms_failed", "验证码发送失败");
    }
  }

  const code = DEMO_CODE || String(crypto.randomInt(100000, 1000000));
  otps.set(phone, { code: code, exp: Date.now() + 300e3, sentAt: Date.now() });
  sendJSON(res, 200, { ok: true, expire: 300, demoCode: code, message: "演示模式：验证码为 " + code });
});

/* --- 登录：验证码换会话 --- */
route("POST", "/api/auth/session", async function (req, res) {
  const body = await withBody(req, res);
  if (!body) return;
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  const code = str(body.code, 10);
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");

  const g = guardOf(phone);
  if (g.lockUntil > Date.now()) {
    return fail(res, 429, "locked", "尝试次数过多，请 " + Math.ceil((g.lockUntil - Date.now()) / 1000) + " 秒后再试");
  }

  if (SMS_MODE === "api") {
    if (!SMS_VERIFY_URL) return fail(res, 503, "sms_not_configured", "短信通道未配置");
    try {
      const r = await postForm(SMS_VERIFY_URL, { phone: phone, code: code });
      if (r.status < 200 || r.status >= 300 || (r.data && r.data.ok === false)) {
        return fail(res, 401, "invalid_code", (r.data && r.data.msg) || "验证码不正确");
      }
    } catch (err) {
      return fail(res, 502, "sms_failed", "验证服务暂不可用");
    }
  } else {
    const rec = otps.get(phone);
    if (!rec) return fail(res, 400, "no_code", "请先获取验证码");
    if (Date.now() > rec.exp) {
      otps.delete(phone);
      return fail(res, 400, "expired", "验证码已过期，请重新获取");
    }
    if (!/^\d{6}$/.test(code)) return fail(res, 400, "invalid_code", "请输入 6 位数字验证码");
    if (code !== rec.code) {
      const fails = (g.code || 0) + 1;
      if (fails >= 5) {
        guards.set(phone, Object.assign({}, g, { code: 0, lockUntil: Date.now() + 60e3 }));
        return fail(res, 429, "locked", "连续 5 次输入错误，已锁定 60 秒");
      }
      guards.set(phone, Object.assign({}, g, { code: fails }));
      return fail(res, 401, "invalid_code", "验证码不正确，还可尝试 " + (5 - fails) + " 次");
    }
  }

  otps.delete(phone);
  guards.set(phone, Object.assign({}, g, { code: 0 }));
  const r = ensureUser(phone);
  startSession(res, r.user, body.remember);
  sendJSON(res, 200, { ok: true, isNew: r.isNew || r.user.onboarded === false, user: publicMe(r.user) });
});

/* --- 登录：密码 --- */
route("POST", "/api/auth/password", async function (req, res) {
  const body = await withBody(req, res);
  if (!body) return;
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  const pw = String(body.password || "");
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");

  const g = guardOf(phone);
  if (g.lockUntil > Date.now()) {
    return fail(res, 429, "locked", "账号已临时锁定，请 " + Math.ceil((g.lockUntil - Date.now()) / 1000) + " 秒后再试");
  }
  const user = db().users[userIdFor(phone)];
  if (!user || !user.pwHash) {
    return fail(res, 400, "no_password", "该手机号尚未设置密码，请先用验证码登录");
  }
  if (!checkPassword(pw, user.pwHash)) {
    const fails = (g.pw || 0) + 1;
    if (fails >= 5) {
      guards.set(phone, Object.assign({}, g, { pw: 0, lockUntil: Date.now() + 300e3 }));
      return fail(res, 429, "locked", "连续 5 次密码错误，账号锁定 5 分钟");
    }
    guards.set(phone, Object.assign({}, g, { pw: fails }));
    return fail(res, 401, "bad_password", "密码不正确，还可尝试 " + (5 - fails) + " 次");
  }
  guards.set(phone, Object.assign({}, g, { pw: 0 }));
  startSession(res, user, body.remember);
  sendJSON(res, 200, { ok: true, user: publicMe(user) });
});

route("GET", "/api/auth/session", function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized");
  sendJSON(res, 200, { ok: true, user: publicMe(user) });
});

/* --- 修改昵称 / 设置密码 --- */
route("PATCH", "/api/auth/me", async function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先登录");
  const body = await withBody(req, res);
  if (!body) return;
  if (body.nickname !== undefined) {
    const nick = str(body.nickname, 30);
    if (nick.length < 2 || nick.length > 14) return fail(res, 400, "invalid_nickname", "昵称 2-14 个字");
    user.nickname = nick;
  }
  if (body.tone !== undefined) {
    const tone = Number(body.tone);
    if (tone >= 1 && tone <= 3) user.tone = tone;
  }
  if (body.password) {
    const pw = String(body.password);
    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) {
      return fail(res, 400, "weak_password", "密码至少 8 位，需同时包含字母和数字");
    }
    user.pwHash = hashPassword(pw);
  }
  user.onboarded = true;
  user.updatedAt = Date.now();
  store.save();
  sendJSON(res, 200, { ok: true, user: publicMe(user) });
});

route("POST", "/api/auth/logout", function (req, res) {
  setCookie(res, COOKIE_NAME, "", 0);
  sendJSON(res, 200, { ok: true });
});

/* --- 社区：帖子 --- */
route("GET", "/api/posts", function (req, res) {
  const user = currentUser(req);
  sendJSON(res, 200, {
    ok: true,
    posts: db().posts.slice(0, 200).map(publicPost),
    reactions: reactionSummary(user && user.id),
    comments: commentsSummary()
  });
});

route("POST", "/api/posts", async function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "发帖需要先登录");
  if (rateLimited("post:" + user.id, 10, 600e3)) return fail(res, 429, "too_frequent", "发得太快了，歇一会儿再发");
  const body = await withBody(req, res);
  if (!body) return;
  const title = str(body.title, 60);
  const text = str(body.body, 400);
  const tag = str(body.tag, 8) || "闲聊";
  if (title.length < 2) return fail(res, 400, "invalid_title", "再多写几个字吧");
  const post = {
    id: "s" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
    uid: user.id,
    name: user.nickname,
    title: title,
    body: text,
    tag: tag,
    at: Date.now()
  };
  db().posts.unshift(post);
  if (db().posts.length > 5000) db().posts.length = 5000;
  store.save();
  sendJSON(res, 200, { ok: true, post: publicPost(post) });
});

route("DELETE", /^\/api\/posts\/([A-Za-z0-9_-]{1,40})$/, function (req, res, m) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先登录");
  const list = db().posts;
  const idx = list.findIndex(function (p) { return p.id === m[1]; });
  if (idx < 0) return fail(res, 404, "not_found", "帖子不存在");
  if (list[idx].uid !== user.id) return fail(res, 403, "forbidden", "只能删除自己的帖子");
  list.splice(idx, 1);
  delete db().reactions[m[1]];
  delete db().comments[m[1]];
  store.save();
  sendJSON(res, 200, { ok: true });
});

route("POST", /^\/api\/posts\/([A-Za-z0-9_-]{1,40})\/react$/, async function (req, res, m) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先登录");
  const body = await withBody(req, res);
  if (!body) return;
  const kind = body.kind === "mark" ? "marks" : body.kind === "like" ? "likes" : null;
  if (!kind || !POST_ID.test(m[1])) return fail(res, 400, "invalid_request");
  const all = db().reactions;
  const r = all[m[1]] || (all[m[1]] = { likes: [], marks: [] });
  const idx = r[kind].indexOf(user.id);
  if (idx >= 0) r[kind].splice(idx, 1);
  else r[kind].push(user.id);
  store.save();
  sendJSON(res, 200, {
    ok: true,
    likes: r.likes.length,
    marks: r.marks.length,
    liked: r.likes.indexOf(user.id) >= 0,
    marked: r.marks.indexOf(user.id) >= 0
  });
});

route("POST", /^\/api\/posts\/([A-Za-z0-9_-]{1,40})\/comments$/, async function (req, res, m) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先登录");
  if (rateLimited("cmt:" + user.id, 20, 600e3)) return fail(res, 429, "too_frequent", "评论太频繁了，稍后再试");
  const body = await withBody(req, res);
  if (!body) return;
  const text = str(body.text, 120);
  if (!text) return fail(res, 400, "empty", "评论不能为空");
  const all = db().comments;
  const list = all[m[1]] || (all[m[1]] = []);
  const c = { id: "c" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), uid: user.id, name: user.nickname, text: text, at: Date.now() };
  list.unshift(c);
  if (list.length > 200) list.length = 200;
  store.save();
  sendJSON(res, 200, { ok: true, comment: { id: c.id, name: user.nickname, text: c.text, at: c.at } });
});

/* --- 个人主页 --- */
route("GET", "/api/profiles", function (req, res, m, url) {
  const byPhone = url.searchParams.get("u");
  const byId = url.searchParams.get("id");
  const viewer = currentUser(req);
  let uid = "";
  if (byId && /^u_[a-f0-9]{24}$/.test(byId)) uid = byId;
  else if (byPhone && isValidPhone(byPhone)) uid = userIdFor(byPhone);
  else if (viewer) uid = viewer.id;
  if (!uid) return fail(res, 400, "invalid_request");

  const isOwner = Boolean(viewer && viewer.id === uid);
  let profile = db().profiles[uid] || null;
  /* 联系方式只给已登录用户，未登录访客拿到的是空值。 */
  if (profile && !viewer) profile = Object.assign({}, profile, { phone: "", wechat: "" });
  const author = db().users[uid];
  const posts = db().posts.filter(function (p) { return p.uid === uid; }).slice(0, 50).map(publicPost);
  const reactions = db().reactions;
  const likes = posts.reduce(function (s, p) { return s + ((reactions[p.id] && reactions[p.id].likes.length) || 0); }, 0);
  sendJSON(res, 200, {
    ok: true,
    uid: uid,
    isOwner: isOwner,
    exists: Boolean(author),
    profile: profile,
    posts: posts,
    likes: likes,
    me: isOwner ? publicMe(viewer) : null
  });
});

route("PUT", "/api/profiles/me", { limit: 6 * 1024 * 1024 }, async function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先登录");
  const body = await withBody(req, res, 6 * 1024 * 1024);
  if (!body) return;
  const profile = cleanProfile(body.profile, user);
  const prev = db().profiles[user.id];
  if (prev && prev.joined) profile.joined = prev.joined;
  db().profiles[user.id] = profile;
  if (profile.nickname.length >= 2) user.nickname = profile.nickname;
  user.tone = profile.tone;
  user.onboarded = true;
  user.updatedAt = Date.now();
  store.save();
  sendJSON(res, 200, { ok: true, profile: profile, user: publicMe(user) });
});

/* --- 商家认证 --- */
route("POST", "/api/cert/apply", async function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先确认手机号");
  const body = await withBody(req, res);
  if (!body) return;
  const shopName = str(body.shopName, 80);
  const zone = str(body.zone, 40);
  const stallNo = str(body.stallNo, 48);
  const contactName = str(body.contactName, 40);
  const wechat = str(body.wechat, 64);
  const intro = str(body.intro, 400);

  if (shopName.length < 2 || shopName.length > 40) return fail(res, 400, "invalid_shop", "商家名称需 2–40 字");
  if (!zone) return fail(res, 400, "invalid_zone", "请选择所在区域");
  if (stallNo.length < 1 || stallNo.length > 24) return fail(res, 400, "invalid_stall", "请填写铺位号");
  if (contactName.length < 2 || contactName.length > 20) return fail(res, 400, "invalid_contact", "请填写联系人姓名");
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(wechat)) return fail(res, 400, "invalid_wechat", "微信号需 4–32 位字母、数字、下划线或减号");
  if (intro.length > 200) return fail(res, 400, "invalid_intro", "简介最多 200 字");

  const prev = db().applications[user.id];
  const record = {
    userId: user.id,
    phone: maskPhone(user.phone),
    shopName: shopName,
    zone: zone,
    stallNo: stallNo,
    contactName: contactName,
    wechat: wechat,
    intro: intro,
    status: prev && prev.status === "approved" ? "approved" : "pending",
    submittedAt: Date.now()
  };
  db().applications[user.id] = record;
  store.save();
  sendJSON(res, 200, { ok: true, application: record });
});

route("GET", "/api/cert/status", async function (req, res) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "请先确认手机号");
  const access = await fetchAccess(user.id);
  if (!access.ok) {
    return sendJSON(res, access.code === "payment_not_configured" ? 503 : 502, {
      ok: false,
      error: access.code,
      message: access.code === "payment_not_configured" ? "支付通道未配置" : "支付服务暂不可用，请稍后再试",
      application: db().applications[user.id] || null
    });
  }
  sendJSON(res, 200, {
    ok: true,
    user: { userId: user.id, phone: maskPhone(user.phone) },
    price: CERT_PRICE,
    access: access.access,
    entitlement: access.entitlement,
    purchase: access.purchase,
    reason: access.reason,
    application: db().applications[user.id] || null
  });
});

/* --- 运营后台 --- */
route("POST", "/api/admin/login", async function (req, res) {
  const body = await withBody(req, res);
  if (!body) return;
  if (rateLimited("admin:" + clientIp(req), 8, 600e3)) return fail(res, 429, "too_frequent", "尝试次数过多，请 10 分钟后再试");
  const c = adminCreds();
  if (!safeEqual(str(body.user, 64), c.user) || !safeEqual(String(body.pass || ""), c.pass)) {
    return fail(res, 401, "bad_credentials", "账号或密码不正确");
  }
  setCookie(res, ADMIN_COOKIE, sign({ a: c.user, i: Date.now() }), ADMIN_TTL_SECONDS);
  sendJSON(res, 200, { ok: true, user: c.user, source: c.source });
});

route("POST", "/api/admin/logout", function (req, res) {
  setCookie(res, ADMIN_COOKIE, "", 0);
  sendJSON(res, 200, { ok: true });
});

route("GET", "/api/admin/db", function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const d = db();
  sendJSON(res, 200, {
    ok: true,
    doc: d.admin,
    live: {
      users: Object.keys(d.users).length,
      posts: d.posts.length,
      applications: Object.keys(d.applications).map(function (k) { return d.applications[k]; })
    }
  });
});

route("PUT", "/api/admin/db", { limit: 8 * 1024 * 1024 }, async function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const body = await withBody(req, res, 8 * 1024 * 1024);
  if (!body) return;
  const doc = body.doc;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.users) || !doc.settings) {
    return fail(res, 400, "invalid_doc", "数据结构不正确");
  }
  db().admin = doc;
  store.save();
  sendJSON(res, 200, { ok: true, savedAt: Date.now() });
});

async function handleApi(req, res, pathname, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  /* 写请求只接受同源 JSON，挡住跨站表单提交。 */
  if (req.method !== "GET" && req.method !== "HEAD") {
    const ct = String(req.headers["content-type"] || "");
    const origin = req.headers.origin;
    if (origin && req.headers.host && origin.replace(/^https?:\/\//, "") !== req.headers.host) {
      return fail(res, 403, "cross_origin", "不允许跨站请求");
    }
    if (req.headers["content-length"] && Number(req.headers["content-length"]) > 0 && ct.indexOf("application/json") < 0) {
      return fail(res, 415, "unsupported_media_type", "请使用 JSON");
    }
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (typeof r.pattern === "string") {
      if (r.pattern === pathname) return r.handler(req, res, null, url);
    } else {
      const m = pathname.match(r.pattern);
      if (m) return r.handler(req, res, m, url);
    }
  }
  return fail(res, 404, "not_found");
}

const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch (err) {
    return fail(res, 400, "bad_request");
  }
  const pathname = url.pathname;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  if (pathname.startsWith("/api/")) {
    Promise.resolve(handleApi(req, res, pathname, url)).catch(function (err) {
      console.error("[api]", req.method, pathname, err);
      if (!res.headersSent) fail(res, 500, "internal_error", "服务器开小差了，请稍后再试");
    });
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, function () {
  console.log("[yiwu-ai-circle] http://" + HOST + ":" + PORT + "  static=" + STATIC_DIR + "  data=" + store.file);
  console.log("[yiwu-ai-circle] payment=" + Boolean(WAG_API_KEY && WAG_ENTITLEMENT_ID) + " sms=" + SMS_MODE + " admin=" + adminCreds().source);
  if (adminCreds().source === "default") {
    console.warn("[yiwu-ai-circle] ⚠ 运营后台仍在使用默认账号 admin / ywai2026，上线前请设置 ADMIN_USER / ADMIN_PASS");
  }
});

function shutdown() {
  try { store.flushSync(); } catch (err) { console.error("[store] 退出前写盘失败：", err.message); }
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
