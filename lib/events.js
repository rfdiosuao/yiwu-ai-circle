"use strict";

/**
 * 活动报名与客资
 *
 * - 运营在后台建活动：标题、时间地点、海报、背景音乐、收集哪些项、截止时间与名额。
 * - 访客扫码打开 /e/<slug>，无需登录即可报名；同一活动同一手机号只保留一条（以最后一次为准）。
 * - 已登录的会员不用填表：手机号用账号里验证过的那个，称呼 / 邮箱 / 公司取上次报名留下的资料
 *  （没有就用昵称和商家认证的店名），报名后把这次填的存回账号，下次直接「一键报名」。
 * - 报名记录即客资：后台按活动查看、标记跟进状态、写备注、导出 CSV。
 * - 海报与音乐存放在 DATA_DIR/uploads，经 /uploads/<文件名> 访问（音频支持 Range，iOS 才能播放）。
 * - 每场活动可写主办方和组织单位（身份名称自己填：指导单位、协办单位、赞助方……）、流程安排、活动议题、温馨提示。
 * - 报名表可以收邮箱：报名成功后把这场活动的邀请函（后台生成好的图片）发到报名人邮箱，邮件正文写「尊敬的 + 称呼」。
 *   需要配置 SMTP（见 lib/mailer.js）；没配置就只报名、不发信。
 * - /e/<slug>?invite=letter 是邀请函图片的在线版，/e/<slug>?poster=1 是用来转发的「活动长图海报」。
 *   图片都在浏览器里画；发邮件用的那张由后台保存活动时生成并上传（PUT …/invite-image）。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const qrcode = require("./qrcode");

const FIELD_KEYS = ["name", "email", "company", "project"];
const FIELD_MAX = { name: 40, email: 80, company: 40, project: 200 };
const EMAIL = /^[^\s@<>()",;:\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
const FIELD_MODES = ["off", "optional", "required"];
const EVENT_STATUS = ["draft", "open", "closed"];
const LEAD_STATUS = ["new", "contacted", "won", "lost"];
const LEAD_STATUS_LABEL = { new: "待联系", contacted: "已联系", won: "已成交", lost: "无意向" };
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const UPLOAD_NAME = /^\/uploads\/([a-f0-9]{24})\.(jpg|png|webp|mp3|m4a|ogg)$/;
const UPLOAD_TYPES = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg"
};
const LIMITS = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024 };
const INVITE_STYLES = ["crimson", "ink", "poster", "tech"];
/* 旧数据里组织单位是 { sponsors, partners, supporters }，读的时候换成带身份名称的分组 */
const LEGACY_ORGS = [["sponsors", "赞助方"], ["partners", "合作方"], ["supporters", "支持方"]];
/* 主办方默认留空：报名页、海报和邀请函上不出现平台名称，由后台按活动填写 */
const DEFAULT_HOST = "";
const MAX_ORG_GROUPS = 8;
const MAX_AGENDA = 16;
const MAX_TALKS = 12;
const MAX_LOGOS = 6;
const VISUAL_AT = ["top", "bottom"];
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* 「赞助方」等名单：后台可以传数组，也可以传用顿号 / 逗号 / 换行隔开的一段文字 */
function nameList(v) {
  const raw = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[\n,，、;；|]+/);
  const out = [];
  for (const item of raw) {
    const s = String(item == null ? "" : item).trim().slice(0, 30);
    if (s && out.indexOf(s) < 0) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/*
 * 邀请函设置：message 是信的正文；greeting 是不写访客称呼时的抬头（如「各位行业家人们」）；
 * signature / date 是落款和落款日期，留空时用主办方和生成当天。
 */
function inviteOf(ev) {
  const i = (ev && ev.invite) || {};
  const text = function (v) { return typeof v === "string" ? v : ""; };
  return {
    enabled: i.enabled !== false,
    style: INVITE_STYLES.indexOf(i.style) >= 0 ? i.style : "crimson",
    message: text(i.message),
    greeting: text(i.greeting),
    signature: text(i.signature),
    date: LOCAL_DATE.test(text(i.date)) ? i.date : ""
  };
}

/*
 * 组织单位：[{ label: "指导单位", names: ["…"] }, …]，按后台填写的顺序排。
 * 身份名称自己填（指导单位 / 协办单位 / 赞助方……），没有名单的分组不保存。
 * 也接受旧格式 { sponsors, partners, supporters }。
 */
function orgGroups(v) {
  let list = v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    list = LEGACY_ORGS.map(function (k) { return { label: k[1], names: v[k[0]] }; });
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    const names = nameList(g.names);
    if (!names.length) continue;
    out.push({ label: String(g.label == null ? "" : g.label).trim().slice(0, 8) || "支持单位", names: names });
    if (out.length >= MAX_ORG_GROUPS) break;
  }
  return out;
}

function orgsOf(ev) {
  return orgGroups(ev && ev.orgs);
}

function logoIds(ev) {
  return Array.isArray(ev && ev.logos) ? ev.logos.slice(0, MAX_LOGOS) : [];
}

/* 流程安排：[{ time: "13:30-14:00", item: "签到" }]，没写内容的行丢掉 */
function agendaList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const item = String(r.item == null ? "" : r.item).trim().slice(0, 50);
    if (!item) continue;
    out.push({ time: String(r.time == null ? "" : r.time).trim().slice(0, 20), item: item });
    if (out.length >= MAX_AGENDA) break;
  }
  return out;
}

/* 活动议题：[{ title, speaker, role }]，没写题目的行丢掉 */
function talkList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const title = String(r.title == null ? "" : r.title).trim().replace(/^[《「]+|[》」]+$/g, "").slice(0, 40);
    if (!title) continue;
    out.push({
      title: title,
      speaker: String(r.speaker == null ? "" : r.speaker).trim().slice(0, 20),
      role: String(r.role == null ? "" : r.role).trim().slice(0, 40)
    });
    if (out.length >= MAX_TALKS) break;
  }
  return out;
}

