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
const net = require("node:net");
const { validAdminDoc, validMerchant } = require("./lib/admin-document");
const installEvents = require("./lib/events");
const installPartners = require("./lib/partners");
const { createMailer } = require("./lib/mailer");
const { createStore } = require("./lib/store");
const adminSeed = require("./lib/admin-seed");

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
const HOST = conf("HOST") || "127.0.0.1";
const NODE_ENV = (conf("NODE_ENV") || "development").toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const TRUST_PROXY = conf("TRUST_PROXY") === "1";
const TRUSTED_PROXY_IPS = new Set((conf("TRUSTED_PROXY_IPS") || "127.0.0.1,::1").split(",").map(normalizeIp));
function normalizeIp(ip) { return String(ip).trim().replace(/^::ffff:/, ""); }
function trustedProxy(req) { return TRUST_PROXY && TRUSTED_PROXY_IPS.has(normalizeIp(req.socket.remoteAddress)); }

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
const SESSION_SECRET_CONFIGURED = Boolean(conf("SESSION_SECRET"));
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
const adminSessions = new Map();
/* COOKIE_SECURE：1 强制 Secure，0 关闭，留空则按请求是否 HTTPS 自动判断。 */
const COOKIE_SECURE = conf("COOKIE_SECURE") || (IS_PRODUCTION ? "1" : "");

const SMS_MODE = (conf("SMS_MODE") || (IS_PRODUCTION ? "api" : "demo")).toLowerCase();
const DEMO_CODE = conf("DEMO_CODE");
const SMS_SEND_URL = conf("SMS_SEND_URL").trim();
const SMS_VERIFY_URL = conf("SMS_VERIFY_URL").trim();

/* 对外访问地址（二维码里的链接用它）；不填则按请求的 Host 推断 */
const PUBLIC_URL = conf("PUBLIC_URL").trim().replace(/\/+$/, "");

