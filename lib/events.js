"use strict";

/**
 * 活动报名与客资
 *
 * - 运营在后台建活动：标题、时间地点、海报、背景音乐、收集哪些项、截止时间与名额。
 * - 访客扫码打开 /e/<slug>，无需登录即可报名；同一活动同一手机号只保留一条（以最后一次为准）。
 * - 报名记录即客资：后台按活动查看、标记跟进状态、写备注、导出 CSV。
 * - 海报与音乐存放在 DATA_DIR/uploads，经 /uploads/<文件名> 访问（音频支持 Range，iOS 才能播放）。
 * - 每场活动可写主办方、赞助方、合作方、支持方；报名成功后页面按访客称呼生成专属邀请函（图片在浏览器里画，
 *   服务端只给出样式、邀请语和指向报名页的二维码点阵）。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const qrcode = require("./qrcode");

const FIELD_KEYS = ["name", "company", "project"];
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
const INVITE_STYLES = ["crimson", "ink", "poster"];
const ORG_KEYS = ["sponsors", "partners", "supporters"];
const DEFAULT_HOST = "义乌AI圈";

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

function inviteOf(ev) {
  const i = (ev && ev.invite) || {};
  return {
    enabled: i.enabled !== false,
    style: INVITE_STYLES.indexOf(i.style) >= 0 ? i.style : "crimson",
    message: typeof i.message === "string" ? i.message : ""
  };
}

function orgsOf(ev) {
  const o = (ev && ev.orgs) || {};
  const out = {};
  for (const key of ORG_KEYS) out[key] = Array.isArray(o[key]) ? o[key].slice(0, 12) : [];
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

function localTime(v) {
  const s = String(v || "").trim();
  return LOCAL_TIME.test(s) && !isNaN(new Date(s).getTime()) ? s : "";
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
    if (ev.deadline && Date.now() > new Date(ev.deadline).getTime()) return "deadline";
    if (ev.capacity > 0 && leadCount(ev.id) >= ev.capacity) return "full";
    return "open";
  }

  function publicEvent(ev, req) {
    const invite = inviteOf(ev);
    const url = publicBase(req) + "/e/" + ev.slug;
    return Object.assign(publicSummary(ev), {
      intro: ev.intro,
      musicUrl: uploadUrl(ev.music),
      fields: ev.fields,
      url: url,
      invite: invite.enabled ? { style: invite.style, message: invite.message, qr: qrRows(url) } : null
    });
  }

  /* 活动列表里每场活动的公开信息（不含报名人数和内部 id） */
  function publicSummary(ev) {
    return {
      slug: ev.slug,
      title: ev.title,
      subtitle: ev.subtitle,
      startAt: ev.startAt,
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
      orgs: orgsOf(ev),
      invite: inviteOf(ev),
      posterUrl: uploadUrl(ev.poster),
      musicUrl: uploadUrl(ev.music),
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
    if (body.deadline !== undefined) {
      if (body.deadline && !localTime(body.deadline)) return "截止时间格式不正确";
      ev.deadline = localTime(body.deadline);
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
    for (const key of ["poster", "music"]) {
      if (body[key] === undefined) continue;
      const id = str(body[key], 40);
      if (id && !db().uploads[id]) return "上传的文件不存在，请重新上传";
      if (id && db().uploads[id].kind !== (key === "poster" ? "image" : "audio")) return key === "poster" ? "海报需要是图片" : "背景音乐需要是音频";
      ev[key] = id;
    }
    if (body.host !== undefined) ev.host = str(body.host, 30);
    if (body.orgs !== undefined) {
      const o = body.orgs && typeof body.orgs === "object" ? body.orgs : {};
      const next = {};
      for (const key of ORG_KEYS) next[key] = nameList(o[key]);
      ev.orgs = next;
    }
    if (body.invite !== undefined) {
      const i = body.invite && typeof body.invite === "object" ? body.invite : {};
      const cur = inviteOf(ev);
      if (i.style !== undefined && INVITE_STYLES.indexOf(i.style) < 0) return "邀请函样式不正确";
      const message = i.message === undefined ? cur.message : str(i.message, 200);
      if (message.length > 150) return "邀请语最多 150 个字";
      ev.invite = {
        enabled: i.enabled === undefined ? cur.enabled : i.enabled !== false,
        style: i.style === undefined ? cur.style : i.style,
        message: message
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

  /* 前台「活动」板块：未开始的按时间先后，已结束的排在后面 */
  route("GET", "/api/events", function (req, res) {
    const all = events();
    const now = Date.now();
    const list = Object.keys(all).map(function (k) { return all[k]; }).filter(function (e) { return e.status !== "draft"; });
    const time = function (e) { return e.startAt ? new Date(e.startAt).getTime() : Infinity; };
    const isPast = function (e) { return e.status === "closed" || time(e) < now - 6 * 3600e3; };
    const upcoming = list.filter(function (e) { return !isPast(e); }).sort(function (a, b) { return time(a) - time(b); });
    const past = list.filter(isPast).sort(function (a, b) { return (time(b) === Infinity ? 0 : time(b)) - (time(a) === Infinity ? 0 : time(a)); });
    sendJSON(res, 200, {
      ok: true,
      upcoming: upcoming.slice(0, 30).map(publicSummary),
      past: past.slice(0, 30).map(publicSummary)
    });
  });

  route("POST", /^\/api\/events\/([a-z0-9-]{1,40})\/register$/, async function (req, res, m) {
    const ev = findBySlug(m[1]);
    if (!ev || ev.status === "draft") return fail(res, 404, "not_found", "活动不存在或尚未发布");
    if (rateLimited("ev-ip:" + clientIp(req), 20, 3600e3)) return fail(res, 429, "too_frequent", "提交太频繁了，请稍后再试");
    const body = await withBody(req, res);
    if (!body) return;

    const phone = str(body.phone, 20).replace(/[\s-]/g, "");
    const errors = {};
    if (!isValidPhone(phone)) errors.phone = "请输入 11 位手机号";
    const values = {};
    for (const key of FIELD_KEYS) {
      const mode = (ev.fields && ev.fields[key]) || "optional";
      const max = key === "project" ? 200 : 40;
      values[key] = mode === "off" ? "" : str(body[key], max);
      if (mode === "required" && !values[key]) errors[key] = "请填写这一项";
    }
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
    const now = Date.now();
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
      if (leads().length > 50000) leads().length = 50000;
    }
    store.save();
    sendJSON(res, 200, { ok: true, updated: Boolean(existing) });
  });

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
    sendJSON(res, 200, { ok: true, events: list });
  });

  route("POST", "/api/admin/events", async function (req, res) {
    if (!isAdmin(req)) return fail(res, 401, "unauthorized", "请先登录后台");
    const body = await withBody(req, res);
    if (!body) return;
    const ev = {
      id: "ev_" + crypto.randomBytes(6).toString("hex"),
      slug: newSlug(),
      title: "", subtitle: "", startAt: "", place: "", intro: "",
      poster: "", music: "",
      host: DEFAULT_HOST,
      orgs: { sponsors: [], partners: [], supporters: [] },
      invite: { enabled: true, style: "crimson", message: "" },
      /* 邀请函抬头要写称呼，所以新活动默认「称呼」必填 */
      fields: { name: "required", company: "optional", project: "optional" },
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
      if (q && [l.name, l.phone, l.company, l.project, l.note].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (l) {
      return Object.assign({}, l, { eventTitle: all[l.eventId] ? all[l.eventId].title : "（活动已删除）" });
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
    sendJSON(res, 200, { ok: true, lead: lead });
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
    const rows = [["报名时间", "活动", "称呼", "手机", "公司", "项目 / 需求", "跟进状态", "备注", "提交次数"]];
    list.forEach(function (l) {
      rows.push([fmtTime(l.createdAt), l.eventTitle, l.name, l.phone, l.company, l.project, LEAD_STATUS_LABEL[l.status] || l.status, l.note, l.submits || 1]);
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
    const file = path.join(uploadDir, m[1] + "." + m[2]);
    let stat;
    try { stat = fs.statSync(file); } catch (err) { return false; }
    const type = UPLOAD_TYPES[m[2]];
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable" };
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
