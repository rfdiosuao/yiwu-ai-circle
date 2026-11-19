"use strict";

/**
 * 义乌AI圈 — 静态站点 + 商家认证支付接口
 * 运行时：Node.js 20，仅使用内置模块，无外部依赖。
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8000);
const HOST = "0.0.0.0";
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, "public"));

/* 密钥优先取环境变量；部署产物无法注入环境变量时，回退读取同目录 secrets.json。 */
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

const WAG_BASE_URL = (conf("WAG_BASE_URL") || "https://pay.watcha.cn").replace(/\/+$/, "");
const WAG_API_KEY = conf("WAG_API_KEY").trim();
const WAG_ENTITLEMENT_ID = conf("WAG_ENTITLEMENT_ID").trim();
const CERT_PRICE = (conf("CERT_PRICE") || "99").trim();

const SESSION_SECRET = conf("SESSION_SECRET") || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const COOKIE_NAME = "ywai_sid";

const SMS_MODE = (conf("SMS_MODE") || "demo").toLowerCase();
const DEMO_CODE = conf("DEMO_CODE") || "123456";
const SMS_SEND_URL = conf("SMS_SEND_URL").trim();
const SMS_VERIFY_URL = conf("SMS_VERIFY_URL").trim();

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
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

/* 认证申请暂存在进程内存：重启后由前端本地缓存自动回填，付费状态以支付平台为准。 */
const applications = new Map();

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

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > 65536) {
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
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function setCookie(res, value, maxAge) {
  const secure = process.env.COOKIE_SECURE === "0" ? "" : "; Secure";
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure
  );
}

function signToken(phone) {
  const payload = Buffer.from(
    JSON.stringify({ p: phone, i: Date.now() }),
    "utf8"
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}

function verifyToken(token) {
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
  if (!data || !data.p || !data.i) return null;
  if (Date.now() - Number(data.i) > SESSION_TTL_SECONDS * 1000) return null;
  return data;
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

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  const data = verifyToken(token);
  if (!data) return null;
  return { phone: data.p, userId: userIdFor(data.p), masked: maskPhone(data.p) };
}

async function postForm(url, fields) {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = null;
  }
  return { status: res.status, data, text };
}

/* ----------------------------------------------------- 爱猹收 权益查询 */