/* 发邮件（报名后把邀请函发到报名人邮箱）；不配 SMTP_HOST 就不发 */
const mailer = createMailer({
  host: conf("SMTP_HOST"), port: conf("SMTP_PORT"), secure: conf("SMTP_SECURE"),
  user: conf("SMTP_USER"), pass: conf("SMTP_PASS"), from: conf("SMTP_FROM")
});

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
    let exceeded = false;
    const chunks = [];
    req.on("data", function (chunk) {
      if (exceeded) return;
      size += chunk.length;
      if (size > max) {
        exceeded = true;
        chunks.length = 0;
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      if (exceeded) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(new Error("invalid_json"));
        resolve(parsed);
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
  const https = Boolean(req && (req.socket.encrypted || (trustedProxy(req) && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https")));
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
  if (!data || !Number.isSafeInteger(data.i) || data.i > Date.now() || data.i <= 0) return null;
  if (Date.now() - data.i > ttlSeconds * 1000) return null;
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
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return false;
  try {
    const key = crypto.scryptSync(String(pw), Buffer.from(parts[1], "hex"), 32);
    const expect = Buffer.from(parts[2], "hex");
    return key.length === expect.length && crypto.timingSafeEqual(key, expect);
  } catch (err) {
    return false;
  }
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
  const direct = normalizeIp(req.socket.remoteAddress || "");
  if (!trustedProxy(req)) return direct;
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(normalizeIp);
  if (!forwarded.length || !forwarded.every(ip => net.isIP(ip))) return direct;
  const chain = forwarded.concat(direct);
  while (chain.length > 1 && TRUSTED_PROXY_IPS.has(chain[chain.length - 1])) chain.pop();
  return chain[chain.length - 1];
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
  adminSessions.forEach((expires, id) => { if (expires <= now) adminSessions.delete(id); });
  otps.forEach((entry, phone) => { if (entry.exp <= now) otps.delete(phone); });
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
  const user = db().users[userIdFor(data.p)];
  if (!user || user.status === "frozen") return null;
  return user;
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

function invalidCode(res, phone, message) {
  const guard = guardOf(phone);
  const fails = (guard.code || 0) + 1;
  if (fails >= 5) {
    guards.set(phone, Object.assign({}, guard, { code: 0, lockUntil: Date.now() + 60e3 }));
    return fail(res, 429, "locked", "连续 5 次输入错误，已锁定 60 秒");
  }
  guards.set(phone, Object.assign({}, guard, { code: fails }));
  return fail(res, 401, "invalid_code", message || ("验证码不正确，还可尝试 " + (5 - fails) + " 次"));
}

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10000)
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
      body: JSON.stringify({ entitlement_id: WAG_ENTITLEMENT_ID, user_id: userId }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    return { ok: false, code: "payment_unreachable" };
  }
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  if (res.status < 200 || res.status >= 300 || !data) {
    return { ok: false, code: "payment_unavailable", status: res.status };
  }
  const externalUrl = function (value) {
    try {
      const u = new URL(String(value));
      return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
    } catch (err) {
      return "";
    }
  };
  const purchaseUrl = data.purchase && externalUrl(data.purchase.url);
  const qrCodeUrl = data.purchase && externalUrl(data.purchase.qr_code_url);
  const purchase = purchaseUrl ? { url: purchaseUrl, qrCodeUrl: qrCodeUrl } : null;
  return {
    ok: true,
    access: data.access || "unavailable",
    entitlement: data.entitlement || null,
    purchase: purchase,
    reason: data.reason || null
  };
}

/* ------------------------------------------------------------- 社区数据 */

// The public community page also renders nine built-in posts.
function publicPostIds() {
  return new Set(db().posts.filter(p => !p.hidden).map(p => p.id).concat(
    Array.from({ length: 9 }, (_, index) => "p" + index)
  ));
}

function canInteractWithPost(id) {
  return /^p[0-8]$/.test(id) || db().posts.some(p => p.id === id && !p.hidden);
}

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

function reactionSummary(viewerId, visibleIds) {
  const out = {};
  const all = db().reactions;
  Object.keys(all).forEach(function (id) {
    if (!visibleIds.has(id)) return;
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

function commentsSummary(visibleIds) {
  const out = {};
  const all = db().comments;
  Object.keys(all).forEach(function (id) {
    if (!visibleIds.has(id)) return;
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

const RETIRED_ADMIN_PASSWORD = "ywai2026";
const DOC_LABELS = { plans: "方案", orders: "订单", merchants: "商家", products: "AI 工具", articles: "资讯" };

function day(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* 启动时：没有后台数据就写入初始内容；旧版数据做一次迁移。 */
function initAdminDoc() {
  const d = db();
  if (!d.admin) {
    d.admin = adminSeed.seed({ demo: !IS_PRODUCTION });
    d.adminRev = 1;
  }
  const doc = adminSeed.migrate(d.admin);
  doc.settings = doc.settings || {};
  const legacy = doc.settings.admin || {};
  /* 旧版把后台口令明文存在 settings.admin.pass：转成哈希后删除明文 */
  if (legacy.pass && String(legacy.pass) !== RETIRED_ADMIN_PASSWORD) {
    if (!d.adminAuth) {
      d.adminAuth = { user: str(legacy.user, 32) || "admin", name: str(legacy.name, 20) || "管理员", pwHash: hashPassword(String(legacy.pass)), ver: 1, updatedAt: Date.now() };
    }
  }
  doc.settings.admin = { name: str(legacy.name, 20) || "管理员" };
  /* 旧版的演示用户 / 演示帖子不再使用，后台改读真实数据 */
  doc.users = [];
  doc.posts = [];
  if (Array.isArray(doc.settings.ticker) && doc.settings.ticker.some(function (t) { return /今日新帖 46|认证商家 128/.test(t); })) {
    doc.settings.ticker = [];
  }
  if (!d.adminRev) d.adminRev = 1;
  if (!Array.isArray(d.audit)) d.audit = [];
  store.save();
}

function adminAccount() {
  const a = db().adminAuth;
  if (ADMIN_USER && ADMIN_PASS) return { user: ADMIN_USER, name: (a && a.name) || "管理员", source: "env", ver: 0 };
  if (a && a.pwHash) return { user: a.user, name: a.name || "管理员", source: "db", ver: a.ver || 1 };
  return { user: "", name: "管理员", source: "unset", ver: 0 };
}

function checkAdminLogin(user, pass) {
  const acc = adminAccount();
  if (acc.source === "unset" || pass === RETIRED_ADMIN_PASSWORD || !safeEqual(user, acc.user)) return false;
  if (acc.source === "env") return safeEqual(pass, ADMIN_PASS);
  if (acc.source === "db") return checkPassword(pass, db().adminAuth.pwHash);
  return false;
}

/* 后台会话绑定账号与口令版本：改密码后旧会话全部失效。 */
function adminSession(req) {
  const data = unsign(parseCookies(req)[ADMIN_COOKIE], ADMIN_TTL_SECONDS);
  if (!data || !data.a || !data.s || !(adminSessions.get(data.s) > Date.now())) return null;
  const acc = adminAccount();
  if (data.a !== acc.user || Number(data.v || 0) !== acc.ver) return null;
  return acc;
}

function issueAdminSession(res, acc) {
  const id = crypto.randomBytes(24).toString("base64url");
  adminSessions.set(id, Date.now() + ADMIN_TTL_SECONDS * 1000);
  setCookie(res, ADMIN_COOKIE, sign({ a: acc.user, v: acc.ver, s: id, i: Date.now() }), ADMIN_TTL_SECONDS);
}

function isAdmin(req) {
  return Boolean(adminSession(req));
}

function publicAccount(acc) {
  return { user: acc.user, name: acc.name, source: acc.source };
}

function audit(req, action, detail, who) {
  const acc = who ? null : adminSession(req);
  db().audit.unshift({
    at: Date.now(),
    user: who || (acc ? acc.user : "—"),
    ip: clientIp(req),
    action: action,
    detail: String(detail || "").slice(0, 400)
  });
  if (db().audit.length > 500) db().audit.length = 500;
  store.save();
}

function nameIn(list, id) {
  const it = list.find(function (z) { return z && z.id === id; });
  return (it && (it.name || it.title || it.userName || it.id)) || id;
}

/* 对比保存前后的后台数据，生成一句人能看懂的变更摘要。 */
function diffDoc(a, b) {
  const parts = [];
  Object.keys(DOC_LABELS).forEach(function (k) {
    const x = Array.isArray(a && a[k]) ? a[k] : [];
    const y = Array.isArray(b && b[k]) ? b[k] : [];
    const mx = new Map(x.map(function (i) { return [i && i.id, JSON.stringify(i)]; }));
    const my = new Map(y.map(function (i) { return [i && i.id, JSON.stringify(i)]; }));
    let add = 0, del = 0, mod = 0;
    const names = [];
    my.forEach(function (v, id) {
      if (!mx.has(id)) { add++; names.push(nameIn(y, id)); }
      else if (mx.get(id) !== v) { mod++; names.push(nameIn(y, id)); }
    });
    mx.forEach(function (v, id) {
      if (!my.has(id)) { del++; names.push(nameIn(x, id)); }
    });
    if (add || del || mod) {
      parts.push(DOC_LABELS[k] + (add ? " 新增 " + add : "") + (mod ? " 修改 " + mod : "") + (del ? " 删除 " + del : "") +
        "（" + names.slice(0, 3).join("、") + (names.length > 3 ? " 等" : "") + "）");
    }
  });
  const other = { settings: "站点设置", dicts: "字典", stats: "统计数据" };
  Object.keys(other).forEach(function (k) {
    if (JSON.stringify(a && a[k]) !== JSON.stringify(b && b[k])) parts.push(other[k]);
  });
  return parts.join("；");
}

/* 保存前清洗：用户与帖子是实时数据，不随整库保存；口令字段一律丢弃。 */
function cleanDoc(doc, prev) {
  const out = Object.assign({}, doc);
  out.users = [];
  out.posts = [];
  out.merchants = (Array.isArray(doc.merchants) ? doc.merchants : []).filter(function (m) { return m && !m.live; });
  out.settings = Object.assign({}, doc.settings || {});
  out.settings.admin = { name: str(out.settings.admin && out.settings.admin.name, 20) || (prev && prev.settings && prev.settings.admin && prev.settings.admin.name) || "管理员" };
  return out;
}

function siteToggles() {
  const s = db().admin && db().admin.settings;
  return Object.assign({ register: true, comment: true, showPrice: true, merchantApply: true, maintenance: false }, (s && s.toggles) || {});
}

function approvedMerchants() {
  const doc = db().admin;
  if (!doc || !Array.isArray(doc.merchants)) return null;
  return doc.merchants.filter(function (m) { return m && m.status === "approved"; }).length;
}

function memberStatus(u) {
  if (u.status === "frozen") return "frozen";
  if (u.status === "expired") return "expired";
  if (u.expire && (u.plan || "free") !== "free" && new Date(u.expire + "T23:59:59").getTime() < Date.now()) return "expired";
  return "active";
}

function adminMembers() {
  const d = db();
  const count = {};
  d.posts.forEach(function (p) { count[p.uid] = (count[p.uid] || 0) + 1; });
  return Object.keys(d.users).map(function (k) { return d.users[k]; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; })
    .map(function (u) {
      return {
        id: u.id, name: u.nickname, phone: u.phone, plan: u.plan || "free", status: memberStatus(u),
        joined: day(u.createdAt), expire: u.expire || "", spend: u.spend || 0, posts: count[u.id] || 0,
        tone: u.tone || 1, note: u.note || "", live: true
      };
    });
}

function adminPostList() {
  const d = db();
  return d.posts.map(function (p) {
    const author = d.users[p.uid];
    const r = d.reactions[p.id];
    return {
      id: p.id, author: author ? author.nickname : p.name, authorId: p.uid, tag: p.tag, title: p.title, body: p.body,
      likes: r ? r.likes.length : 0, comments: (d.comments[p.id] || []).length, reports: 0,
      status: p.hidden ? "hidden" : "normal", date: day(p.at), live: true
    };
  });
}

const ZONE_KEYS = [["北下朱", "beixiazhu"], ["青口", "qingkou"], ["廿三里", "niansanli"], ["佛堂", "fotang"], ["商贸城", "tradecity"], ["篁园", "tradecity"]];
function zoneKey(text) {
  const hit = ZONE_KEYS.find(function (z) { return String(text || "").indexOf(z[0]) >= 0; });
  return hit ? hit[1] : "tradecity";
}

function adminApplications() {
  const d = db();
  return Object.keys(d.applications).map(function (k) { return d.applications[k]; })
    .filter(function (a) { return a.status !== "approved"; })
    .map(function (a) {
      const u = d.users[a.userId];
      return {
        id: "AP-" + a.userId.slice(2, 10), appUid: a.userId, name: a.shopName, stall: a.stallNo,
        zone: zoneKey(a.zone), zoneName: a.zone, owner: a.contactName, phone: u ? u.phone : "", wechat: a.wechat,
        tags: [], intro: a.intro || "", level: "normal", minOrder: "1 件", leadTime: "当天", hours: "08:30 - 17:30",
        license: "", certExpire: "", verified: false, status: a.status === "rejected" ? "rejected" : "pending",
        rejectReason: a.rejectReason || "", featured: false, weight: 60, views: 0, leads: 0,
        joined: day(a.submittedAt), updated: day(a.submittedAt), live: true
      };
    });
}

function liveData() {
  return { members: adminMembers(), posts: adminPostList(), applications: adminApplications() };
}

function cleanMerchant(src, base) {
  const m = Object.assign({}, base || {}, src || {});
  const tags = Array.isArray(m.tags) ? m.tags : String(m.tags || "").split(/[、,，\s]+/);
  return {
    id: base && base.id, name: str(m.name, 40), stall: str(m.stall, 24), zone: str(m.zone, 20) || "tradecity",
    zoneName: str(m.zoneName, 30), owner: str(m.owner, 20), phone: str(m.phone, 20), wechat: str(m.wechat, 40),
    tags: tags.map(function (t) { return str(t, 12); }).filter(Boolean).slice(0, 6), intro: str(m.intro, 200),
    level: ["diamond", "gold", "normal"].indexOf(m.level) >= 0 ? m.level : "normal",
    minOrder: str(m.minOrder, 20), leadTime: str(m.leadTime, 20), hours: str(m.hours, 30),
    license: str(m.license, 30), certExpire: str(m.certExpire, 10), verified: true, status: "approved",
    rejectReason: "", featured: Boolean(m.featured), weight: Number(m.weight) || 60, views: 0, leads: 0,
    joined: day(), updated: day(), fromApplication: m.appUid || ""
  };
}

function nextMerchantId(list) {
  let max = 0;
  list.forEach(function (m) {
    const n = parseInt(String(m.id || "").replace(/\D/g, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return "M-" + String(max + 1).padStart(3, "0");
}

const MAINTENANCE_HTML = "<!DOCTYPE html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
  "<title>维护中 · 义乌AI圈</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ec;color:#17150f;" +
  "font:16px/1.8 'PingFang SC','Microsoft YaHei',system-ui,sans-serif\"><div style=\"max-width:420px;padding:40px 28px;text-align:center\">" +
  "<div style=\"display:inline-grid;place-items:center;width:64px;height:64px;border:2px solid #c8381e;border-radius:50%;color:#c8381e;" +
  "font-weight:700;transform:rotate(-8deg);margin-bottom:18px\">维护</div><h1 style=\"margin:0 0 8px;font-size:24px\">站点维护中</h1>" +
  "<p style=\"margin:0;color:rgba(23,21,15,.6)\">我们正在升级服务，稍后回来看看。</p></div></body></html>";

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

  if (/\.html$/.test(rel) && rel !== "/admin.html" && siteToggles().maintenance && !isAdmin(req)) {
    res.writeHead(503, { "Content-Type": MIME[".html"], "Cache-Control": "no-store", "Retry-After": "600" });
    return res.end(MAINTENANCE_HTML);
  }

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
    postsToday: d.posts.filter(function (p) { return !p.hidden && sameDay(p.at, now); }).length,
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
  if (IS_PRODUCTION && SMS_MODE !== "api") return fail(res, 503, "sms_not_configured", "生产环境未启用真实短信");
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");

  const rec = otps.get(phone);
  if (rec && (rec.sending || rec.verifying)) return fail(res, 429, "too_frequent", "验证码请求正在处理");
  if (rec && Date.now() - rec.sentAt < 60e3) {
    return fail(res, 429, "too_frequent", "请求过于频繁，请 " + Math.ceil((60e3 - (Date.now() - rec.sentAt)) / 1000) + " 秒后再试");
  }
  if (rateLimited("send:" + clientIp(req), 10, 3600e3)) {
    return fail(res, 429, "too_frequent", "今天发送次数太多了，请稍后再试");
  }

  if (SMS_MODE === "api") {
    if (!SMS_SEND_URL) return fail(res, 503, "sms_not_configured", "短信通道未配置");
    const pending = { sending: true, exp: Date.now() + 15e3 };
    otps.set(phone, pending);
    try {
      const r = await postForm(SMS_SEND_URL, { phone: phone });
      if (r.status >= 200 && r.status < 300 && r.data && r.data.ok === true) {
        otps.set(phone, { code: "", exp: Date.now() + 300e3, sentAt: Date.now() });
        return sendJSON(res, 200, { ok: true, expire: 300 });
      }
      return fail(res, 502, "sms_failed", (r.data && r.data.msg) || "验证码发送失败");
    } catch (err) {
      return fail(res, 502, "sms_failed", "验证码发送失败");
    } finally {
      if (otps.get(phone) === pending) otps.delete(phone);
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
  if (IS_PRODUCTION && SMS_MODE !== "api") return fail(res, 503, "sms_not_configured", "生产环境未启用真实短信");
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  const code = str(body.code, 10);
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");
  if (!/^\d{6}$/.test(code)) return fail(res, 400, "invalid_code", "请输入 6 位数字验证码");

  const g = guardOf(phone);
  if (g.lockUntil > Date.now()) {
    return fail(res, 429, "locked", "尝试次数过多，请 " + Math.ceil((g.lockUntil - Date.now()) / 1000) + " 秒后再试");
  }
  if (rateLimited("code-ip:" + clientIp(req), 30, 600e3)) {
    return fail(res, 429, "too_frequent", "验证尝试过多，请稍后再试");
  }

  const challenge = otps.get(phone);
  if (!challenge || challenge.sending || challenge.exp <= Date.now()) return fail(res, 400, "no_code", "请重新获取验证码");
  if (challenge.verifying) return fail(res, 429, "too_frequent", "验证码正在验证中");
  challenge.verifying = true;
  try {
    if (SMS_MODE === "api") {
      if (!SMS_VERIFY_URL) return fail(res, 503, "sms_not_configured", "短信通道未配置");
      try {
        const r = await postForm(SMS_VERIFY_URL, { phone: phone, code: code });
        const invalid = (r.data && r.data.ok === false) || r.status === 400 || r.status === 401 || r.status === 403;
        if (invalid) {
          return invalidCode(res, phone, (r.data && (r.data.msg || r.data.message)) || "验证码不正确");
        }
        if (r.status < 200 || r.status >= 300 || !r.data || r.data.ok !== true) {
          return fail(res, 502, "sms_failed", "验证服务暂不可用");
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
        return invalidCode(res, phone);
      }
    }

    const existing = db().users[userIdFor(phone)];
    if (!existing && siteToggles().register === false) {
      return fail(res, 403, "register_closed", "暂停新用户注册，已有账号可正常登录");
    }
    if (existing && existing.status === "frozen") {
      return fail(res, 403, "frozen", "账号已被冻结，如有疑问请联系运营");
    }
    otps.delete(phone);
    guards.set(phone, Object.assign({}, g, { code: 0 }));
    const r = ensureUser(phone);
    startSession(res, r.user, body.remember);
    sendJSON(res, 200, { ok: true, isNew: r.isNew || r.user.onboarded === false, user: publicMe(r.user) });
  } finally { challenge.verifying = false; }
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
  if (user.status === "frozen") return fail(res, 403, "frozen", "账号已被冻结，如有疑问请联系运营");
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
  const visibleIds = publicPostIds();
  sendJSON(res, 200, {
    ok: true,
    posts: db().posts.filter(function (p) { return !p.hidden; }).slice(0, 200).map(publicPost),
    reactions: reactionSummary(user && user.id, visibleIds),
    comments: commentsSummary(visibleIds)
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
  if (!kind) return fail(res, 400, "invalid_request");
  if (!canInteractWithPost(m[1])) return fail(res, 404, "not_found", "帖子不存在");
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
  if (siteToggles().comment === false) return fail(res, 403, "comment_closed", "评论功能暂时关闭");
  if (rateLimited("cmt:" + user.id, 20, 600e3)) return fail(res, 429, "too_frequent", "评论太频繁了，稍后再试");
  const body = await withBody(req, res);
  if (!body) return;
  const text = str(body.text, 120);
  if (!text) return fail(res, 400, "empty", "评论不能为空");
  if (!canInteractWithPost(m[1])) return fail(res, 404, "not_found", "帖子不存在");
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
  /* 个人主页联系方式仅对本人返回。 */
  if (profile && !isOwner) profile = Object.assign({}, profile, { phone: "", wechat: "" });
  const author = db().users[uid];
  const posts = db().posts.filter(function (p) { return p.uid === uid && !p.hidden; }).slice(0, 50).map(publicPost);
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
  if (siteToggles().merchantApply === false) return fail(res, 403, "apply_closed", "商家入驻申请暂时关闭");
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

/* --- 前台：站点配置与商品目录（来自运营后台） --- */
route("GET", "/api/site", function (req, res) {
  const doc = db().admin || {};
  const s = doc.settings || {};
  const viewer = currentUser(req);
  const t = siteToggles();
  const hidePrice = t.showPrice === false && !viewer;
  sendJSON(res, 200, {
    ok: true,
    settings: {
      siteName: s.siteName || "义乌AI圈",
      tagline: s.tagline || "",
      ticker: Array.isArray(s.ticker) ? s.ticker : [],
      toggles: { register: t.register !== false, comment: t.comment !== false, showPrice: t.showPrice !== false, merchantApply: t.merchantApply !== false }
    },
    dicts: doc.dicts || { zones: [], cats: [] },
    merchants: (doc.merchants || []).filter(function (m) { return m && m.status === "approved"; })
      .sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.weight || 0) - (a.weight || 0); })
      .map(function (m) {
        return {
          id: m.id, name: m.name, stall: m.stall, zone: m.zone, zoneName: m.zoneName, tags: m.tags || [], intro: m.intro,
          level: m.level, minOrder: m.minOrder, leadTime: m.leadTime, hours: m.hours, verified: Boolean(m.verified),
          featured: Boolean(m.featured), certExpire: m.certExpire || ""
        };
      }),
    products: (doc.products || []).filter(function (p) { return p && p.status === "on"; })
      .sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.weight || 0) - (a.weight || 0); })
      .map(function (p) {
        return {
          id: p.id, name: p.name, cat: p.cat, platform: p.platform, price: hidePrice ? null : p.price, unit: p.unit,
          billing: p.billing, trial: p.trial, delivery: p.delivery, langs: p.langs, vendor: p.vendor, desc: p.desc,
          badge: p.badge, featured: Boolean(p.featured)
        };
      }),
    priceHidden: hidePrice
  });
});

route("GET", /^\/api\/merchants\/([A-Za-z0-9_-]{1,20})\/contact$/, function (req, res, m) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "unauthorized", "查看联系方式需要先登录");
  if (rateLimited("contact:" + user.id, 60, 3600e3)) return fail(res, 429, "too_frequent", "查看太频繁了，稍后再试");
  const doc = db().admin || {};
  const mer = (doc.merchants || []).find(function (x) { return x.id === m[1] && x.status === "approved"; });
  if (!mer) return fail(res, 404, "not_found", "商家不存在或已下线");
  sendJSON(res, 200, { ok: true, contact: { owner: mer.owner, phone: mer.phone, wechat: mer.wechat, hours: mer.hours } });
});

/* --- 运营后台：登录与账号 --- */
route("POST", "/api/admin/login", async function (req, res) {
  const body = await withBody(req, res);
  if (!body) return;
  if (rateLimited("admin:" + clientIp(req), 8, 600e3)) return fail(res, 429, "too_frequent", "尝试次数过多，请 10 分钟后再试");
  const user = str(body.user, 64);
  if (adminAccount().source === "unset") return fail(res, 503, "admin_not_configured", "后台账号未配置");
  if (!checkAdminLogin(user, String(body.pass || ""))) {
    audit(req, "登录失败", "账号：" + (user || "（空）"), user || "—");
    return fail(res, 401, "bad_credentials", "账号或密码不正确");
  }
  const acc = adminAccount();
  issueAdminSession(res, acc);
  audit(req, "登录后台", "", acc.user);
  sendJSON(res, 200, { ok: true, account: publicAccount(acc) });
});

route("POST", "/api/admin/logout", function (req, res) {
  const data = unsign(parseCookies(req)[ADMIN_COOKIE], ADMIN_TTL_SECONDS);
  if (data && data.s) adminSessions.delete(data.s);
  setCookie(res, ADMIN_COOKIE, "", 0);
  sendJSON(res, 200, { ok: true });
});

route("POST", "/api/admin/account", async function (req, res) {
  const acc = adminSession(req);
  if (!acc) return fail(res, 401, "unauthorized", "请先登录后台");
  if (acc.source === "env") return fail(res, 409, "managed_by_env", "后台账号由服务器环境变量 ADMIN_USER / ADMIN_PASS 管理，请在服务器上修改");
  const body = await withBody(req, res);
  if (!body) return;
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  if (rateLimited("adminpw:" + clientIp(req), 10, 600e3)) return fail(res, 429, "too_frequent", "尝试次数过多，请稍后再试");
  if (!checkAdminLogin(acc.user, String(body.current || ""))) return fail(res, 401, "bad_current", "当前密码不正确");
  const user = str(body.user, 32) || acc.user;
  const name = str(body.name, 20) || acc.name;
  const pass = String(body.pass || "");
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(user)) return fail(res, 400, "invalid_user", "账号需 3–32 位字母、数字、下划线、点或减号");
  if (pass && (pass.length < 10 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass))) {
    return fail(res, 400, "weak_password", "新密码至少 10 位，且同时包含字母和数字");
  }
  if (pass && pass === RETIRED_ADMIN_PASSWORD) return fail(res, 400, "weak_password", "不能使用默认密码");
  const prev = db().adminAuth || {};
  db().adminAuth = {
    user: user,
    name: name,
    pwHash: pass ? hashPassword(pass) : prev.pwHash,
    ver: (prev.ver || 0) + 1,
    updatedAt: Date.now()
  };
  if (db().admin && db().admin.settings) {
    db().admin.settings.admin = { name: name };
    db().adminRev += 1;
  }
  store.save();
  const next = adminAccount();
  adminSessions.clear();
  issueAdminSession(res, next);
  audit(req, "修改后台账号", (user !== acc.user ? "账号 " + acc.user + " → " + user + "；" : "") + (pass ? "已更换密码；" : "") + "其他会话已失效", user);
  sendJSON(res, 200, { ok: true, account: publicAccount(next) });
});

/* --- 运营后台：整库数据（带版本号，防止多人同时编辑互相覆盖） --- */
route("GET", "/api/admin/db", function (req, res) {
  const acc = adminSession(req);
  if (!acc) return fail(res, 401, "unauthorized", "请先登录后台");
  sendJSON(res, 200, { ok: true, doc: db().admin, rev: db().adminRev, live: liveData(), account: publicAccount(acc), demoAllowed: !IS_PRODUCTION });
});

route("PUT", "/api/admin/db", { limit: 8 * 1024 * 1024 }, async function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const body = await withBody(req, res, 8 * 1024 * 1024);
  if (!body) return;
  const doc = body.doc;
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  if (!validAdminDoc(doc)) {
    return fail(res, 400, "invalid_doc", "数据结构不正确");
  }
  if (!Number.isSafeInteger(body.rev) || body.rev < 1) return fail(res, 400, "invalid_revision", "必须提供有效的数据版本号");
  if (body.rev !== db().adminRev) {
    return sendJSON(res, 409, {
      ok: false, error: "conflict", message: "后台数据已更新，请刷新后重新应用修改",
      rev: db().adminRev
    });
  }
  const prev = db().admin;
  const next = cleanDoc(doc, prev);
  const summary = diffDoc(prev, next);
  if (!summary) return sendJSON(res, 200, { ok: true, rev: db().adminRev, unchanged: true });
  db().admin = next;
  db().adminRev += 1;
  store.save();
  audit(req, "保存后台数据", summary);
  sendJSON(res, 200, { ok: true, rev: db().adminRev });
});

route("POST", "/api/admin/reset", function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  if (IS_PRODUCTION) return fail(res, 403, "demo_disabled", "生产环境不能恢复演示数据");
  const prev = db().admin;
  db().admin = adminSeed.seed();
  db().admin.settings.admin = { name: (prev && prev.settings && prev.settings.admin && prev.settings.admin.name) || "管理员" };
  db().adminRev += 1;
  store.save();
  audit(req, "恢复初始数据", "商家、AI 工具、资讯、方案、订单恢复为初始内容（真实用户与帖子不受影响）");
  sendJSON(res, 200, { ok: true, rev: db().adminRev });
});

route("GET", "/api/admin/audit", function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  sendJSON(res, 200, { ok: true, items: db().audit.slice(0, 200) });
});

/* --- 运营后台：真实用户 --- */
const PLAN_IDS = ["free", "pro", "studio"];

function applyMemberPatch(u, body) {
  if (body.name !== undefined) {
    const n = str(body.name, 30);
    if (n.length < 2 || n.length > 14) return "昵称 2-14 个字";
    u.nickname = n;
  }
  if (body.plan !== undefined) {
    const plans = ((db().admin && db().admin.plans) || []).map(function (p) { return p.id; });
    if ((plans.length ? plans : PLAN_IDS).indexOf(body.plan) < 0) return "订阅方案不存在";
    u.plan = body.plan;
  }
  if (body.status !== undefined) {
    if (["active", "expired", "frozen"].indexOf(body.status) < 0) return "账号状态不正确";
    u.status = body.status;
  }
  if (body.expire !== undefined) {
    if (body.expire && !/^\d{4}-\d{2}-\d{2}$/.test(body.expire)) return "到期日格式不正确";
    u.expire = body.expire || "";
  }
  if (body.spend !== undefined) u.spend = Math.max(0, Math.round(Number(body.spend) || 0));
  if (body.note !== undefined) u.note = str(body.note, 200);
  u.updatedAt = Date.now();
  return "";
}

route("POST", "/api/admin/members", async function (req, res) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const body = await withBody(req, res);
  if (!body) return;
  const phone = str(body.phone, 20).replace(/\s|-/g, "");
  if (!isValidPhone(phone)) return fail(res, 400, "invalid_phone", "请输入有效的 11 位手机号");
  const id = userIdFor(phone);
  if (db().users[id]) return fail(res, 409, "exists", "这个手机号已经注册过了");
  const u = { id: id, phone: phone, nickname: "义乌新朋友" + phone.slice(-4), tone: toneFor(phone), pwHash: "", createdAt: Date.now(), updatedAt: Date.now(), onboarded: true, createdBy: "admin" };
  const err = applyMemberPatch(u, body);
  if (err) return fail(res, 400, "invalid", err);
  db().users[id] = u;
  store.save();
  audit(req, "新增用户", u.nickname + "（" + maskPhone(phone) + "）");
  sendJSON(res, 200, { ok: true, member: adminMembers().find(function (x) { return x.id === id; }) });
});

route("PATCH", /^\/api\/admin\/members\/(u_[a-f0-9]{24})$/, async function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const u = db().users[m[1]];
  if (!u) return fail(res, 404, "not_found", "用户不存在");
  const body = await withBody(req, res);
  if (!body) return;
  const before = { plan: u.plan || "free", status: memberStatus(u), expire: u.expire || "" };
  const err = applyMemberPatch(u, body);
  if (err) return fail(res, 400, "invalid", err);
  store.save();
  const after = { plan: u.plan || "free", status: memberStatus(u), expire: u.expire || "" };
  const changes = Object.keys(after).filter(function (k) { return before[k] !== after[k]; })
    .map(function (k) { return { plan: "方案", status: "状态", expire: "到期" }[k] + " " + (before[k] || "—") + " → " + (after[k] || "—"); });
  audit(req, after.status === "frozen" && before.status !== "frozen" ? "冻结用户" : "修改用户", u.nickname + (changes.length ? "：" + changes.join("，") : ""));
  sendJSON(res, 200, { ok: true });
});

route("DELETE", /^\/api\/admin\/members\/(u_[a-f0-9]{24})$/, function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const u = db().users[m[1]];
  if (!u) return fail(res, 404, "not_found", "用户不存在");
  delete db().users[m[1]];
  delete db().profiles[m[1]];
  store.save();
  audit(req, "删除用户", u.nickname + "（" + maskPhone(u.phone) + "），帖子保留");
  sendJSON(res, 200, { ok: true });
});

/* --- 运营后台：社区帖子 --- */
route("PATCH", /^\/api\/admin\/posts\/([A-Za-z0-9_-]{1,40})$/, async function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const p = db().posts.find(function (x) { return x.id === m[1]; });
  if (!p) return fail(res, 404, "not_found", "帖子不存在");
  const body = await withBody(req, res);
  if (!body) return;
  p.hidden = body.status === "hidden";
  store.save();
  audit(req, p.hidden ? "隐藏帖子" : "恢复帖子", "「" + p.title + "」");
  sendJSON(res, 200, { ok: true });
});

route("DELETE", /^\/api\/admin\/posts\/([A-Za-z0-9_-]{1,40})$/, function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const list = db().posts;
  const idx = list.findIndex(function (x) { return x.id === m[1]; });
  if (idx < 0) return fail(res, 404, "not_found", "帖子不存在");
  const p = list[idx];
  list.splice(idx, 1);
  delete db().reactions[p.id];
  delete db().comments[p.id];
  store.save();
  audit(req, "删除帖子", "「" + p.title + "」");
  sendJSON(res, 200, { ok: true });
});

/* --- 运营后台：商家认证申请 --- */
route("POST", /^\/api\/admin\/applications\/(u_[a-f0-9]{24})$/, async function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const app = db().applications[m[1]];
  if (!app) return fail(res, 404, "not_found", "申请不存在");
  const body = await withBody(req, res);
  if (!body) return;
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  if (db().applications[m[1]] !== app || app.status === "approved") return fail(res, 409, "application_changed", "申请已变更，请刷新后重试");
  if (body.action === "approve") {
    const doc = db().admin;
    const mer = cleanMerchant(Object.assign({}, body.merchant || {}, { appUid: m[1] }), {
      name: app.shopName, stall: app.stallNo, zone: zoneKey(app.zone), zoneName: app.zone, owner: app.contactName,
      phone: (db().users[m[1]] || {}).phone || "", wechat: app.wechat, intro: app.intro
    });
    mer.id = nextMerchantId(doc.merchants);
    if (!validMerchant(mer)) return fail(res, 400, "invalid_merchant", "商家字段格式不正确");
    doc.merchants.unshift(mer);
    app.status = "approved";
    app.rejectReason = "";
    app.decidedAt = Date.now();
    db().adminRev += 1;
    store.save();
    audit(req, "通过商家认证", app.shopName + " → 已上架为 " + mer.id);
    return sendJSON(res, 200, { ok: true, rev: db().adminRev, merchantId: mer.id });
  }
  if (body.action === "reject") {
    app.status = "rejected";
    app.rejectReason = str(body.reason, 120) || "资料不完整，请补充后重新提交";
    app.decidedAt = Date.now();
    store.save();
    audit(req, "拒绝商家认证", app.shopName + "：" + app.rejectReason);
    return sendJSON(res, 200, { ok: true });
  }
  fail(res, 400, "invalid_action", "操作不正确");
});

route("DELETE", /^\/api\/admin\/applications\/(u_[a-f0-9]{24})$/, function (req, res, m) {
  if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
  const app = db().applications[m[1]];
  if (!app) return fail(res, 404, "not_found", "申请不存在");
  delete db().applications[m[1]];
  store.save();
  audit(req, "删除认证申请", app.shopName);
  sendJSON(res, 200, { ok: true });
});

/* --- 活动报名与客资 --- */
function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  return (requestIsHttps(req) ? "https" : "http") + "://" + String(req.headers.host || "localhost");
}
const eventsModule = installEvents({
  route, db, store, sendJSON, fail, withBody, isAdmin, audit, rateLimited, clientIp, isValidPhone, str,
  dataDir: DATA_DIR, publicBase, mailer, currentUser
});
installPartners({ route, db, store, sendJSON, fail, withBody, isAdmin, audit, str, uploadUrl: eventsModule.uploadUrl });

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
    if ((Number(req.headers["content-length"]) > 0 || req.headers["transfer-encoding"]) && !/^application\/json(?:\s*;|$)/i.test(ct)) {
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

function requestIsHttps(req) {
  return Boolean(req.socket.encrypted || (trustedProxy(req) && req.headers["x-forwarded-proto"] === "https"));
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data: https:");
  if (IS_PRODUCTION && requestIsHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000");

  if (pathname.startsWith("/api/")) {
    Promise.resolve(handleApi(req, res, pathname, url)).catch(function (err) {
      console.error("[api]", req.method, pathname, err);
      if (!res.headersSent) fail(res, 500, "internal_error", "服务器开小差了，请稍后再试");
    });
    return;
  }
  if (pathname.startsWith("/uploads/")) {
    if (eventsModule.serveUpload(req, res, pathname)) return;
    return serveStatic(req, res, "/__missing__");
  }
  /* 活动短链 /e/<slug> 统一由 event.html 渲染 */
  if (/^\/e\/[a-z0-9-]{1,40}\/?$/.test(pathname)) return serveStatic(req, res, "/event.html");
  serveStatic(req, res, pathname);
});

const configurationErrors = [];
if (!["api", "demo"].includes(SMS_MODE)) configurationErrors.push("SMS_MODE");
configurationErrors.push(...mailer.problems(IS_PRODUCTION));
if (IS_PRODUCTION) {
  if (!SESSION_SECRET_CONFIGURED || Buffer.byteLength(SESSION_SECRET) < 32) configurationErrors.push("SESSION_SECRET (32+ random bytes)");
  if (COOKIE_SECURE !== "1") configurationErrors.push("COOKIE_SECURE=1");
  if (SMS_MODE !== "api" || !SMS_SEND_URL || !SMS_VERIFY_URL) configurationErrors.push("SMS_MODE=api and SMS provider URLs");
  if (ADMIN_USER || ADMIN_PASS) {
    if (!ADMIN_USER || ADMIN_PASS.length < 12 || ADMIN_PASS === RETIRED_ADMIN_PASSWORD) configurationErrors.push("ADMIN_USER / ADMIN_PASS (12+ characters)");
  } else if (!db().adminAuth || !db().adminAuth.pwHash) {
    configurationErrors.push("ADMIN_USER / ADMIN_PASS or a migrated hashed admin account");
  }
}
if (configurationErrors.length) {
  console.error("[yiwu-ai-circle] configuration invalid: " + configurationErrors.join(", "));
  process.exit(1);
}

initAdminDoc();
server.listen(PORT, HOST, function () {
  console.log("[yiwu-ai-circle] http://" + HOST + ":" + server.address().port);
  console.log("[yiwu-ai-circle] payment=" + Boolean(WAG_API_KEY && WAG_ENTITLEMENT_ID) + " sms=" + SMS_MODE + " mail=" + mailer.configured + " admin=" + adminAccount().source);
});

function shutdown() {
  try { store.flushSync(); } catch (err) { console.error("[store] 退出前写盘失败：", err.message); }
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
