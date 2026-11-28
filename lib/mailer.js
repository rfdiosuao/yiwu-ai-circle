"use strict";

/**
 * 发邮件：最小的 SMTP 客户端，不依赖第三方包。
 *
 * 配置（环境变量或 secrets.json）：
 *   SMTP_HOST    发信服务器，如 smtp.qq.com、smtp.exmail.qq.com、smtp.163.com、smtpdm.aliyun.com
 *   SMTP_PORT    端口，默认 465
 *   SMTP_SECURE  ssl（465 默认）/ starttls（其他端口默认）/ none（只用于本机测试，生产环境拒绝启动）
 *   SMTP_USER    登录账号（通常就是发信邮箱）
 *   SMTP_PASS    密码或邮箱后台生成的「授权码」
 *   SMTP_FROM    发件人，如 "义乌AI圈 <invite@example.com>"；留空用 SMTP_USER
 *
 * send({ to, subject, text, html, inline: { cid, filename, contentType, content(Buffer) } }) → Promise
 */

const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");

const TIMEOUT_MS = 20000;

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }

/* 邮件头里的中文按 RFC 2047 编码，每段不超过 75 个字符 */
function encodeWord(s) {
  s = String(s == null ? "" : s);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts = [];
  let chunk = "";
  for (const ch of Array.from(s)) {
    if (Buffer.byteLength(chunk + ch) > 42) { parts.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  return parts.map(function (p) { return "=?UTF-8?B?" + b64(p) + "?="; }).join("\r\n ");
}

/* "义乌AI圈 <a@b.com>" → { name, address } */
function parseAddress(v) {
  const s = String(v || "").trim();
  const m = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(s);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), address: m[2] };
  return { name: "", address: s };
}

function formatAddress(a) {
  return a.name ? encodeWord(a.name) + " <" + a.address + ">" : a.address;
}

function wrap76(base64) {
  return base64.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

function part(contentType, body, extra) {
  return "Content-Type: " + contentType + "\r\nContent-Transfer-Encoding: base64\r\n" + (extra || "") + "\r\n" +
    wrap76(Buffer.isBuffer(body) ? body.toString("base64") : b64(body)) + "\r\n";
}

function multipart(type, parts) {
  const boundary = "=_ywai_" + crypto.randomBytes(12).toString("hex");
  return {
    header: "Content-Type: multipart/" + type + '; boundary="' + boundary + '"',
    body: parts.map(function (p) { return "--" + boundary + "\r\n" + p; }).join("\r\n") + "\r\n--" + boundary + "--\r\n"
  };
}

/* 拼一封 MIME 邮件：纯文本 + HTML，可带一张内嵌图片（HTML 里用 cid: 引用） */
function buildMessage(from, msg) {
  const alt = multipart("alternative", [
    part("text/plain; charset=UTF-8", msg.text || ""),
    part("text/html; charset=UTF-8", msg.html || "")
  ]);
  let top = alt;
  if (msg.inline) {
    const name = encodeWord(msg.inline.filename || "image.jpg");
    top = multipart("related", [
      alt.header + "\r\n\r\n" + alt.body,
      part(msg.inline.contentType || "image/jpeg", msg.inline.content,
        "Content-ID: <" + msg.inline.cid + ">\r\nContent-Disposition: inline; filename=\"" + name + "\"\r\n")
    ]);
  }
  const domain = (from.address.split("@")[1] || "localhost").replace(/[^A-Za-z0-9.-]/g, "");
  const headers = [
    "From: " + formatAddress(from),
    "To: " + msg.to,
    "Subject: " + encodeWord(msg.subject),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + crypto.randomBytes(12).toString("hex") + "@" + domain + ">",
    "MIME-Version: 1.0",
    top.header
  ];
  return headers.join("\r\n") + "\r\n\r\n" + top.body;
}

/* 逐条读取 SMTP 应答（多行应答以「代码+空格」那一行结束） */
function reader(sock) {
  let buf = "";
  let lines = [];
  let pending = null;
  let failed = null;
  const queue = [];
  function onData(chunk) {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const resp = { code: Number(line.slice(0, 3)), text: lines.join("\n") };
        lines = [];
        if (pending) { const p = pending; pending = null; p.resolve(resp); } else queue.push(resp);
      }
    }
  }
  function onFail(err) {
    failed = failed || err || new Error("发信服务器断开了连接");
    if (pending) { const p = pending; pending = null; p.reject(failed); }
  }
  function onClose() { onFail(new Error("发信服务器断开了连接")); }
  sock.on("data", onData);
  sock.on("error", onFail);
  sock.on("close", onClose);
  return {
    read: function () {
      if (queue.length) return Promise.resolve(queue.shift());
      if (failed) return Promise.reject(failed);
      return new Promise(function (resolve, reject) { pending = { resolve: resolve, reject: reject }; });
    },
    detach: function () {
      sock.removeListener("data", onData);
      sock.removeListener("error", onFail);
      sock.removeListener("close", onClose);
    }
  };
}

