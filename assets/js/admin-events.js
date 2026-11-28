/* ==========================================================================
   义乌AI圈 · 运营后台：活动报名与客资
   活动：建活动、传海报和音乐、选收集项、写组织单位 / 流程 / 议题、生成二维码。
   客资：按活动看报名名单、标记跟进状态、写备注、导出 CSV。
   ========================================================================== */
(function () {
  "use strict";

  var UI = window.AdminUI;
  var DB = window.AdminDB;
  if (!UI || !DB) return;

  var esc = UI.esc, opts = UI.opts, field = UI.field, toast = UI.toast;
  var req = DB.request;

  var STATUS = { draft: "草稿", open: "报名中", closed: "已结束" };
  var STATE_PILL = {
    draft: '<span class="pill pill--mute">草稿</span>',
    open: '<span class="pill pill--ok">报名中</span>',
    closed: '<span class="pill pill--ink">已结束</span>',
    deadline: '<span class="pill pill--ink">已截止</span>',
    full: '<span class="pill pill--red">名额已满</span>'
  };
  var LEAD_STATUS = [
    { v: "new", t: "待联系" },
    { v: "contacted", t: "已联系" },
    { v: "won", t: "已成交" },
    { v: "lost", t: "无意向" }
  ];
  var FIELD_MODES = [{ v: "optional", t: "选填" }, { v: "required", t: "必填" }, { v: "off", t: "不收集" }];
  var INVITE_STYLES = [
    { v: "crimson", t: "鸿运朱金（红底鎏金，喜庆隆重）" },
    { v: "ink", t: "墨金典藏（黑底鎏金，沉稳高级）" },
    { v: "poster", t: "海报定制（用活动海报做背景）" },
    { v: "tech", t: "科技蓝长图（深蓝光效，带流程和议题，适合论坛峰会）" }
  ];
  var ORG_LABELS = ["指导单位", "主办单位", "承办单位", "协办单位", "支持单位", "赞助方", "合作方", "支持方", "媒体支持"];

  /* ---------------- 可增删的多行输入：组织单位、流程安排、活动议题 ---------------- */
  var REPS = {
    orgs: { max: 8, add: "添加一类单位", cols: [
      { k: "label", label: "身份", ph: "如 指导单位", max: 8, list: "evOrgLabels" },
      { k: "names", label: "单位名称", ph: "单位名称，多个用顿号隔开", max: 400 }
    ] },
    agenda: { max: 16, add: "添加一个环节", cols: [
      { k: "time", label: "时间", ph: "13:30-14:00", max: 20 },
      { k: "item", label: "环节", ph: "如 签到 / 主题分享 / 交流对接", max: 50 }
    ] },
    talks: { max: 12, add: "添加一个议题", cols: [
      { k: "title", label: "议题题目", ph: "议题题目，不用加书名号", max: 40 },
      { k: "speaker", label: "分享人", ph: "分享人", max: 20 },
      { k: "role", label: "单位 / 头衔", ph: "单位 / 头衔", max: 40 }
    ] }
  };

  function repRow(name, row) {
    return '<div class="rep__row" data-rep-row><span class="rep__no" aria-hidden="true"></span>' +
      '<div class="rep__cells rep__cells--' + name + '">' + REPS[name].cols.map(function (c) {
        return '<input class="input" data-k="' + c.k + '" value="' + esc(row[c.k] || "") + '" maxlength="' + c.max + '" placeholder="' + esc(c.ph) +
          '" aria-label="' + esc(c.label) + '"' + (c.list ? ' list="' + c.list + '"' : "") + ">";
      }).join("") + "</div>" +
      '<div class="rep__acts"><button class="rep__btn" type="button" data-rep-move aria-label="上移一行" title="上移">↑</button>' +
      '<button class="rep__btn" type="button" data-rep-del aria-label="删除这一行" title="删除">×</button></div></div>';
  }

  function repeater(name, rows) {
    var list = rows && rows.length ? rows : [{}];
    return '<div class="rep" data-rep="' + name + '">' +
      '<div class="rep__rows" data-rep-rows>' + list.map(function (r) { return repRow(name, r); }).join("") + "</div>" +
      '<button class="row-btn rep__add" type="button" data-rep-add' + (list.length >= REPS[name].max ? " hidden" : "") + ">＋ " + REPS[name].add + "</button></div>";
  }

  function readRep(form, name) {
    return Array.prototype.map.call(form.querySelectorAll('[data-rep="' + name + '"] [data-rep-row]'), function (row) {
      var o = {};
      Array.prototype.forEach.call(row.querySelectorAll("[data-k]"), function (i) { o[i.dataset.k] = i.value.trim(); });
      return o;
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-rep-add], [data-rep-del], [data-rep-move]");
    if (!btn) return;
    var box = btn.closest("[data-rep]");
    var rowsEl = box.querySelector("[data-rep-rows]");
    var name = box.dataset.rep;
    var row = btn.closest("[data-rep-row]");
    if (btn.hasAttribute("data-rep-add")) {
      rowsEl.insertAdjacentHTML("beforeend", repRow(name, {}));
      rowsEl.lastElementChild.querySelector("input").focus();
    } else if (btn.hasAttribute("data-rep-del")) {
      if (rowsEl.children.length > 1) {
        var next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        next.querySelector("input").focus();
      } else {
        Array.prototype.forEach.call(row.querySelectorAll("input"), function (i) { i.value = ""; });
        row.querySelector("input").focus();
      }
    } else if (row.previousElementSibling) {
      rowsEl.insertBefore(row, row.previousElementSibling);
      btn.focus();
    }
    box.querySelector("[data-rep-add]").hidden = rowsEl.children.length >= REPS[name].max;
  });

  var ev = { events: [], leads: [], filter: { event: "", status: "", q: "" } };

  function fmt(ts) {
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return (d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function fmtLocal(v) {
    return v ? v.replace("T", " ") : "—";
  }

  function eventOf(id) {
    return ev.events.filter(function (e) { return e.id === id; })[0] || null;
  }

  function loadEvents() {
    return req("GET", "/api/admin/events").then(function (r) {
      if (r.ok) {
        ev.events = r.events;
        ev.mailReady = Boolean(r.mailReady);
        UI.BADGES.leads = ev.events.reduce(function (s, e) { return s + (e.newLeads || 0); }, 0);
        UI.renderNav();
      }
      return r;
    });
  }

  /* ======================================================================
     活动列表
     ====================================================================== */
  UI.VIEWS.events = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>10</b><span>活动运营</span></div>' +
        '<h1>活动报名</h1><p class="ahead__sub">每场活动一个报名页：扫码看海报、翻面填表，提交的信息直接进入「客资」。不用登录，也不用检票。「导出」把一场活动打包成文件，可以在另一台服务器上「导入活动」。</p></div>' +
        '<div class="ahead__actions"><button class="btn btn--sm btn--ghost" type="button" data-act="ev:import">导入活动</button>' +
        '<input type="file" id="evImportFile" accept="application/json,.json" hidden>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="ev:new">新建活动</button></div></div>' +
        '<div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>活动</th><th>时间</th><th>状态</th><th>报名</th><th>链接</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="evBody"><tr class="is-static"><td colspan="6"><div class="aempty">加载中…</div></td></tr></tbody></table></div></div>';
    }
  };

  UI.PAINT.events = function () {
    loadEvents().then(function (r) {
      var body = document.getElementById("evBody");
      if (!body) return;
      if (!r.ok) {
        body.innerHTML = '<tr class="is-static"><td colspan="6"><div class="aempty"><strong>加载失败</strong>' + esc(r.message || "请刷新重试") + "</div></td></tr>";
        return;
      }
      if (!ev.events.length) {
        body.innerHTML = '<tr class="is-static"><td colspan="6"><div class="aempty"><strong>还没有活动</strong>点右上角「新建活动」，上传海报就能生成报名二维码。</div></td></tr>';
        return;
      }
      body.innerHTML = ev.events.map(function (e) {
        return '<tr class="is-static">' +
          '<td class="strong" style="white-space:normal;max-width:300px">' + esc(e.title) +
          (e.place ? '<div class="muted" style="font-weight:400;font-size:12px">' + esc(e.place) + "</div>" : "") + "</td>" +
          '<td class="num muted">' + esc(fmtLocal(e.startAt)) + "</td>" +
          "<td>" + (STATE_PILL[e.state] || STATE_PILL[e.status] || "") + "</td>" +
          '<td class="num"><b>' + e.leads + "</b>" + (e.capacity ? " / " + e.capacity : "") +
          (e.newLeads ? ' <span class="pill pill--red">' + e.newLeads + " 待联系</span>" : "") + "</td>" +
          '<td class="num muted">/e/' + esc(e.slug) + "</td>" +
          '<td><div class="tbl__acts">' +
          '<button class="row-btn" type="button" data-act="ev:qr" data-id="' + e.id + '">二维码</button>' +
          '<button class="row-btn" type="button" data-act="ev:leads" data-id="' + e.id + '">客资</button>' +
          '<a class="row-btn" href="/e/' + esc(e.slug) + '" target="_blank" rel="noopener">' + (e.status === "draft" ? "预览" : "打开") + "</a>" +
          (e.invite && e.invite.enabled !== false ? '<a class="row-btn" href="/e/' + esc(e.slug) + '?invite=letter" target="_blank" rel="noopener">邀请函</a>' : "") +
          '<a class="row-btn" href="/e/' + esc(e.slug) + '?poster=1" target="_blank" rel="noopener">长图海报</a>' +
          '<a class="row-btn" href="/api/admin/events/' + e.id + '/export" download title="导出成文件，可以导入到另一台服务器">导出</a>' +
          '<button class="row-btn" type="button" data-act="ev:edit" data-id="' + e.id + '">编辑</button>' +
          "</div></td></tr>";
      }).join("");
    });
  };

  /* ---------------- 新建 / 编辑 ---------------- */
  function fileField(label, kind, current, hint, name) {
    var input = name || (kind === "image" ? "poster" : "music");
    var remove = name ? "remove_" + name : (kind === "image" ? "removePoster" : "removeMusic");
    var what = name ? "图片" : (kind === "image" ? "海报" : "音乐");
    var preview = kind === "image"
      ? (current ? '<img src="' + esc(current) + '" alt="当前' + esc(label) + '" style="max-width:120px;max-height:160px;border-radius:8px;outline:1px solid rgba(0,0,0,.1);outline-offset:-1px">' : "")
      : (current ? '<audio controls preload="none" src="' + esc(current) + '" style="width:100%"></audio>' : "");
    return field(label,
      '<div class="ev-upload" data-upload="' + kind + '">' +
      '<div data-upload-preview>' + preview + "</div>" +
      '<input class="input" type="file" accept="' + (kind === "image" ? "image/jpeg,image/png,image/webp" : "audio/mpeg,audio/mp4,audio/ogg,.mp3,.m4a,.ogg") + '" data-upload-input>' +
      '<input type="hidden" name="' + input + '" data-upload-id>' +
      '<span class="dhint" data-upload-status>' + esc(hint) + "</span>" +
      (current ? '<label class="dhint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="' + remove + '" value="1"> 移除当前' + what + "</label>" : "") +
      "</div>", "full");
  }

  function openEvent(id) {
    var e = id ? eventOf(id) : null;
    var isNew = !e;
    if (!e) {
      e = {
        title: "", subtitle: "", startAt: "", endAt: "", place: "", intro: "", deadline: "", capacity: 0, status: "draft", slug: "",
        host: "", orgs: [], agenda: [], talks: [], notice: "", logos: [], visualAt: "top", contact: "", slogan: "",
        invite: { enabled: true, style: "crimson", message: "", greeting: "", signature: "", date: "" },
        fields: { name: "required", email: "optional", company: "optional", project: "optional" }
      };
    }
    var inv = e.invite || { enabled: true, style: "crimson", message: "" };
    /* 还没填过组织单位时，先摆出最常用的三类 */
    var orgRows = (e.orgs && e.orgs.length ? e.orgs : [{ label: "赞助方" }, { label: "合作方" }, { label: "支持方" }])
      .map(function (g) { return { label: g.label, names: (g.names || []).join("、") }; });
    var preview = isNew ? "保存后可以预览。" :
      ' <a href="/e/' + esc(e.slug) + '?invite=letter" target="_blank" rel="noopener">在线查看邀请函 →</a>';
    var fields = e.fields || {};
    UI.openDrawer({
      kicker: isNew ? "新建活动" : "活动 /e/" + e.slug,
      title: isNew ? "新建活动" : e.title,
      sub: isNew ? "先存为草稿，上传海报后用「预览」检查，再改成「报名中」。" : e.leads + " 人报名 · " + (STATUS[e.status] || ""),
      wide: true,
      body: '<form id="drawerForm" class="dgrid">' +
        field("活动标题", '<input class="input" name="title" value="' + esc(e.title) + '" maxlength="40" required placeholder="如：2026 义乌 · 库存品行业AI出海创新大会">', "full") +
        field("副标题", '<input class="input" name="subtitle" value="' + esc(e.subtitle) + '" maxlength="80" placeholder="一句话说清楚来了能得到什么">', "full") +
        field("活动时间", '<input class="input" type="datetime-local" name="startAt" value="' + esc(e.startAt) + '">') +
        field("结束时间", '<input class="input" type="datetime-local" name="endAt" value="' + esc(e.endAt || "") + '">', "", "可留空；填了会显示成 14:00-17:00") +
        field("活动地点", '<input class="input" name="place" value="' + esc(e.place) + '" maxlength="60" placeholder="如：国际商贸城二区 · 青口直播基地">', "full") +
        field("活动介绍", '<textarea name="intro" maxlength="300" placeholder="显示在报名表上方，可留空">' + esc(e.intro) + "</textarea>", "full") +
        fileField("海报", "image", e.posterUrl, "竖版海报效果最好（如 1080×1920），JPG / PNG / WebP，5MB 以内") +
        fileField("背景音乐", "audio", e.musicUrl, "MP3 / M4A / OGG，10MB 以内；访客第一次触碰页面时开始播放，可随时暂停") +
        field("称呼", '<select name="f_name">' + opts(FIELD_MODES, e.fields.name) + "</select>") +
        field("手机号", '<select disabled><option>必填</option></select>', "", "手机号是客资的唯一标识，固定必填") +
        field("邮箱", '<select name="f_email">' + opts(FIELD_MODES, fields.email || "off") + "</select>", "", "填了邮箱的人，报名后会收到邀请函邮件") +
        field("公司 / 档口", '<select name="f_company">' + opts(FIELD_MODES, e.fields.company) + "</select>") +
        field("项目 / 需求", '<select name="f_project">' + opts(FIELD_MODES, e.fields.project) + "</select>") +
        '<div class="dsection full">主办与组织单位</div>' +
        field("主办方", '<input class="input" name="host" value="' + esc(e.host || "") + '" maxlength="30" placeholder="如：义乌市库存品行业协会">', "full", "显示在报名页、同意书和海报顶部，并作为邀请函的落款（××× 敬邀）") +
        field("组织单位", repeater("orgs", orgRows) +
          '<datalist id="evOrgLabels">' + ORG_LABELS.map(function (l) { return '<option value="' + l + '">'; }).join("") + "</datalist>", "full",
          "身份可以自己写，如指导单位、协办单位、赞助方；每类最多 12 个单位，没填单位的行不保存。显示在报名页、邀请函和长图海报上") +
        '<div class="dsection full">流程与议题</div>' +
        field("流程安排", repeater("agenda", e.agenda), "full", "按时间顺序填，可留空。显示在报名页和科技蓝长图上") +
        field("活动议题", repeater("talks", e.talks), "full", "每个分享一行，长图上会编号 01、02……") +
        field("温馨提示", '<textarea name="notice" maxlength="200" style="min-height:64px" placeholder="如：现场停车位有限，建议公共交通出行">' + esc(e.notice || "") + "</textarea>", "full", "可留空，200 字以内") +
        '<div class="dsection full">邀请函（报名后发到邮箱）</div>' +
        field("报名后发邀请函", '<select name="inv_enabled">' + opts([{ v: "1", t: "开启" }, { v: "0", t: "关闭" }], inv.enabled === false ? "0" : "1") + "</select>", "",
          ev.mailReady ? "报名时填了邮箱的人会收到：邮件正文写「尊敬的 + 称呼」，附上这张邀请函"
            : "服务器还没配置发信邮箱（SMTP_HOST 等），配置好之前不会发邮件，邀请函只能在线查看") +
        field("邀请函样式", '<select name="inv_style">' + opts(INVITE_STYLES, inv.style || "crimson") + "</select>", "", "选「海报定制」但没上传海报时，自动用墨金典藏") +
        field("抬头", '<input class="input" name="inv_greeting" value="' + esc(inv.greeting || "") + '" maxlength="20" placeholder="如：各位行业家人们">', "full",
          "写在邀请函图片上，留空写「各位嘉宾」") +
        field("邀请函正文", '<textarea name="inv_message" maxlength="600" style="min-height:150px" placeholder="留空自动生成：诚挚邀请您莅临「活动标题」……敬请拨冗光临。">' + esc(inv.message || "") + "</textarea>", "full",
          "600 字以内，换行分段。" + preview) +
        field("落款", '<input class="input" name="inv_signature" value="' + esc(inv.signature || "") + '" maxlength="40" placeholder="留空写「主办方 敬邀」">') +
        field("落款日期", '<input class="input" type="date" name="inv_date" value="' + esc(inv.date || "") + '">', "", "留空用生成当天的日期") +
        (isNew ? "" : field("邮件里的邀请函图片", mailImageBox(e), "full", "每次保存活动都会按最新内容自动重新生成；改了主视觉或 Logo 也会跟着更新")) +
        '<div class="dsection full">长图海报</div>' +
        '<p class="dhint full">「长图海报」不带称呼，用来发群和朋友圈，扫码直达报名页。科技蓝长图和长图海报共用下面这些设置。' +
          (isNew ? "保存后在活动列表点「长图海报」生成。" : ' <a href="/e/' + esc(e.slug) + '?poster=1" target="_blank" rel="noopener">生成长图海报 →</a>') + "</p>" +
        fileField("主视觉图", "image", e.visualUrl, "横版效果最好（如 1600×1000）；深色底的科技插画会自动融进背景，不传就用默认光效", "visual") +
        field("主视觉位置", '<select name="visualAt">' + opts([{ v: "top", t: "标题下方（科技插画、3D 大图）" }, { v: "bottom", t: "海报底部（场馆、城市实景照片）" }], e.visualAt || "top") + "</select>", "full",
          "实景照片放底部，会铺满整个宽度、往上渐隐，底部标语压在照片上") +
        field("顶部 Logo", logosField(e.logos || []), "full", "主办、协办单位的 Logo，最多 6 个，显示在长图左上角；圆形或方形、白底或透明底都可以") +
        field("报名咨询", '<input class="input" name="contact" value="' + esc(e.contact || "") + '" maxlength="40" placeholder="如：138 0000 0000（李女士）">', "", "显示在二维码下方，可留空") +
        field("底部标语", '<input class="input" name="slogan" value="' + esc(e.slogan || "") + '" maxlength="30" placeholder="如：库存品行业数字化出海新机遇">', "", "长图最底部一行，可留空") +
        '<div class="dsection full">名额与发布</div>' +
        field("报名截止", '<input class="input" type="datetime-local" name="deadline" value="' + esc(e.deadline) + '">', "", "留空表示不限") +
        field("名额", '<input class="input" type="number" name="capacity" min="0" step="1" value="' + (e.capacity || 0) + '">', "", "0 表示不限；已报名的人满额后仍可修改资料") +
        field("状态", '<select name="status">' + opts([{ v: "draft", t: "草稿（只有后台能预览）" }, { v: "open", t: "报名中" }, { v: "closed", t: "已结束" }], e.status) + "</select>") +
        field("链接后缀", '<input class="input" name="slug" value="' + esc(e.slug) + '" maxlength="40" pattern="[a-z0-9\\-]{2,40}" placeholder="自动生成">', "", "报名链接为 /e/后缀，只能用小写字母、数字和减号") +
        "</form>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="ev:delete" data-id="' + e.id + '">删除</button>') +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm" data-ev-save>保存</button>',
      save: function (d, f) {
        var body = {
          title: d.title, subtitle: d.subtitle, startAt: d.startAt, endAt: d.endAt, place: d.place, intro: d.intro,
          deadline: d.deadline, capacity: Number(d.capacity) || 0, status: d.status,
          fields: { name: d.f_name, email: d.f_email, company: d.f_company, project: d.f_project },
          host: d.host,
          orgs: readRep(f, "orgs"),
          agenda: readRep(f, "agenda"),
          talks: readRep(f, "talks"),
          notice: d.notice,
          invite: { enabled: d.inv_enabled !== "0", style: d.inv_style, message: d.inv_message, greeting: d.inv_greeting, signature: d.inv_signature, date: d.inv_date },
          visualAt: d.visualAt,
          logos: readLogos(f),
          contact: d.contact,
          slogan: d.slogan
        };
        if (d.slug && d.slug !== e.slug) body.slug = d.slug.trim().toLowerCase();
        if (d.poster) body.poster = d.poster;
        else if (d.removePoster) body.poster = "";
        if (d.music) body.music = d.music;
        else if (d.removeMusic) body.music = "";
        if (d.visual) body.visual = d.visual;
        else if (d.remove_visual) body.visual = "";
        var btn = document.querySelector("[data-ev-save]");
        if (btn) btn.disabled = true;
        req(isNew ? "POST" : "PATCH", isNew ? "/api/admin/events" : "/api/admin/events/" + e.id, body).then(function (r) {
          if (btn) btn.disabled = false;
          if (!r.ok) { toast(r.message || "保存失败"); return; }
          UI.closeDrawer();
          toast(isNew ? "活动已创建，可以先「预览」看看效果" : "已保存");
          UI.render();
          if (isNew) openQr(r.event);
          /* 保存后按最新内容重画发邮件用的邀请函 */
          if (r.event.invite && r.event.invite.enabled !== false) makeMailImage(r.event, true);
        });
      }
    });
    bindUploads();
    bindLogos();
  }

  /* ---------------- 发邮件用的邀请函图片 ---------------- */
  function mailImageBox(e) {
    return '<div class="mail-img" data-mail-img>' +
      (e.inviteImageUrl
        ? '<a href="' + esc(e.inviteImageUrl) + '" target="_blank" rel="noopener"><img src="' + esc(e.inviteImageUrl) + '" alt="当前邮件邀请函"></a>'
        : '<span class="mail-img__empty">还没有</span>') +
      '<div><span class="dhint" data-mail-img-status>' + (e.inviteImageAt ? "上次生成：" + fmt(e.inviteImageAt) : "保存活动后自动生成") + "</span>" +
      '<button class="row-btn" type="button" data-act="ev:mailimg" data-id="' + e.id + '">现在重新生成</button></div></div>';
  }

  /* 用报名页同一套画图代码画出邀请函，传到服务器给发邮件用 */
  function makeMailImage(e, quiet) {
    if (!window.YWInvite) { if (!quiet) toast("邀请函画图脚本没加载"); return Promise.resolve(false); }
    var status = document.querySelector("[data-mail-img-status]");
    if (status) status.textContent = "正在生成…";
    return req("GET", "/api/events/" + encodeURIComponent(e.slug)).then(function (r) {
      if (!r.ok || !r.event) throw new Error(r.message || "读取活动失败");
      return window.YWInvite.render(window.YWInvite.fromEvent(r.event, "letter"));
    }).then(function (canvas) {
      return req("PUT", "/api/admin/events/" + e.id + "/invite-image", { data: canvas.toDataURL("image/jpeg", 0.88) });
    }).then(function (r) {
      if (!r.ok) throw new Error(r.message || "上传失败");
      var i = ev.events.findIndex(function (x) { return x.id === e.id; });
      if (i >= 0) ev.events[i] = r.event;
      var box = document.querySelector("[data-mail-img]");
      if (box) box.outerHTML = mailImageBox(r.event);
      if (!quiet) toast("邮件邀请函已更新");
      return true;
    }).catch(function (err) {
      if (status) status.textContent = "生成失败：" + (err && err.message || "请重试");
      toast("邮件邀请函生成失败：" + (err && err.message || "请重试"));
      return false;
    });
  }

  UI.ACTIONS["ev:mailimg"] = function (id) { var e = eventOf(id); if (e) makeMailImage(e, false); };

  /* ---------------- 顶部 Logo：可传多个，点 × 移除 ---------------- */
  var MAX_LOGOS = 6;

  function logoItem(id, url) {
    return '<li data-logo-id="' + esc(id) + '"><img src="' + esc(url) + '" alt="">' +
      '<button type="button" data-logo-del aria-label="移除这个 Logo" title="移除">×</button></li>';
  }

  function logosField(list) {
    return '<div class="logo-up" data-logos>' +
      '<ul class="logo-up__list" data-logos-list>' + list.map(function (l) { return logoItem(l.id, l.url); }).join("") + "</ul>" +
      '<input class="input" type="file" accept="image/jpeg,image/png,image/webp" multiple data-logos-input aria-label="添加 Logo">' +
      '<span class="dhint" data-logos-status>' + (list.length ? "已有 " + list.length + " 个" : "还没有 Logo") + "</span></div>";
  }

  function readLogos(form) {
    return Array.prototype.map.call(form.querySelectorAll("[data-logos-list] [data-logo-id]"), function (li) { return li.dataset.logoId; });
  }

  function bindLogos() {
    var box = document.querySelector("[data-logos]");
    if (!box) return;
    var input = box.querySelector("[data-logos-input]");
    var list = box.querySelector("[data-logos-list]");
    var status = box.querySelector("[data-logos-status]");
    box.addEventListener("click", function (e) {
      var del = e.target.closest("[data-logo-del]");
      if (!del) return;
      del.closest("li").remove();
      status.textContent = "已移除，保存后生效";
    });
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      var room = MAX_LOGOS - list.children.length;
      if (files.length > room) { status.textContent = "最多 " + MAX_LOGOS + " 个，这次只上传前 " + Math.max(0, room) + " 个"; files = files.slice(0, Math.max(0, room)); }
      if (!files.length) { input.value = ""; return; }
      var save = document.querySelector("[data-ev-save]");
      if (save) save.disabled = true;
      var done = 0;
      (function next() {
        var f = files.shift();
        if (!f) {
          if (save) save.disabled = false;
          input.value = "";
          status.textContent = "已上传 " + done + " 个，保存后生效";
          return;
        }
        if (f.size > 5 * 1024 * 1024) { status.textContent = f.name + " 超过 5MB，已跳过"; next(); return; }
        status.textContent = "上传中：" + f.name;
        var reader = new FileReader();
        reader.onload = function () {
          req("POST", "/api/admin/uploads", { name: f.name, kind: "image", data: String(reader.result) }).then(function (r) {
            if (r.ok) { list.insertAdjacentHTML("beforeend", logoItem(r.upload.id, r.upload.url)); done++; }
            else status.textContent = (r.message || "上传失败") + "：" + f.name;
            next();
          });
        };
        reader.onerror = function () { next(); };
        reader.readAsDataURL(f);
      })();
    });
  }

  /* 选好文件就上传；上传完成前不能保存 */
  function bindUploads() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-upload]"), function (box) {
      var kind = box.dataset.upload;
      var input = box.querySelector("[data-upload-input]");
      var status = box.querySelector("[data-upload-status]");
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var limit = kind === "image" ? 5 : 10;
        if (f.size > limit * 1024 * 1024) { status.textContent = "文件超过 " + limit + "MB，换一个小一点的"; input.value = ""; return; }
        var save = document.querySelector("[data-ev-save]");
        if (save) save.disabled = true;
        status.textContent = "上传中…";
        var reader = new FileReader();
        reader.onload = function () {
          req("POST", "/api/admin/uploads", { name: f.name, kind: kind, data: String(reader.result) }).then(function (r) {
            if (save) save.disabled = false;
            if (!r.ok) { status.textContent = r.message || "上传失败"; input.value = ""; return; }
            box.querySelector("[data-upload-id]").value = r.upload.id;
            status.textContent = "已上传 " + f.name + "，保存后生效";
            box.querySelector("[data-upload-preview]").innerHTML = kind === "image"
              ? '<img src="' + esc(r.upload.url) + '" alt="新海报" style="max-width:120px;max-height:160px;border-radius:8px;outline:1px solid rgba(0,0,0,.1);outline-offset:-1px">'
              : '<audio controls preload="none" src="' + esc(r.upload.url) + '" style="width:100%"></audio>';
          });
        };
        reader.onerror = function () { if (save) save.disabled = false; status.textContent = "读取文件失败"; };
        reader.readAsDataURL(f);
      });
    });
  }

  /* ---------------- 二维码 ---------------- */
  function openQr(e) {
    var src = "/api/admin/events/" + e.id + "/qr.svg";
    UI.openModal({
      kicker: "报名二维码",
      title: e.title,
      sub: e.status === "open" ? "印到海报或易拉宝上，扫码即可报名。" : "活动还没有开放报名，扫码只会看到「活动不存在」。发布前记得把状态改成「报名中」。",
      body: '<div style="display:grid;justify-items:center;gap:12px">' +
        '<img src="' + src + "?t=" + Date.now() + '" alt="' + esc(e.title) + ' 报名二维码" width="240" height="240" style="width:240px;height:240px;border-radius:12px;outline:1px solid rgba(0,0,0,.1);outline-offset:-1px">' +
        '<code style="font-size:13px;word-break:break-all;text-align:center">' + esc(e.url) + "</code></div>" +
        '<p class="dhint" style="margin-top:12px">印刷建议边长不小于 3 厘米，四周留白。上线后如果更换了域名，请设置服务器的 PUBLIC_URL 并重新下载。</p>',
      foot: '<button class="btn btn--sm btn--ghost" type="button" data-act="ev:copy" data-id="' + e.id + '">复制链接</button>' +
        '<a class="btn btn--sm btn--ghost" href="' + src + '?download=1" download>下载 SVG</a>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="ev:png" data-id="' + e.id + '">下载 PNG</button>'
    });
  }

  function downloadPng(e) {
    var img = new Image();
    img.onload = function () {
      var size = 1200;
      var c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);
      c.toBlob(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "event-" + e.slug + "-qr.png";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }, "image/png");
    };
    img.onerror = function () { toast("二维码生成失败，请重试"); };
    img.src = "/api/admin/events/" + e.id + "/qr.svg?t=" + Date.now();
  }

  UI.ACTIONS["ev:new"] = function () { openEvent(null); };

  /* ---------------- 导入活动（从另一台服务器导出的文件） ---------------- */
  UI.ACTIONS["ev:import"] = function () {
    var input = document.getElementById("evImportFile");
    if (input) { input.value = ""; input.click(); }
  };

  function importEvent(file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast("文件超过 40MB，导入不了"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); } catch (err) { toast("文件读不出来，请选从后台「导出」的 .json 文件"); return; }
      toast("正在导入「" + ((data.event && data.event.title) || file.name) + "」…");
      req("POST", "/api/admin/events/import", data).then(function (r) {
        if (!r.ok) { toast(r.message || "导入失败"); return; }
        toast(r.slugKept ? "已导入为草稿，链接和原来一样：/e/" + r.event.slug : "已导入为草稿，原链接已被占用，新链接：/e/" + r.event.slug);
        loadEvents().then(function () {
          UI.render();
          /* 顺便生成发邮件用的邀请函图片 */
          if (r.event.invite && r.event.invite.enabled !== false) makeMailImage(r.event, true);
          openEvent(r.event.id);
        });
      });
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file);
  }
  UI.ACTIONS["ev:edit"] = function (id) { openEvent(id); };
  UI.ACTIONS["ev:qr"] = function (id) { var e = eventOf(id); if (e) openQr(e); };
  UI.ACTIONS["ev:png"] = function (id) { var e = eventOf(id); if (e) downloadPng(e); };
  UI.ACTIONS["ev:copy"] = function (id) {
    var e = eventOf(id);
    if (!e) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(e.url).then(function () { toast("链接已复制"); }, function () { toast(e.url); });
    } else {
      toast(e.url);
    }
  };
  UI.ACTIONS["ev:leads"] = function (id) {
    ev.filter.event = id;
    ev.filter.status = "";
    location.hash = "#/leads";
  };
  UI.ACTIONS["ev:delete"] = function (id) {
    var e = eventOf(id);
    if (!e || !window.confirm("删除活动「" + e.title + "」？删除后报名链接立即失效。")) return;
    req("DELETE", "/api/admin/events/" + id).then(function (r) {
      if (!r.ok) { toast(r.message || "删除失败"); return; }
      UI.closeDrawer();
      toast("活动已删除");
      UI.render();
    });
  };

  /* ======================================================================
     客资
     ====================================================================== */
  function leadQuery() {
    var p = new URLSearchParams();
    if (ev.filter.event) p.set("event", ev.filter.event);
    if (ev.filter.status) p.set("status", ev.filter.status);
    if (ev.filter.q) p.set("q", ev.filter.q);
    return p.toString();
  }

  UI.VIEWS.leads = {
    html: function () {
      var eventOpts = [{ v: "", t: "全部活动" }].concat(ev.events.map(function (e) { return { v: e.id, t: e.title }; }));
      var statusChips = [{ v: "", t: "全部" }].concat(LEAD_STATUS).map(function (s) {
        return '<button class="chip' + (ev.filter.status === s.v ? " is-on" : "") + '" type="button" data-act="ld:filter" data-id="' + s.v + '">' + s.t + "</button>";
      }).join("");
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>11</b><span>活动运营</span></div>' +
        '<h1>客资</h1><p class="ahead__sub">活动报名提交的信息。同一活动同一手机号只保留一条，以最后一次填写为准；导出会记录在操作日志里。</p></div>' +
        '<div class="ahead__actions"><a class="btn btn--sm btn--ghost" id="ldExport" href="/api/admin/leads.csv?' + leadQuery() + '">导出 CSV</a></div></div>' +
        '<div class="panel"><div class="filters">' +
        '<label class="adm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="搜索称呼、手机、公司、需求" id="ldSearch" value="' + esc(ev.filter.q) + '" aria-label="搜索客资"></label>' +
        '<select id="ldEvent" aria-label="按活动筛选" style="min-height:36px;border-radius:8px;padding:0 10px">' + opts(eventOpts, ev.filter.event) + "</select>" +
        '<div style="display:flex;gap:5px;flex-wrap:wrap">' + statusChips + "</div>" +
        '<span class="filters__count">共 <b id="ldCount">0</b> 条</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        "<th>报名时间</th><th>称呼</th><th>手机</th><th>公司</th><th>项目 / 需求</th><th>活动</th><th>跟进</th><th style=\"text-align:right\">操作</th>" +
        '</tr></thead><tbody id="ldBody"><tr class="is-static"><td colspan="8"><div class="aempty">加载中…</div></td></tr></tbody></table></div></div>';
    }
  };

  function paintLeads() {
    var body = document.getElementById("ldBody");
    if (!body) return;
    var exp = document.getElementById("ldExport");
    if (exp) exp.href = "/api/admin/leads.csv?" + leadQuery();
    req("GET", "/api/admin/leads?" + leadQuery()).then(function (r) {
      if (!document.getElementById("ldBody")) return;
      if (!r.ok) {
        body.innerHTML = '<tr class="is-static"><td colspan="8"><div class="aempty"><strong>加载失败</strong>' + esc(r.message || "请刷新重试") + "</div></td></tr>";
        return;
      }
      ev.leads = r.leads;
      document.getElementById("ldCount").textContent = r.leads.length;
      if (!r.leads.length) {
        body.innerHTML = '<tr class="is-static"><td colspan="8"><div class="aempty"><strong>' +
          (ev.filter.event || ev.filter.status || ev.filter.q ? "没有匹配的客资" : "还没有人报名") + "</strong>" +
          (ev.filter.event || ev.filter.status || ev.filter.q ? "换个条件看看。" : "把活动二维码印到海报上，扫码报名的人会出现在这里。") + "</div></td></tr>";
        return;
      }
      body.innerHTML = r.leads.map(function (l) {
        return '<tr class="is-static">' +
          '<td class="num muted" style="white-space:nowrap">' + fmt(l.createdAt) + (l.submits > 1 ? '<div style="font-size:12px">提交 ' + l.submits + " 次</div>" : "") + "</td>" +
          '<td class="strong">' + esc(l.name || "—") + "</td>" +
          '<td class="num"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + "</a>" +
          (l.email ? '<div style="font-size:12px;margin-top:2px;max-width:200px;overflow:hidden;text-overflow:ellipsis"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + "</a></div>" : "") +
          mailPill(l.mail) + "</td>" +
          "<td>" + esc(l.company || "—") + "</td>" +
          '<td style="white-space:normal;max-width:260px">' + esc(l.project || "—") +
          (l.note ? '<div class="muted" style="font-size:12px;margin-top:2px">备注：' + esc(l.note) + "</div>" : "") + "</td>" +
          '<td class="muted" style="white-space:normal;max-width:160px">' + esc(l.eventTitle) + "</td>" +
          '<td><select data-lead-status="' + l.id + '" aria-label="跟进状态" style="min-height:32px;border-radius:8px;padding:0 8px">' + opts(LEAD_STATUS, l.status) + "</select></td>" +
          '<td><div class="tbl__acts">' +
          '<button class="row-btn" type="button" data-act="ld:note" data-id="' + l.id + '">备注</button>' +
          (l.email ? '<button class="row-btn" type="button" data-act="ld:mail" data-id="' + l.id + '">' + (l.mail && l.mail.status === "sent" ? "重发邀请函" : "发邀请函") + "</button>" : "") +
          '<button class="row-btn row-btn--red" type="button" data-act="ld:delete" data-id="' + l.id + '">删除</button>' +
          "</div></td></tr>";
      }).join("");
    });
  }

  UI.PAINT.leads = function () {
    if (!ev.events.length) loadEvents().then(function () {
      var sel = document.getElementById("ldEvent");
      if (sel && sel.options.length <= 1) {
        sel.innerHTML = opts([{ v: "", t: "全部活动" }].concat(ev.events.map(function (e) { return { v: e.id, t: e.title }; })), ev.filter.event);
      }
    });
    paintLeads();
  };

  function leadOf(id) { return ev.leads.filter(function (l) { return l.id === id; })[0] || null; }

  var MAIL_PILL = {
    sent: ["pill--ok", "邀请函已发"],
    queued: ["pill--mute", "邀请函发送中"],
    failed: ["pill--red", "邀请函发送失败"],
    limited: ["pill--mute", "当天发送已达上限"]
  };
  function mailPill(m) {
    if (!m || !MAIL_PILL[m.status]) return "";
    var p = MAIL_PILL[m.status];
    return '<div style="margin-top:4px"><span class="pill ' + p[0] + '"' + (m.error ? ' title="' + esc(m.error) + '"' : "") + ">" + p[1] + "</span></div>";
  }

  UI.ACTIONS["ld:mail"] = function (id) {
    var l = leadOf(id);
    if (!l) return;
    req("POST", "/api/admin/leads/" + id + "/mail").then(function (r) {
      if (!r.ok) { toast(r.message || "发送失败"); return; }
      toast("已加入发送队列：" + l.email);
      paintLeads();
      setTimeout(paintLeads, 2500);
    });
  };

  UI.ACTIONS["ld:filter"] = function (id) {
    ev.filter.status = id || "";
    Array.prototype.forEach.call(document.querySelectorAll('[data-act="ld:filter"]'), function (b) {
      b.classList.toggle("is-on", (b.dataset.id || "") === ev.filter.status);
    });
    paintLeads();
  };

  UI.ACTIONS["ld:note"] = function (id) {
    var l = leadOf(id);
    if (!l) return;
    UI.openModal({
      kicker: "跟进备注",
      title: (l.name || "未留称呼") + " · " + l.phone,
      sub: [l.company, l.eventTitle].filter(Boolean).join(" · "),
      body: field("备注", '<textarea name="note" maxlength="300" style="min-height:110px" placeholder="如：已加微信，下周三到档口看样">' + esc(l.note || "") + "</textarea>", "full"),
      foot: '<button class="btn btn--sm btn--ghost" type="button" data-close-modal>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="modalForm">保存备注</button>',
      save: function (d) {
        req("PATCH", "/api/admin/leads/" + l.id, { note: d.note }).then(function (r) {
          if (!r.ok) { toast(r.message || "保存失败"); return; }
          UI.closeModal();
          toast("备注已保存");
          paintLeads();
        });
      }
    });
  };

  UI.ACTIONS["ld:delete"] = function (id) {
    var l = leadOf(id);
    if (!l || !window.confirm("删除 " + (l.name || l.phone) + " 的报名记录？删除后无法恢复。")) return;
    req("DELETE", "/api/admin/leads/" + id).then(function (r) {
      if (!r.ok) { toast(r.message || "删除失败"); return; }
      toast("已删除");
      paintLeads();
      loadEvents();
    });
  };

  document.addEventListener("change", function (e) {
    var sel = e.target.closest("[data-lead-status]");
    if (sel) {
      sel.disabled = true;
      req("PATCH", "/api/admin/leads/" + sel.dataset.leadStatus, { status: sel.value }).then(function (r) {
        sel.disabled = false;
        if (!r.ok) { toast(r.message || "保存失败"); paintLeads(); return; }
        toast("跟进状态已更新");
        loadEvents();
      });
      return;
    }
    if (e.target.id === "evImportFile") {
      importEvent(e.target.files && e.target.files[0]);
      return;
    }
    if (e.target.id === "ldEvent") {
      ev.filter.event = e.target.value;
      paintLeads();
    }
  });

  var searchTimer = null;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "ldSearch") return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      ev.filter.q = e.target.value.trim();
      paintLeads();
    }, 250);
  });

  /* ======================================================================
     合作伙伴：赞助方 / 合作方 / 支持方，首页底部滚动展示
     ====================================================================== */
  var KINDS = [{ v: "sponsor", t: "赞助方" }, { v: "partner", t: "合作方" }, { v: "supporter", t: "支持方" }];
  var KIND_PILL = { sponsor: "pill--red", partner: "pill--ink", supporter: "pill--mute" };
  var partners = [];

  function partnerOf(id) { return partners.filter(function (p) { return p.id === id; })[0] || null; }

  UI.VIEWS.partners = {
    html: function () {
      return '<div class="ahead">' +
        '<div><div class="ahead__kicker"><b>12</b><span>活动运营</span></div>' +
        '<h1>合作伙伴</h1><p class="ahead__sub">赞助方、合作方、支持方。设为「首页展示」的会出现在首页底部两排滚动条里：赞助方一排，合作方和支持方一排。</p></div>' +
        '<div class="ahead__actions"><a class="btn btn--sm btn--ghost" href="/#partners" target="_blank" rel="noopener">看首页效果</a>' +
        '<button class="btn btn--sm btn--red" type="button" data-act="pt:new">新增合作伙伴</button></div></div>' +
        '<div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Logo</th><th>名称</th><th>类型</th><th>链接</th><th>首页</th><th>排序</th><th style="text-align:right">操作</th>' +
        '</tr></thead><tbody id="ptBody"><tr class="is-static"><td colspan="7"><div class="aempty">加载中…</div></td></tr></tbody></table></div></div>';
    }
  };

  UI.PAINT.partners = function () {
    req("GET", "/api/admin/partners").then(function (r) {
      var body = document.getElementById("ptBody");
      if (!body) return;
      if (!r.ok) {
        body.innerHTML = '<tr class="is-static"><td colspan="7"><div class="aempty"><strong>加载失败</strong>' + esc(r.message || "请刷新重试") + "</div></td></tr>";
        return;
      }
      partners = r.partners;
      if (!partners.length) {
        body.innerHTML = '<tr class="is-static"><td colspan="7"><div class="aempty"><strong>还没有合作伙伴</strong>点右上角「新增合作伙伴」。没有 Logo 也可以，首页会用名称做成字标。</div></td></tr>';
        return;
      }
      body.innerHTML = partners.map(function (p) {
        return '<tr class="is-static">' +
          "<td>" + (p.logoUrl ? '<img src="' + esc(p.logoUrl) + '" alt="" style="height:32px;max-width:96px;object-fit:contain;display:block">' : '<span class="muted">—</span>') + "</td>" +
          '<td class="strong">' + esc(p.name) + (p.intro ? '<div class="muted" style="font-weight:400;font-size:12px">' + esc(p.intro) + "</div>" : "") + "</td>" +
          '<td><span class="pill ' + (KIND_PILL[p.kind] || "") + '">' + esc(p.kindLabel || p.kind) + "</span></td>" +
          '<td class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener nofollow">' + esc(p.url.replace(/^https?:\/\//, "").replace(/\/$/, "")) + "</a>" : "—") + "</td>" +
          "<td>" + (p.show !== false ? '<span class="pill pill--ok">展示</span>' : '<span class="pill pill--mute">隐藏</span>') + "</td>" +
          '<td class="num">' + (p.weight || 0) + "</td>" +
          '<td><div class="tbl__acts">' +
          '<button class="row-btn" type="button" data-act="pt:edit" data-id="' + p.id + '">编辑</button>' +
          '<button class="row-btn row-btn--red" type="button" data-act="pt:delete" data-id="' + p.id + '">删除</button>' +
          "</div></td></tr>";
      }).join("");
    });
  };

  function openPartner(id) {
    var p = id ? partnerOf(id) : null;
    var isNew = !p;
    if (!p) p = { name: "", kind: "sponsor", logoUrl: "", url: "", intro: "", weight: 0, show: true };
    UI.openDrawer({
      kicker: isNew ? "新增合作伙伴" : p.kindLabel,
      title: isNew ? "新增合作伙伴" : p.name,
      sub: "名称和类型必填；Logo 建议透明底横版 PNG，没有也可以。",
      body: '<form id="drawerForm" class="dgrid">' +
        field("名称", '<input class="input" name="name" value="' + esc(p.name) + '" maxlength="30" required placeholder="如：义乌市电子商务协会">', "full") +
        field("类型", '<select name="kind">' + opts(KINDS, p.kind) + "</select>") +
        field("首页展示", '<select name="show">' + opts([{ v: "1", t: "展示" }, { v: "0", t: "隐藏" }], p.show === false ? "0" : "1") + "</select>") +
        fileField("Logo", "image", p.logoUrl, "透明底横版效果最好，JPG / PNG / WebP，5MB 以内", "logo") +
        field("官网链接", '<input class="input" name="url" value="' + esc(p.url) + '" maxlength="200" placeholder="https://（可留空）">', "full") +
        field("一句话介绍", '<input class="input" name="intro" value="' + esc(p.intro) + '" maxlength="60" placeholder="可留空，鼠标停在 Logo 上时显示">', "full") +
        field("排序", '<input class="input" type="number" name="weight" min="0" max="999" step="1" value="' + (p.weight || 0) + '">', "", "越大越靠前") +
        "</form>",
      foot: (isNew ? "" : '<button class="row-btn row-btn--red" type="button" data-act="pt:delete" data-id="' + p.id + '">删除</button>') +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-close-drawer>取消</button>' +
        '<button class="btn btn--sm btn--red" type="submit" form="drawerForm" data-ev-save>保存</button>',
      save: function (d) {
        var body = { name: d.name, kind: d.kind, show: d.show !== "0", url: d.url, intro: d.intro, weight: Number(d.weight) || 0 };
        if (d.logo) body.logo = d.logo;
        else if (d.remove_logo) body.logo = "";
        var btn = document.querySelector("[data-ev-save]");
        if (btn) btn.disabled = true;
        req(isNew ? "POST" : "PATCH", isNew ? "/api/admin/partners" : "/api/admin/partners/" + p.id, body).then(function (r) {
          if (btn) btn.disabled = false;
          if (!r.ok) { toast(r.message || "保存失败"); return; }
          UI.closeDrawer();
          toast(isNew ? "已添加，首页刷新即可看到" : "已保存");
          UI.render();
        });
      }
    });
    bindUploads();
  }

  UI.ACTIONS["pt:new"] = function () { openPartner(null); };
  UI.ACTIONS["pt:edit"] = function (id) { openPartner(id); };
  UI.ACTIONS["pt:delete"] = function (id) {
    var p = partnerOf(id);
    if (!p || !window.confirm("删除合作伙伴「" + p.name + "」？首页会立即不再展示。")) return;
    req("DELETE", "/api/admin/partners/" + id).then(function (r) {
      if (!r.ok) { toast(r.message || "删除失败"); return; }
      UI.closeDrawer();
      toast("已删除");
      UI.render();
    });
  };

  /* 登录后台后先取一次活动列表，侧栏「客资」角标显示待联系人数 */
  DB.onSync(function (st) {
    if (st === "loaded") loadEvents();
  });
})();