async function fetchAccess(userId) {
  if (!WAG_API_KEY || !WAG_ENTITLEMENT_ID) {
    return { ok: false, code: "payment_not_configured" };
  }
  let res;
  try {
    res = await fetch(WAG_BASE_URL + "/v1/entitlements/access", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + WAG_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ entitlement_id: WAG_ENTITLEMENT_ID, user_id: userId })
    });
  } catch (err) {
    return { ok: false, code: "payment_unreachable" };
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
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

/* ------------------------------------------------------------- 静态资源 */

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJSON(res, 405, { ok: false, error: "method_not_allowed" });
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    return sendJSON(res, 400, { ok: false, error: "bad_path" });
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.endsWith("/")) rel += "index.html";

  const filePath = path.resolve(STATIC_DIR, "." + rel);
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + path.sep)) {
    return sendJSON(res, 403, { ok: false, error: "forbidden" });
  }

  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end("<!DOCTYPE html><meta charset=\"utf-8\"><title>404</title><p style=\"font:16px/1.8 system-ui;padding:48px\">页面不存在。<a href=\"/\">回首页</a></p>");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const etag = 'W/"' + stat.size.toString(16) + "-" + Math.floor(stat.mtimeMs).toString(16) + '"';
    const cache = ext === ".html" ? "no-cache" : "public, max-age=3600";

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": cache });
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": cache,
      "ETag": etag
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ 路由 */

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return sendJSON(res, 200, { ok: true, service: "yiwu-ai-circle", time: Date.now() });
  }

  if (pathname === "/api/cert/config" && req.method === "GET") {
    return sendJSON(res, 200, {
      ok: true,
      price: CERT_PRICE,
      currency: "CNY",
      configured: Boolean(WAG_API_KEY && WAG_ENTITLEMENT_ID),
      smsMode: SMS_MODE
    });
  }

  /* --- 发送验证码 --- */
  if (pathname === "/api/auth/send" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJSON(res, 400, { ok: false, error: "invalid_request" });
    }
    const phone = String(body.phone || "").trim();
    if (!isValidPhone(phone)) {
      return sendJSON(res, 400, { ok: false, error: "invalid_phone", message: "请输入有效的 11 位手机号" });
    }
    if (SMS_MODE === "api") {
      if (!SMS_SEND_URL) {
        return sendJSON(res, 503, { ok: false, error: "sms_not_configured", message: "短信通道未配置" });
      }
      try {
        const r = await postForm(SMS_SEND_URL, { phone: phone });
        if (r.status >= 200 && r.status < 300 && (!r.data || r.data.ok !== false)) {
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 502, { ok: false, error: "sms_failed", message: (r.data && r.data.msg) || "验证码发送失败" });
      } catch (err) {
        return sendJSON(res, 502, { ok: false, error: "sms_failed", message: "验证码发送失败" });
      }
    }
    return sendJSON(res, 200, { ok: true, demoCode: DEMO_CODE, message: "演示模式：验证码为 " + DEMO_CODE });
  }

  /* --- 建立会话 --- */
  if (pathname === "/api/auth/session" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJSON(res, 400, { ok: false, error: "invalid_request" });
    }
    const phone = String(body.phone || "").trim();
    const code = String(body.code || "").trim();
    if (!isValidPhone(phone)) {
      return sendJSON(res, 400, { ok: false, error: "invalid_phone", message: "请输入有效的 11 位手机号" });
    }
    if (SMS_MODE === "api") {
      if (!SMS_VERIFY_URL) {
        return sendJSON(res, 503, { ok: false, error: "sms_not_configured", message: "短信通道未配置" });
      }
      try {
        const r = await postForm(SMS_VERIFY_URL, { phone: phone, code: code });
        if (r.status < 200 || r.status >= 300 || (r.data && r.data.ok === false)) {
          return sendJSON(res, 401, { ok: false, error: "invalid_code", message: (r.data && r.data.msg) || "验证码不正确" });
        }
      } catch (err) {
        return sendJSON(res, 502, { ok: false, error: "sms_failed", message: "验证服务暂不可用" });
      }
    } else if (code !== DEMO_CODE) {
      return sendJSON(res, 401, { ok: false, error: "invalid_code", message: "验证码不正确" });
    }
    const token = signToken(phone);
    setCookie(res, token, SESSION_TTL_SECONDS);
    return sendJSON(res, 200, {
      ok: true,
      user: { userId: userIdFor(phone), phone: maskPhone(phone) }
    });
  }

  if (pathname === "/api/auth/session" && req.method === "GET") {
    const user = currentUser(req);
    if (!user) return sendJSON(res, 401, { ok: false, error: "unauthorized" });
    return sendJSON(res, 200, { ok: true, user: { userId: user.userId, phone: user.masked } });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    setCookie(res, "", 0);
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 提交认证资料 --- */
  if (pathname === "/api/cert/apply" && req.method === "POST") {
    const user = currentUser(req);
    if (!user) return sendJSON(res, 401, { ok: false, error: "unauthorized", message: "请先确认手机号" });
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJSON(res, 400, { ok: false, error: "invalid_request" });
    }
    const shopName = String(body.shopName || "").trim();
    const zone = String(body.zone || "").trim();
    const stallNo = String(body.stallNo || "").trim();
    const contactName = String(body.contactName || "").trim();
    const wechat = String(body.wechat || "").trim();
    const intro = String(body.intro || "").trim();

    if (shopName.length < 2 || shopName.length > 40) {
      return sendJSON(res, 400, { ok: false, error: "invalid_shop", message: "商家名称需 2–40 字" });
    }
    if (!zone) {
      return sendJSON(res, 400, { ok: false, error: "invalid_zone", message: "请选择所在区域" });
    }
    if (stallNo.length < 1 || stallNo.length > 24) {
      return sendJSON(res, 400, { ok: false, error: "invalid_stall", message: "请填写铺位号" });
    }
    if (contactName.length < 2 || contactName.length > 20) {
      return sendJSON(res, 400, { ok: false, error: "invalid_contact", message: "请填写联系人姓名" });
    }
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(wechat)) {
      return sendJSON(res, 400, { ok: false, error: "invalid_wechat", message: "微信号需 4–32 位字母、数字、下划线或减号" });
    }
    if (intro.length > 200) {
      return sendJSON(res, 400, { ok: false, error: "invalid_intro", message: "简介最多 200 字" });
    }

    const record = {
      userId: user.userId,
      phone: user.masked,
      shopName: shopName,
      zone: zone,
      stallNo: stallNo,
      contactName: contactName,
      wechat: wechat,
      intro: intro,
      submittedAt: Date.now()
    };
    applications.set(user.userId, record);
    return sendJSON(res, 200, { ok: true, application: record });
  }

  /* --- 认证与支付状态 --- */
  if (pathname === "/api/cert/status" && req.method === "GET") {
    const user = currentUser(req);
    if (!user) return sendJSON(res, 401, { ok: false, error: "unauthorized", message: "请先确认手机号" });

    const access = await fetchAccess(user.userId);
    if (!access.ok) {
      return sendJSON(res, access.code === "payment_not_configured" ? 503 : 502, {
        ok: false,
        error: access.code,
        message: access.code === "payment_not_configured" ? "支付通道未配置" : "支付服务暂不可用，请稍后再试"
      });
    }
    return sendJSON(res, 200, {
      ok: true,
      user: { userId: user.userId, phone: user.masked },
      price: CERT_PRICE,
      access: access.access,
      entitlement: access.entitlement,
      purchase: access.purchase,
      reason: access.reason,
      application: applications.get(user.userId) || null
    });
  }

  return sendJSON(res, 404, { ok: false, error: "not_found" });
}

const server = http.createServer(function (req, res) {
  let pathname = "/";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (err) {
    return sendJSON(res, 400, { ok: false, error: "bad_request" });
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname).catch(function (err) {
      if (!res.headersSent) {
        sendJSON(res, 500, { ok: false, error: "internal_error", message: String(err && err.message || err) });
      }
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, function () {
  console.log("[yiwu-ai-circle] listening on http://" + HOST + ":" + PORT + " static=" + STATIC_DIR);
  console.log("[yiwu-ai-circle] payment configured=" + Boolean(WAG_API_KEY && WAG_ENTITLEMENT_ID) + " smsMode=" + SMS_MODE);
});

process.on("SIGTERM", function () {
  server.close(function () {
    process.exit(0);
  });
});