const qrCache = new Map();
/* 二维码点阵，每行一串 0/1；邀请函上的码在浏览器里按点阵画，不依赖图片跨域 */
function qrRows(url) {
  let rows = qrCache.get(url);
  if (!rows) {
    rows = qrcode.encode(url, { ecl: "M" }).modules.map(function (r) { return r.map(function (d) { return d ? "1" : "0"; }).join(""); });
    if (qrCache.size >= 200) qrCache.clear();
    qrCache.set(url, rows);
  }
  return rows;
}

/* 按文件头判断真实类型，不信任文件名和前端声明 */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", kind: "image" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", kind: "image" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", kind: "image" };
  if (buf.toString("ascii", 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: "mp3", kind: "audio" };
  if (buf.toString("ascii", 4, 8) === "ftyp") return { ext: "m4a", kind: "audio" };
  if (buf.toString("ascii", 0, 4) === "OggS") return { ext: "ogg", kind: "audio" };
  return null;
}

function hasText(key) {
  return function (r) { return r && typeof r === "object" && String(r[key] == null ? "" : r[key]).trim() !== ""; };
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* 2026-12-09T14:00（+ 结束时间）→ 2026年12月9日（周三）14:00-17:30 */
function fmtEventTime(start, end) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(start || "");
  if (!m) return "";
  const week = "日一二三四五六".charAt(new Date(start + ":00Z").getUTCDay());
  let out = Number(m[1]) + "年" + Number(m[2]) + "月" + Number(m[3]) + "日（周" + week + "）" + m[4];
  const e = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(end || "");
  if (e) out += e[1] === start.slice(0, 10) ? "-" + e[2] : " 至 " + fmtEventTime(end).replace(/^\d{4}年/, "");
  return out;
}