function createMailer(cfg) {
  const host = String(cfg.host || "").trim();
  const port = Number(cfg.port) || 465;
  const secure = String(cfg.secure || (port === 465 ? "ssl" : "starttls")).toLowerCase();
  const user = String(cfg.user || "").trim();
  const pass = String(cfg.pass || "");
  const from = parseAddress(cfg.from || user);
  const configured = Boolean(host && /@/.test(from.address));

  function problems(isProduction) {
    if (!host) return [];
    const out = [];
    if (["ssl", "starttls", "none"].indexOf(secure) < 0) out.push("SMTP_SECURE (ssl / starttls / none)");
    if (isProduction && secure === "none") out.push("SMTP_SECURE=ssl or starttls");
    if (!/@/.test(from.address)) out.push("SMTP_FROM or SMTP_USER (an email address)");
    return out;
  }

  function open() {
    return new Promise(function (resolve, reject) {
      const sock = secure === "ssl"
        ? tls.connect({ host: host, port: port, servername: host })
        : net.connect({ host: host, port: port });
      sock.setTimeout(TIMEOUT_MS, function () { sock.destroy(new Error("连接发信服务器超时")); });
      sock.once(secure === "ssl" ? "secureConnect" : "connect", function () { resolve(sock); });
      sock.once("error", reject);
    });
  }

  function upgrade(raw) {
    return new Promise(function (resolve, reject) {
      const sock = tls.connect({ socket: raw, servername: host }, function () { resolve(sock); });
      sock.setTimeout(TIMEOUT_MS, function () { sock.destroy(new Error("连接发信服务器超时")); });
      sock.once("error", reject);
    });
  }

  async function send(msg) {
    if (!configured) throw new Error("还没有配置发信邮箱");
    const to = parseAddress(msg.to).address;
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(to)) throw new Error("收件地址不正确");
    let sock = await open();
    let io = reader(sock);
    /* label 是出错时显示的步骤名；登录那几步传 "AUTH"，错误信息里不会带出账号密码 */
    async function expect(codes, line, label) {
      if (line !== undefined) sock.write(line + "\r\n");
      const r = await io.read();
      if (codes.indexOf(r.code) < 0) {
        const step = label || (line ? line.split(/[ :]/)[0] : "连接");
        throw new Error("发信服务器拒绝（" + step + "）：" + r.text.slice(0, 160));
      }
      return r;
    }
    try {
      await expect([220]);
      const name = "ywai.local";
      let caps = (await expect([250], "EHLO " + name)).text;
      if (secure === "starttls") {
        if (!/STARTTLS/i.test(caps)) throw new Error("发信服务器不支持 STARTTLS，请改用 465 端口");
        await expect([220], "STARTTLS");
        io.detach();
        sock = await upgrade(sock);
        io = reader(sock);
        caps = (await expect([250], "EHLO " + name)).text;
      }
      if (user) {
        if (/AUTH[ =][^\n]*PLAIN/i.test(caps)) {
          await expect([235], "AUTH PLAIN " + b64("\u0000" + user + "\u0000" + pass), "AUTH");
        } else {
          await expect([334], "AUTH LOGIN", "AUTH");
          await expect([334], b64(user), "AUTH");
          await expect([235], b64(pass), "AUTH");
        }
      }
      await expect([250], "MAIL FROM:<" + from.address + ">");
      await expect([250, 251], "RCPT TO:<" + to + ">");
      await expect([354], "DATA");
      const data = buildMessage(from, Object.assign({}, msg, { to: to })).replace(/\r\n\./g, "\r\n..");
      sock.write(data + "\r\n.\r\n");
      await expect([250]);
      sock.write("QUIT\r\n");
    } finally {
      setTimeout(function () { sock.destroy(); }, 200).unref();
    }
  }

  return { configured: configured, secure: secure, problems: problems, send: send, from: from.address };
}

module.exports = { createMailer: createMailer, buildMessage: buildMessage, encodeWord: encodeWord };