function localTime(v) {
  const s = String(v || "").trim();
  if (!LOCAL_TIME.test(s)) return "";
  const date = new Date(s + ":00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === s ? s : "";
}

function eventTime(value) {
  const valid = localTime(value);
  return valid ? Date.parse(valid + ":00+08:00") : Infinity;
}

function receiptDigest(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? crypto.createHash("sha256").update(value).digest("hex") : "";
}

function adminLead(lead) {
  const { receiptHash, ...visible } = lead;
  return visible;
}

function signupSummary(lead) {
  return { name: lead.name || "" };
}

function csvCell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* 防止在 Excel 里被当成公式执行 */
  return '"' + s.replace(/"/g, '""') + '"';
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

module.exports = function installEvents(ctx) {
  const { route, db, store, sendJSON, fail, withBody, isAdmin, audit, rateLimited, clientIp, isValidPhone, str, dataDir, publicBase } = ctx;
  const mailer = ctx.mailer || { configured: false, send: function () { return Promise.reject(new Error("还没有配置发信邮箱")); } };
  const currentUser = ctx.currentUser || function () { return null; };

  /* 会员的报名资料：上次报名留下的 > 商家认证的联系人、店名 / 自己改过的昵称。
     注册时自动起的「义乌新朋友1234」不算称呼，不然邀请函邮件会写「尊敬的义乌新朋友1234」 */
  function memberContact(user) {
    const saved = user.eventContact || {};
    const app = db().applications && db().applications[user.id];
    const nick = /^义乌新朋友\d{4}$/.test(user.nickname || "") ? "" : user.nickname || "";
    return {
      name: saved.name || (app && app.contactName) || nick,
      email: saved.email || "",
      company: saved.company || (app && app.shopName) || ""
    };
  }

  function maskPhone(phone) {
    return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
  }
  const uploadDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  const d = db();
  if (!d.events || typeof d.events !== "object") d.events = {};
  if (!Array.isArray(d.leads)) d.leads = [];
  if (!d.uploads || typeof d.uploads !== "object") d.uploads = {};
  store.save();

  const events = function () { return db().events; };
  const leads = function () { return db().leads; };

  function uploadUrl(id) {
    const u = id && db().uploads[id];
    return u ? "/uploads/" + u.id + "." + u.ext : "";
  }

  function findBySlug(slug) {
    const all = events();
    return Object.keys(all).map(function (k) { return all[k]; }).find(function (e) { return e.slug === slug; }) || null;
  }

  function leadCount(eventId) {
    return leads().filter(function (l) { return l.eventId === eventId; }).length;
  }

  /* 当前能否报名，以及不能的原因 */
  function eventState(ev) {
    if (ev.status === "draft") return "draft";
    if (ev.status === "closed") return "closed";
    if (ev.deadline && Date.now() >= eventTime(ev.deadline)) return "deadline";
    if (ev.capacity > 0 && leadCount(ev.id) >= ev.capacity) return "full";
    return "open";
  }

  /*
   * 报名页需要的全部公开信息。qr 是报名链接的二维码点阵：专属邀请函和「活动长图海报」都画在浏览器里，
   * 不依赖跨域图片；关掉邀请函时海报照样要用，所以放在外层。
   */
  function publicEvent(ev, req) {
    const invite = inviteOf(ev);
    const url = publicBase(req) + "/e/" + ev.slug;
    return Object.assign(publicSummary(ev), {
      intro: ev.intro,
      musicUrl: uploadUrl(ev.music),
      visualUrl: uploadUrl(ev.visual),
      visualAt: VISUAL_AT.indexOf(ev.visualAt) >= 0 ? ev.visualAt : "top",
      logoUrls: logoIds(ev).map(uploadUrl).filter(Boolean),
      agenda: agendaList(ev.agenda),
      talks: talkList(ev.talks),
      notice: ev.notice || "",
      contact: ev.contact || "",
      slogan: ev.slogan || "",
      capacity: ev.capacity || 0,
      fields: ev.fields,
      url: url,
      qr: qrRows(url),
      invite: invite.enabled ? {
        style: invite.style, message: invite.message, greeting: invite.greeting, signature: invite.signature, date: invite.date
      } : null,
      /* 报名后会不会把邀请函发到邮箱：开了邀请函、配置了发信邮箱、收集邮箱 */
      mailInvite: Boolean(invite.enabled && mailer.configured && ev.fields && ev.fields.email && ev.fields.email !== "off")
    });
  }

  /* 活动列表里每场活动的公开信息（不含报名人数和内部 id） */
  function publicSummary(ev) {
    return {
      slug: ev.slug,
      title: ev.title,
      subtitle: ev.subtitle,
      startAt: ev.startAt,
      endAt: ev.endAt || "",
      place: ev.place,
      posterUrl: uploadUrl(ev.poster),
      deadline: ev.deadline,
      host: ev.host === undefined ? DEFAULT_HOST : ev.host,
      orgs: orgsOf(ev),
      state: eventState(ev)
    };
  }

  function adminEvent(ev, req) {
    const own = leads().filter(function (l) { return l.eventId === ev.id; });
    return Object.assign({}, ev, {
      host: ev.host === undefined ? DEFAULT_HOST : ev.host,
      endAt: ev.endAt || "",
      orgs: orgsOf(ev),
      agenda: agendaList(ev.agenda),
      talks: talkList(ev.talks),
      notice: ev.notice || "",
      invite: inviteOf(ev),
      posterUrl: uploadUrl(ev.poster),
      visualUrl: uploadUrl(ev.visual),
      visualAt: VISUAL_AT.indexOf(ev.visualAt) >= 0 ? ev.visualAt : "top",
      logos: logoIds(ev).map(function (id) { return { id: id, url: uploadUrl(id) }; }).filter(function (l) { return l.url; }),
      contact: ev.contact || "",
      slogan: ev.slogan || "",
      musicUrl: uploadUrl(ev.music),
      inviteImageUrl: uploadUrl(ev.inviteImage),
      inviteImageAt: ev.inviteImageAt || 0,
      url: publicBase(req) + "/e/" + ev.slug,
      state: eventState(ev),
      leads: own.length,
      newLeads: own.filter(function (l) { return l.status === "new"; }).length
    });
  }

  /* 校验并合并后台提交的活动字段；返回错误文案或空字符串 */
  function applyEvent(ev, body, isNew) {
    if (isNew || body.title !== undefined) {
      const title = str(body.title, 60);
      if (title.length < 2 || title.length > 40) return "活动标题 2–40 个字";
      ev.title = title;
    }
    if (body.subtitle !== undefined) ev.subtitle = str(body.subtitle, 80);
    if (body.place !== undefined) ev.place = str(body.place, 60);
    if (body.intro !== undefined) ev.intro = str(body.intro, 300);
    if (body.startAt !== undefined) {
      if (body.startAt && !localTime(body.startAt)) return "活动时间格式不正确";
      ev.startAt = localTime(body.startAt);
    }
    if (body.endAt !== undefined) {
      if (body.endAt && !localTime(body.endAt)) return "结束时间格式不正确";
      ev.endAt = localTime(body.endAt);
    }
    if (ev.endAt && (!ev.startAt || eventTime(ev.endAt) <= eventTime(ev.startAt))) {
      return ev.startAt ? "结束时间要晚于开始时间" : "填了结束时间，也请填写活动开始时间";
    }
    if (body.deadline !== undefined) {
      if (body.deadline && !localTime(body.deadline)) return "截止时间格式不正确";
      ev.deadline = localTime(body.deadline);
    }
    if (body.agenda !== undefined) {
      if (body.agenda && !Array.isArray(body.agenda)) return "流程安排格式不正确";
      if (Array.isArray(body.agenda) && agendaList(body.agenda).length < body.agenda.filter(hasText("item")).length) return "流程安排最多 " + MAX_AGENDA + " 行";
      ev.agenda = agendaList(body.agenda);
    }
    if (body.talks !== undefined) {
      if (body.talks && !Array.isArray(body.talks)) return "活动议题格式不正确";
      if (Array.isArray(body.talks) && talkList(body.talks).length < body.talks.filter(hasText("title")).length) return "活动议题最多 " + MAX_TALKS + " 个";
      ev.talks = talkList(body.talks);
    }
    if (body.notice !== undefined) {
      const notice = str(body.notice, 300);
      if (notice.length > 200) return "温馨提示最多 200 个字";
      ev.notice = notice;
    }
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 0 || cap > 100000) return "名额需为 0–100000 的整数（0 表示不限）";
      ev.capacity = cap;
    }
    if (body.status !== undefined) {
      if (EVENT_STATUS.indexOf(body.status) < 0) return "活动状态不正确";
      ev.status = body.status;
    }
    if (body.slug !== undefined && body.slug !== ev.slug) {
      const slug = str(body.slug, 40).toLowerCase();
      if (!SLUG.test(slug)) return "链接后缀只能用小写字母、数字和减号，2–40 位";
      const other = findBySlug(slug);
      if (other && other.id !== ev.id) return "这个链接后缀已经被其他活动使用";
      ev.slug = slug;
    }
    const UPLOAD_FIELDS = { poster: ["image", "海报需要是图片"], visual: ["image", "主视觉需要是图片"], music: ["audio", "背景音乐需要是音频"] };
    for (const key of Object.keys(UPLOAD_FIELDS)) {
      if (body[key] === undefined) continue;
      const id = str(body[key], 40);
      if (id && !db().uploads[id]) return "上传的文件不存在，请重新上传";
      if (id && db().uploads[id].kind !== UPLOAD_FIELDS[key][0]) return UPLOAD_FIELDS[key][1];
      ev[key] = id;
    }
    if (body.logos !== undefined) {
      if (!Array.isArray(body.logos)) return "Logo 列表格式不正确";
      const ids = [];
      for (const raw of body.logos) {
        const id = str(raw, 40);
        if (!id || ids.indexOf(id) >= 0) continue;
        if (!db().uploads[id]) return "上传的 Logo 不存在，请重新上传";
        if (db().uploads[id].kind !== "image") return "Logo 需要是图片";
        ids.push(id);
      }
      if (ids.length > MAX_LOGOS) return "顶部 Logo 最多 " + MAX_LOGOS + " 个";
      ev.logos = ids;
    }
    if (body.visualAt !== undefined) {
      if (VISUAL_AT.indexOf(body.visualAt) < 0) return "主视觉位置不正确";
      ev.visualAt = body.visualAt;
    }
    if (body.contact !== undefined) {
      const contact = str(body.contact, 60);
      if (contact.length > 40) return "报名咨询最多 40 个字";
      ev.contact = contact;
    }
    if (body.slogan !== undefined) {
      const slogan = str(body.slogan, 60);
      if (slogan.length > 30) return "底部标语最多 30 个字";
      ev.slogan = slogan;
    }
    if (body.host !== undefined) ev.host = str(body.host, 30);
    if (body.orgs !== undefined) {
      if (Array.isArray(body.orgs) && orgGroups(body.orgs).length < body.orgs.filter(function (g) { return g && nameList(g.names).length; }).length) {
        return "组织单位最多 " + MAX_ORG_GROUPS + " 类";
      }
      ev.orgs = orgGroups(body.orgs);
    }
    if (body.invite !== undefined) {
      const i = body.invite && typeof body.invite === "object" ? body.invite : {};
      const cur = inviteOf(ev);
      if (i.style !== undefined && INVITE_STYLES.indexOf(i.style) < 0) return "邀请函样式不正确";
      const message = i.message === undefined ? cur.message : str(i.message, 800);
      if (message.length > 600) return "邀请函正文最多 600 个字";
      const greeting = i.greeting === undefined ? cur.greeting : str(i.greeting, 40);
      if (greeting.length > 20) return "邀请函抬头最多 20 个字";
      const signature = i.signature === undefined ? cur.signature : str(i.signature, 60);
      if (signature.length > 40) return "落款最多 40 个字";
      const date = i.date === undefined ? cur.date : str(i.date, 20);
      if (date && (!LOCAL_DATE.test(date) || isNaN(new Date(date).getTime()))) return "落款日期格式不正确";
      ev.invite = {
        enabled: i.enabled === undefined ? cur.enabled : i.enabled !== false,
        style: i.style === undefined ? cur.style : i.style,
        message: message,
        greeting: greeting,
        signature: signature,
        date: date
      };
    }
    if (body.fields !== undefined) {
      const f = body.fields && typeof body.fields === "object" ? body.fields : {};
      const next = {};
      for (const key of FIELD_KEYS) next[key] = FIELD_MODES.indexOf(f[key]) >= 0 ? f[key] : "optional";
      ev.fields = next;
    }
    ev.updatedAt = Date.now();
    return "";
  }

  function newSlug() {
    let slug;
    do { slug = crypto.randomBytes(4).toString("hex").slice(0, 6); } while (findBySlug(slug));
    return slug;
  }

  /* ------------------------------------------------------------ 公开接口 */

  route("GET", /^\/api\/events\/([a-z0-9-]{1,40})$/, function (req, res, m) {
    const ev = findBySlug(m[1]);
    if (!ev || (ev.status === "draft" && !isAdmin(req))) return fail(res, 404, "not_found", "活动不存在或尚未发布");
    sendJSON(res, 200, { ok: true, event: publicEvent(ev, req) });
  });

  /* 当前登录会员在这场活动的报名资料；没登录返回 member: null（不报 401，页面上不出错误） */
  route("GET", /^\/api\/events\/([a-z0-9-]{1,40})\/me$/, function (req, res, m) {
    const ev = findBySlug(m[1]);
    if (!ev || (ev.status === "draft" && !isAdmin(req))) return fail(res, 404, "not_found", "活动不存在或尚未发布");
    const user = currentUser(req);
    if (!user) return sendJSON(res, 200, { ok: true, member: null });
    const lead = leads().find(function (l) { return l.eventId === ev.id && l.phone === user.phone; });
    sendJSON(res, 200, {
      ok: true,
      member: Object.assign({ phone: maskPhone(user.phone) }, memberContact(user)),
      lead: lead ? { name: lead.name || "", email: lead.email || "", company: lead.company || "", project: lead.project || "" } : null
    });
  });

  route("POST", /^\/api\/events\/([a-z0-9-]{1,40})\/registration$/, { limit: 1024 }, async function (req, res, m) {
    if (rateLimited("ev-lookup:" + clientIp(req), 120, 60e3)) return fail(res, 429, "too_frequent", "请稍后再试");
    const body = await withBody(req, res, 1024);
    if (!body) return;
    const ev = findBySlug(m[1]);
    if (!ev || ev.status === "draft") return fail(res, 404, "not_found", "活动不存在或尚未发布");
    const hash = receiptDigest(body.receipt);
    const lead = hash && leads().find(l => l.eventId === ev.id && l.receiptHash === hash);
    sendJSON(res, 200, { ok: true, registration: lead ? signupSummary(lead) : null });
  });

  /* 前台「活动」板块：未开始的按时间先后，已结束的排在后面 */
  route("GET", "/api/events", function (req, res) {
    const all = events();
    const now = Date.now();
    const list = Object.keys(all).map(function (k) { return all[k]; }).filter(function (e) { return e.status !== "draft"; });
    const time = function (e) { return eventTime(e.startAt); };
    /* 写了结束时间按结束时间算，没写的开始 6 小时后算结束 */
    const isPast = function (e) {
      if (e.status === "closed") return true;
      return e.endAt ? eventTime(e.endAt) <= now : time(e) < now - 6 * 3600e3;
    };
    const upcoming = list.filter(function (e) { return !isPast(e); }).sort(function (a, b) { return time(a) - time(b); });
    const past = list.filter(isPast).sort(function (a, b) { return (time(b) === Infinity ? 0 : time(b)) - (time(a) === Infinity ? 0 : time(a)); });
    sendJSON(res, 200, {
      ok: true,
      upcoming: upcoming.slice(0, 30).map(publicSummary),
      past: past.slice(0, 30).map(publicSummary)
    });
  });

  route("POST", /^\/api\/events\/([a-z0-9-]{1,40})\/register$/, async function (req, res, m) {
    if (rateLimited("ev-ip:" + clientIp(req), 20, 3600e3)) return fail(res, 429, "too_frequent", "提交太频繁了，请稍后再试");
    const body = await withBody(req, res);
    if (!body) return;
    const ev = findBySlug(m[1]);
    if (!ev || ev.status === "draft") return fail(res, 404, "not_found", "活动不存在或尚未发布");

    /* account: true 表示用登录账号报名，手机号取账号里验证过的，不信任前端传的 */
    const member = currentUser(req);
    if (body.account === true && !member) return fail(res, 401, "unauthorized", "登录已过期，请刷新页面后重新报名");
    const phone = body.account === true ? member.phone : str(body.phone, 20).replace(/[\s-]/g, "");
    const errors = {};
    if (!isValidPhone(phone)) errors.phone = "请输入 11 位手机号";
    const values = {};
    for (const key of FIELD_KEYS) {
      /* 旧活动没有「邮箱」这一项的设置，按不收集处理 */
      const mode = (ev.fields && ev.fields[key]) || (key === "email" ? "off" : "optional");
      values[key] = mode === "off" ? "" : str(body[key], FIELD_MAX[key] + 20);
      if (mode === "required" && !values[key]) errors[key] = "请填写这一项";
      else if (values[key].length > FIELD_MAX[key]) errors[key] = "最多 " + FIELD_MAX[key] + " 个字";
    }
    if (values.email && !EMAIL.test(values.email)) errors.email = "邮箱格式不正确";
    if (body.consent !== true) errors.consent = "请先勾选同意";
    if (Object.keys(errors).length) {
      return sendJSON(res, 400, { ok: false, error: "invalid", message: "有几项需要补充", errors: errors });
    }
    if (rateLimited("ev-phone:" + ev.id + ":" + phone, 6, 3600e3)) return fail(res, 429, "too_frequent", "这个手机号提交太频繁了");

    const existing = leads().find(function (l) { return l.eventId === ev.id && l.phone === phone; });
    const state = eventState(ev);
    /* 已报过名的人可以更新资料，即使名额已满 */
    if (state !== "open" && !(existing && state === "full")) {
      const msg = { closed: "活动报名已结束", deadline: "报名已截止", full: "名额已满" }[state] || "暂不能报名";
      return fail(res, 409, "event_" + state, msg);
    }
    const digest = receiptDigest(body.receipt);
    const proved = Boolean(existing && digest && existing.receiptHash === digest);
    if (existing && !proved && member?.phone !== phone) {
      return fail(res, 409, "registration_not_editable", "请使用原报名浏览器、登录同手机号账号，或联系主办方修改");
    }
    if (!existing && leads().length >= 50000) {
      return fail(res, 503, "registration_unavailable", "暂时无法接收新报名，请联系主办方");
    }
    const receipt = proved ? body.receipt : crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    let lead = existing;
    /* 第一次填邮箱、或者换了邮箱才发；同一个邮箱重复提交不再重发 */
    const mailTo = values.email && (!existing || String(existing.email || "").toLowerCase() !== values.email.toLowerCase()) ? values.email : "";
    if (existing) {
      /* 再次提交以最新填写为准，但留空的项不覆盖之前已有的信息 */
      for (const key of FIELD_KEYS) if (values[key]) existing[key] = values[key];
      Object.assign(existing, { updatedAt: now, submits: (existing.submits || 1) + 1, consentAt: now });
    } else {
      leads().unshift(Object.assign({
        id: "ld_" + crypto.randomBytes(8).toString("hex"),
        eventId: ev.id,
        phone: phone,
        status: "new",
        note: "",
        createdAt: now,
        updatedAt: now,
        consentAt: now,
        submits: 1
      }, values));
      lead = leads()[0];

    }
    lead.receiptHash = receiptDigest(receipt);
    /* 会员用自己的手机号报名：把这次填的资料存回账号，下次直接带出来 */
    if (member && member.phone === phone) {
      const c = member.eventContact || {};
      member.eventContact = {
        name: values.name || c.name || "", email: values.email || c.email || "", company: values.company || c.company || "", updatedAt: now
      };
    }
    let mail = "";
    if (mailTo && inviteOf(ev).enabled && mailer.configured) {
      /* 同一个收件地址一天最多 3 封，防止被拿来给别人塞邮件 */
      if (rateLimited("ev-mail:" + mailTo.toLowerCase(), 3, 24 * 3600e3)) {
        lead.mail = { status: "limited", to: mailTo, at: now };
      } else {
        queueInviteMail(lead, mailTo, publicBase(req));
        mail = "queued";
      }
    }
    store.save();
    sendJSON(res, 200, { ok: true, updated: Boolean(existing), mail: mail, receipt, registration: signupSummary(lead) });
  });

  /* ------------------------------------------------------------ 邀请函邮件 */

  /* 邮件正文：称呼 + 报名确认 + 时间地点 + 邀请函图片（没有图片时放邀请函正文）+ 链接 */
  function inviteMail(ev, lead, base) {
    const inv = inviteOf(ev);
    const url = base + "/e/" + ev.slug;
    const hello = lead.name ? "尊敬的" + lead.name + "：" : (inv.greeting || "您好") + "：";
    const time = fmtEventTime(ev.startAt, ev.endAt);
    const rows = [["活动", ev.title], ["时间", time], ["地点", ev.place], ["报名咨询", ev.contact]].filter(function (r) { return r[1]; });
    const upload = ev.inviteImage && db().uploads[ev.inviteImage];
    let image = null;
    if (upload) {
      try {
        image = {
          cid: "invite-" + ev.slug + "@ywai",
          filename: "邀请函-" + ev.title.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24) + "." + upload.ext,
          contentType: UPLOAD_TYPES[upload.ext],
          content: fs.readFileSync(path.join(uploadDir, upload.id + "." + upload.ext))
        };
      } catch (err) { image = null; }
    }
    const letter = String(inv.message || "").split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    const intro = "感谢您报名「" + ev.title + "」，我们已经收到您的报名。" +
      (image ? "随信附上本次活动的邀请函，期待与您现场相见。" : "期待与您现场相见。");
    const text = [hello, "", intro, ""]
      .concat(rows.map(function (r) { return r[0] + "：" + r[1]; }))
      .concat(image ? [] : [""].concat(letter))
      .concat(["", "活动详情：" + url, "在线查看邀请函：" + url + "?invite=letter", "",
        "此邮件由活动报名系统自动发送。如果不是您本人报名，请忽略这封邮件。"]).join("\n");
    const p = 'style="margin:0 0 14px;font-size:15px;line-height:1.8;color:#1f2a44"';
    const html = '<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;background:#ffffff">' +
      '<p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#0b1a5e">' + esc(hello) + "</p>" +
      "<p " + p + ">" + esc(intro) + "</p>" +
      '<table role="presentation" style="border-collapse:collapse;margin:0 0 18px;font-size:14px;color:#1f2a44">' +
      rows.map(function (r) {
        return '<tr><td style="padding:4px 14px 4px 0;color:#5a6a95;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td><td style="padding:4px 0">' + esc(r[1]) + "</td></tr>";
      }).join("") + "</table>" +
      (image
        ? '<img src="cid:' + image.cid + '" alt="' + esc(ev.title) + ' 邀请函" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;margin:0 0 18px">'
        : letter.map(function (l) { return "<p " + p + ">" + esc(l) + "</p>"; }).join("")) +
      '<p style="margin:0 0 22px"><a href="' + esc(url) + '" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#2a5cf0;color:#ffffff;text-decoration:none;font-weight:700">查看活动详情</a>' +
      ' &nbsp;<a href="' + esc(url) + '?invite=letter" style="color:#2a5cf0">在线查看邀请函</a></p>' +
      '<p style="margin:0;font-size:12px;line-height:1.7;color:#8a93ad">此邮件由活动报名系统自动发送。如果不是您本人报名，请忽略这封邮件。</p></div>';
    return { to: lead.mail && lead.mail.to || lead.email, subject: "邀请函｜" + ev.title, text: text, html: html, inline: image };
  }

  let mailBusy = false;
  let mailTimer;

  function scheduleMail() {
    if (mailBusy || !mailer.configured) return;
    clearTimeout(mailTimer);
    let next = Infinity;
    for (const lead of leads()) {
      if (lead.mail?.status === "queued") next = Math.min(next, lead.mail.nextAt || 0);
    }
    if (next !== Infinity) mailTimer = setTimeout(pumpMail, Math.max(next - Date.now(), 250)).unref();
  }

  function queueInviteMail(lead, to, base) {
    lead.mail = { status: "queued", to, at: Date.now(), base, attempts: 0 };
    store.save();
    scheduleMail();
  }

  async function pumpMail() {
    if (mailBusy) return;
    const lead = leads().find(l => l.mail?.status === "queued" && (l.mail.nextAt || 0) <= Date.now());
    if (!lead) { scheduleMail(); return; }
    const job = lead.mail;
    const ev = events()[lead.eventId];
    mailBusy = true;
    try {
      const base = job.base || ctx.configuredPublicBase;
      if (!ev || !job.to || !base) throw new Error("缺少活动、收件人或公开站点地址");
      await mailer.send(inviteMail(ev, lead, base));
      if (lead.mail === job) lead.mail = { status: "sent", to: job.to, at: Date.now() };
    } catch (err) {
      if (lead.mail === job) {
        const attempts = (job.attempts || 0) + 1;
        const error = String(err && err.message || err).slice(0, 200);
        lead.mail = attempts < 3
          ? { ...job, attempts, nextAt: Date.now() + attempts * 30e3, error }
          : { status: "failed", to: job.to, at: Date.now(), error };
      }
    } finally {
      store.save();
      mailBusy = false;
      scheduleMail();
    }
  }

  scheduleMail();

  /* ------------------------------------------------------------ 后台：上传 */

  route("POST", "/api/admin/uploads", { limit: 15 * 1024 * 1024 }, async function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const body = await withBody(req, res, 15 * 1024 * 1024);
    if (!body) return;
    const b64 = String(body.data || "").replace(/^data:[^,]*,/, "");
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return fail(res, 400, "invalid_file", "文件内容不正确");
    const buf = Buffer.from(b64, "base64");
    const type = sniff(buf);
    if (!type) return fail(res, 415, "unsupported_file", "只支持 JPG / PNG / WebP 图片和 MP3 / M4A / OGG 音频");
    if (body.kind && body.kind !== type.kind) return fail(res, 415, "wrong_kind", body.kind === "image" ? "请上传图片" : "请上传音频");
    if (buf.length > LIMITS[type.kind]) return fail(res, 413, "too_large", type.kind === "image" ? "图片不能超过 5MB" : "音频不能超过 10MB");
    const id = crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(path.join(uploadDir, id + "." + type.ext), buf);
    db().uploads[id] = { id: id, ext: type.ext, kind: type.kind, size: buf.length, name: str(body.name, 80), createdAt: Date.now() };
    store.save();
    audit(req, "上传文件", (type.kind === "image" ? "图片 " : "音频 ") + (str(body.name, 80) || id) + "（" + Math.round(buf.length / 1024) + " KB）");
    sendJSON(res, 200, { ok: true, upload: { id: id, kind: type.kind, url: uploadUrl(id), size: buf.length } });
  });

  /* ------------------------------------------------------------ 后台：活动 */

  route("GET", "/api/admin/events", function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const all = events();
    const list = Object.keys(all).map(function (k) { return adminEvent(all[k], req); })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
    sendJSON(res, 200, { ok: true, events: list, mailReady: mailer.configured });
  });

  route("POST", "/api/admin/events", async function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const body = await withBody(req, res);
    if (!body) return;
    const ev = {
      id: "ev_" + crypto.randomBytes(6).toString("hex"),
      slug: newSlug(),
      title: "", subtitle: "", startAt: "", endAt: "", place: "", intro: "",
      poster: "", visual: "", visualAt: "top", logos: [], music: "",
      contact: "", slogan: "",
      host: DEFAULT_HOST,
      orgs: [],
      agenda: [], talks: [], notice: "",
      invite: { enabled: true, style: "crimson", message: "", greeting: "", signature: "", date: "" },
      /* 邀请函抬头要写称呼，所以新活动默认「称呼」必填 */
      fields: { name: "required", email: "optional", company: "optional", project: "optional" },
      deadline: "", capacity: 0, status: "draft",
      createdAt: Date.now(), updatedAt: Date.now()
    };
    const err = applyEvent(ev, body, true);
    if (err) return fail(res, 400, "invalid", err);
    events()[ev.id] = ev;
    store.save();
    audit(req, "新建活动", ev.title + "（/e/" + ev.slug + "）");
    sendJSON(res, 200, { ok: true, event: adminEvent(ev, req) });
  });

  route("PATCH", /^\/api\/admin\/events\/(ev_[a-f0-9]{12})$/, async function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const ev = events()[m[1]];
    if (!ev) return fail(res, 404, "not_found", "活动不存在");
    const body = await withBody(req, res);
    if (!body) return;
    const draft = JSON.parse(JSON.stringify(ev));
    const err = applyEvent(draft, body, false);
    if (err) return fail(res, 400, "invalid", err);
    events()[ev.id] = draft;
    store.save();
    audit(req, "修改活动", draft.title + (ev.status !== draft.status ? "：状态 " + ev.status + " → " + draft.status : ""));
    sendJSON(res, 200, { ok: true, event: adminEvent(draft, req) });
  });

  /* 发邮件用的邀请函图片：后台在浏览器里画好后传上来；换新图时删掉旧图 */
  route("PUT", /^\/api\/admin\/events\/(ev_[a-f0-9]{12})\/invite-image$/, { limit: 15 * 1024 * 1024 }, async function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const ev = events()[m[1]];
    if (!ev) return fail(res, 404, "not_found", "活动不存在");
    const body = await withBody(req, res, 15 * 1024 * 1024);
    if (!body) return;
    const b64 = String(body.data || "").replace(/^data:[^,]*,/, "");
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return fail(res, 400, "invalid_file", "图片内容不正确");
    const buf = Buffer.from(b64, "base64");
    const type = sniff(buf);
    if (!type || type.kind !== "image") return fail(res, 415, "unsupported_file", "邀请函需要是 JPG / PNG 图片");
    if (buf.length > 8 * 1024 * 1024) return fail(res, 413, "too_large", "邀请函图片不能超过 8MB");
    const id = crypto.randomBytes(12).toString("hex");
    fs.writeFileSync(path.join(uploadDir, id + "." + type.ext), buf);
    db().uploads[id] = { id: id, ext: type.ext, kind: "image", size: buf.length, name: "invite-" + ev.slug + "." + type.ext, createdAt: Date.now() };
    const old = ev.inviteImage && db().uploads[ev.inviteImage];
    if (old) {
      try { fs.unlinkSync(path.join(uploadDir, old.id + "." + old.ext)); } catch (err) { /* 文件已经不在 */ }
      delete db().uploads[old.id];
    }
    ev.inviteImage = id;
    ev.inviteImageAt = Date.now();
    store.save();
    audit(req, "更新邮件邀请函", ev.title + "（" + Math.round(buf.length / 1024) + " KB）");
    sendJSON(res, 200, { ok: true, event: adminEvent(ev, req) });
  });

  route("DELETE", /^\/api\/admin\/events\/(ev_[a-f0-9]{12})$/, function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const ev = events()[m[1]];
    if (!ev) return fail(res, 404, "not_found", "活动不存在");
    const n = leadCount(ev.id);
    if (n) return fail(res, 409, "has_leads", "这个活动已有 " + n + " 条报名，不能删除。可以把状态改为「已结束」，或先导出并删除客资");
    delete events()[ev.id];
    store.save();
    audit(req, "删除活动", ev.title);
    sendJSON(res, 200, { ok: true });
  });

  route("GET", /^\/api\/admin\/events\/(ev_[a-f0-9]{12})\/qr\.svg$/, function (req, res, m, url) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const ev = events()[m[1]];
    if (!ev) return fail(res, 404, "not_found", "活动不存在");
    const svg = qrcode.toSvg(qrcode.encode(publicBase(req) + "/e/" + ev.slug, { ecl: "M" }), { px: 1024 });
    const headers = { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" };
    if (url.searchParams.get("download")) headers["Content-Disposition"] = 'attachment; filename="event-' + ev.slug + '-qr.svg"';
    res.writeHead(200, headers);
    res.end(svg);
  });

  /* ------------------------------------------------------------ 后台：客资 */

  function filteredLeads(url) {
    const eventId = url.searchParams.get("event") || "";
    const status = url.searchParams.get("status") || "";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const all = events();
    return leads().filter(function (l) {
      if (eventId && l.eventId !== eventId) return false;
      if (status && l.status !== status) return false;
      if (q && [l.name, l.phone, l.email, l.company, l.project, l.note].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (l) {
      return Object.assign(adminLead(l), { eventTitle: all[l.eventId] ? all[l.eventId].title : "（活动已删除）" });
    });
  }

  route("GET", "/api/admin/leads", function (req, res, m, url) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    sendJSON(res, 200, { ok: true, leads: filteredLeads(url).slice(0, 2000) });
  });

  route("PATCH", /^\/api\/admin\/leads\/(ld_[a-f0-9]{16})$/, async function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const lead = leads().find(function (l) { return l.id === m[1]; });
    if (!lead) return fail(res, 404, "not_found", "客资不存在");
    const body = await withBody(req, res);
    if (!body) return;
    const before = lead.status;
    if (body.status !== undefined) {
      if (LEAD_STATUS.indexOf(body.status) < 0) return fail(res, 400, "invalid", "跟进状态不正确");
      lead.status = body.status;
    }
    if (body.note !== undefined) lead.note = str(body.note, 300);
    lead.updatedAt = Date.now();
    store.save();
    audit(req, "跟进客资", (lead.name || "未留称呼") + "（" + lead.phone.slice(0, 3) + "****" + lead.phone.slice(-4) + "）" +
      (before !== lead.status ? "：" + LEAD_STATUS_LABEL[before] + " → " + LEAD_STATUS_LABEL[lead.status] : "：更新备注"));
    sendJSON(res, 200, { ok: true, lead: adminLead(lead) });
  });

  /* 重发邀请函邮件（换了邮箱、对方说没收到时用） */
  route("POST", /^\/api\/admin\/leads\/(ld_[a-f0-9]{16})\/mail$/, function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const lead = leads().find(function (l) { return l.id === m[1]; });
    if (!lead) return fail(res, 404, "not_found", "客资不存在");
    if (!mailer.configured) return fail(res, 503, "mail_not_configured", "还没有配置发信邮箱（SMTP）");
    if (!lead.email) return fail(res, 400, "no_email", "这条报名没有留邮箱");
    const ev = events()[lead.eventId];
    if (!ev) return fail(res, 404, "not_found", "活动已删除");
    if (lead.mail?.status === "queued" && lead.mail.to === lead.email) {
      return sendJSON(res, 200, { ok: true, lead: adminLead(lead) });
    }
    queueInviteMail(lead, lead.email, publicBase(req));
    audit(req, "重发邀请函", (lead.name || "未留称呼") + "（" + lead.email.replace(/^(.).*(@.*)$/, "$1***$2") + "）");
    sendJSON(res, 200, { ok: true, lead: adminLead(lead) });
  });

  route("DELETE", /^\/api\/admin\/leads\/(ld_[a-f0-9]{16})$/, function (req, res, m) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const idx = leads().findIndex(function (l) { return l.id === m[1]; });
    if (idx < 0) return fail(res, 404, "not_found", "客资不存在");
    const lead = leads()[idx];
    leads().splice(idx, 1);
    store.save();
    audit(req, "删除客资", (lead.name || "未留称呼") + "（" + lead.phone.slice(0, 3) + "****" + lead.phone.slice(-4) + "）");
    sendJSON(res, 200, { ok: true });
  });

  route("GET", "/api/admin/leads.csv", function (req, res, m, url) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const list = filteredLeads(url);
    const MAIL_LABEL = { queued: "发送中", sent: "已发送", failed: "发送失败", limited: "超出当天上限" };
    const rows = [["报名时间", "活动", "称呼", "手机", "邮箱", "公司", "项目 / 需求", "跟进状态", "备注", "提交次数", "邀请函邮件"]];
    list.forEach(function (l) {
      rows.push([fmtTime(l.createdAt), l.eventTitle, l.name, l.phone, l.email, l.company, l.project, LEAD_STATUS_LABEL[l.status] || l.status, l.note, l.submits || 1,
        l.mail ? MAIL_LABEL[l.mail.status] || l.mail.status : ""]);
    });
    const csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    const ev = events()[url.searchParams.get("event") || ""];
    audit(req, "导出客资", (ev ? ev.title : "全部活动") + "，共 " + list.length + " 条");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads-' + (ev ? ev.slug : "all") + "-" + new Date().toISOString().slice(0, 10) + '.csv"',
      "Cache-Control": "no-store"
    });
    res.end(csv);
  });

  /* ------------------------------------------------------------ 上传文件访问 */

  function serveUpload(req, res, pathname) {
    const m = pathname.match(UPLOAD_NAME);
    if (!m || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const upload = db().uploads[m[1]];
    if (!upload || upload.ext !== m[2]) return false;
    const published = Object.values(events()).some(ev => ev.status !== "draft" &&
      ([ev.poster, ev.music, ev.visual].includes(upload.id) || logoIds(ev).includes(upload.id))) ||
      Object.values(db().partners || {}).some(p => p.show !== false && p.logo === upload.id);
    if (!published && !isAdmin(req)) return false;
    const file = path.join(uploadDir, m[1] + "." + m[2]);
    let stat;
    try { stat = fs.statSync(file); } catch (err) { return false; }
    const type = UPLOAD_TYPES[m[2]];
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end) {
        res.writeHead(416, { "Content-Range": "bytes */" + stat.size });
        res.end();
        return true;
      }
      res.writeHead(206, Object.assign(headers, { "Content-Range": "bytes " + start + "-" + end + "/" + stat.size, "Content-Length": end - start + 1 }));
      if (req.method === "HEAD") { res.end(); return true; }
      fs.createReadStream(file, { start: start, end: end }).pipe(res);
      return true;
    }
    res.writeHead(200, Object.assign(headers, { "Content-Length": stat.size }));
    if (req.method === "HEAD") { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  }

  return { serveUpload: serveUpload, uploadUrl: uploadUrl };
};
