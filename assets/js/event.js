/* ==========================================================================
   活动报名页（独立页面：不放平台名称和 Logo，不链到其他页面）
   扫码打开 /e/<slug>：正面海报，点「立即报名」翻到背面填表，提交即成为客资。
   报名表可以留邮箱：报名成功后服务端把邀请函发到这个邮箱（页面上只显示「报名成功」）。
   已登录的会员不用填表：资料从账号带出来，必填项都有就直接「一键报名」，手机号用账号里验证过的。
   /e/<slug>?invite=letter 是邀请函的在线版（邮件里的「在线查看邀请函」也指向这里）；
   /e/<slug>?poster=1 生成用来转发的科技蓝长图海报。图都由 assets/js/invite.js、invite-tech.js 画。
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var root = $("[data-ev]");
  var card = $("[data-card]");
  var front = $("[data-front]");
  var back = $("[data-back]");
  var form = $("[data-form]");
  var submitBtn = $("[data-submit]");
  var ctaBtn = $("[data-flip]");
  var ctaLabel = $("[data-cta-label]");
  var musicBtn = $("[data-music]");
  var audio = $("[data-audio]");
  var toastEl = $("[data-toast]");
  var inviteEl = $("[data-invite]");
  var params = new URLSearchParams(location.search);
  var inviteImg = $("[data-invite-img]");
  var inviteSave = $("[data-invite-save]");
  var isWeChat = /MicroMessenger/i.test(navigator.userAgent);
  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var match = location.pathname.match(/^\/e\/([a-z0-9-]{1,40})\/?$/);
  var slug = match ? match[1] : new URLSearchParams(location.search).get("e") || "";
  var STORE_KEY = "ywai.ev." + slug;
  var MUSIC_KEY = "ywai.ev.music." + slug;
  var ev = null;
  var receipt = loadReceipt();
  var registration = null;
  var flipped = false;
  var member = null;       /* 已登录会员的报名资料：{ phone（打码）, name, email, company } */
  var memberMode = false;  /* 用登录账号报名：手机号不可改，以账号为准 */

  var FIELD_LABEL = { name: "称呼", phone: "手机号", email: "邮箱", company: "公司 / 档口", project: "项目 / 需求" };
  var FIELDS = ["name", "phone", "email", "company", "project", "consent"];
  var EMAIL = /^[^\s@<>()",;:\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
  var STATE_TEXT = {
    open: { cta: "立即报名" },
    closed: { cta: "报名已结束", title: "报名已结束", text: "感谢关注，下次活动见。" },
    deadline: { cta: "报名已截止", title: "报名已截止", text: "这场活动已经截止报名，感谢关注。" },
    full: { cta: "名额已满", title: "名额已满", text: "这场活动名额已满，下次早点来。" },
    draft: { cta: "立即报名（预览）" }
  };
  var ICONS = {
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>',
    place: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"></path></svg>',
    deadline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>'
  };

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 有结束时间：同一天写成 14:00-17:00，跨天写成「至 12月21日（周一）17:00」 */
  function withEnd(text, start, end) {
    if (!text || !end) return text;
    var a = new Date(start + ":00Z");
    var b = new Date(end + ":00Z");
    if (isNaN(b.getTime()) || b <= a) return text;
    var hm = String(b.getUTCHours()).padStart(2, "0") + ":" + String(b.getUTCMinutes()).padStart(2, "0");
    return text + (start.slice(0, 10) === end.slice(0, 10) ? "-" + hm : " 至 " + fmtTime(end));
  }

  function fmtTime(v) {
    if (!v) return "";
    var d = new Date(v + ":00Z");
    if (isNaN(d.getTime())) return "";
    var week = "日一二三四五六".charAt(d.getUTCDay());
    return (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日（周" + week + "）" +
      String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  function loadReceipt() {
    try {
      var value = localStorage.getItem(STORE_KEY);
      if (/^[A-Za-z0-9_-]{43}$/.test(value || "")) return value;
      if (value !== null) localStorage.removeItem(STORE_KEY);
    } catch (e) {}
    return "";
  }

  function saved() { return registration; }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        d.status = r.status;
        return d;
      });
    }, function () {
      return { ok: false, status: 0, message: "网络不太好，请稍后再试" };
    });
  }

  /* ---------------- 翻面 ---------------- */
  function flip(toBack) {
    flipped = toBack;
    card.classList.toggle("is-flipped", toBack);
    /* 看不见的一面不能被 Tab 到，也不会被读屏读出 */
    front.inert = toBack;
    back.inert = !toBack;
    front.setAttribute("aria-hidden", toBack ? "true" : "false");
    back.setAttribute("aria-hidden", toBack ? "false" : "true");
    setTimeout(function () {
      if (toBack) {
        var done = $("[data-done]");
        (done.hidden ? $("[data-title]") : done).focus({ preventScroll: true });
      } else {
        ctaBtn.focus({ preventScroll: true });
      }
    }, 80);
  }

  ctaBtn.addEventListener("click", function () { startMusic(); flip(true); });
  $("[data-unflip]").addEventListener("click", function () { flip(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!inviteEl.hidden) closeInvite();
    else if (flipped) flip(false);
  });

  /* ---------------- 背景音乐 ---------------- */
  var musicWanted = true;
  try { musicWanted = sessionStorage.getItem(MUSIC_KEY) !== "off"; } catch (e) {}

  function paintMusic() {
    var on = !audio.paused;
    musicBtn.setAttribute("aria-pressed", on ? "true" : "false");
    musicBtn.title = on ? "暂停背景音乐" : "播放背景音乐";
  }

  function startMusic() {
    if (!ev || !ev.musicUrl || !musicWanted || !audio.paused) return;
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }

  audio.addEventListener("play", paintMusic);
  audio.addEventListener("pause", paintMusic);

  musicBtn.addEventListener("click", function () {
    if (audio.paused) {
      musicWanted = true;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { toast("音乐暂时无法播放"); });
    } else {
      musicWanted = false;
      audio.pause();
    }
    try { sessionStorage.setItem(MUSIC_KEY, musicWanted ? "on" : "off"); } catch (e) {}
  });

  /* 浏览器不允许有声音乐自动播放：第一次触碰页面时开始；微信里一般可以直接播放 */
  ["pointerdown", "keydown", "touchstart"].forEach(function (type) {
    document.addEventListener(type, function once() {
      startMusic();
      document.removeEventListener(type, once, true);
    }, true);
  });
  document.addEventListener("WeixinJSBridgeReady", startMusic, false);

  var pausedByHide = false;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && !audio.paused) { pausedByHide = true; audio.pause(); }
    else if (!document.hidden && pausedByHide) { pausedByHide = false; startMusic(); }
  });

  /* ---------------- 表单 ---------------- */
  function fieldInput(key) { return form.querySelector('[name="' + key + '"]'); }

  /* 旧活动没有「邮箱」这一项的设置，按不收集处理 */
  function fieldMode(key) { return (ev && ev.fields && ev.fields[key]) || (key === "email" ? "off" : "optional"); }

  function setError(key, msg) {
    var input = fieldInput(key);
    var err = document.getElementById("f-" + key + "-err");
    if (err) err.textContent = msg || "";
    if (input) {
      if (msg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function clearErrors() {
    FIELDS.forEach(function (k) { setError(k, ""); });
    $("[data-form-error]").textContent = "";
  }

  function readForm() {
    return {
      account: memberMode,
      name: fieldInput("name").value.trim(),
      phone: memberMode ? "" : fieldInput("phone").value.replace(/[\s-]/g, ""),
      email: fieldInput("email").value.trim(),
      company: fieldInput("company").value.trim(),
      project: fieldInput("project").value.trim(),
      consent: fieldInput("consent").checked
    };
  }

  function validate(v) {
    var errors = {};
    if (!v.account && !/^1[3-9]\d{9}$/.test(v.phone)) errors.phone = "请输入 11 位手机号";
    ["name", "email", "company", "project"].forEach(function (k) {
      if (ev.fields[k] === "required" && !v[k]) errors[k] = "请填写" + FIELD_LABEL[k];
    });
    if (v.email && !EMAIL.test(v.email)) errors.email = "邮箱格式不正确，例如 name@example.com";
    if (!v.consent) errors.consent = "请先勾选同意，我们才能收集报名信息";
    return errors;
  }

  function showErrors(errors) {
    var first = null;
    FIELDS.forEach(function (k) {
      setError(k, errors[k] || "");
      if (errors[k] && !first) first = fieldInput(k);
    });
    if (first) first.focus();
  }

  fieldInput("phone").addEventListener("input", function () {
    this.value = this.value.replace(/[^\d\s-]/g, "").slice(0, 13);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();
    if (ev.state === "draft") {
      $("[data-form-error]").textContent = "预览模式不能提交。请在后台把活动状态改为「报名中」。";
      return;
    }
    var v = readForm();
    var errors = validate(v);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    submitSignup(v, submitBtn, $("[data-form-error]"));
  });

  function submitSignup(v, btn, errEl) {
    if (btn.disabled) return;
    if (receipt) v.receipt = receipt;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "提交中…";
    api("POST", "/api/events/" + encodeURIComponent(slug) + "/register", v).then(function (r) {
      btn.disabled = false;
      btn.textContent = label;
      if (r.ok) {
        receipt = r.receipt;
        registration = r.registration;
        try { localStorage.setItem(STORE_KEY, receipt); } catch (err) {}
        if (member) ["name", "email", "company"].forEach(function (k) { if (v[k]) member[k] = v[k]; });
        showDone(r.updated, r.mail === "queued" ? v.email : "");
        return;
      }
      if (r.errors) { showMemberCard(false); showErrors(r.errors); return; }
      if (r.error && /^event_/.test(r.error)) {
        ev.state = r.error.replace("event_", "");
        paintState();
        return;
      }
      if (r.status === 401 && v.account) {
        /* 登录过期：退回普通表单，自己填手机号 */
        leaveMemberMode();
        $("[data-form-error]").textContent = r.message || "登录已过期，请填写手机号后提交";
        return;
      }
      errEl.textContent = r.message || "提交失败，请稍后再试";
    });
  }

  /* ---------------- 已登录会员：资料自动带出，一键报名 ---------------- */
  function memberValue(k) { return fieldMode(k) === "off" ? "" : (member && member[k]) || ""; }

  /* 这场活动的必填项是不是都能从账号资料里带出来 */
  function memberComplete() {
    return ["name", "email", "company", "project"].every(function (k) {
      return fieldMode(k) !== "required" || memberValue(k);
    });
  }

  function showMemberCard(on) {
    $("[data-member]").hidden = !on;
    $("[data-fields]").hidden = on;
  }

  function applyMember() {
    var phone = fieldInput("phone");
    phone.value = member.phone;
    phone.readOnly = true;
    phone.required = false;
    $("[data-phone-hint]").hidden = false;
    $("[data-phone-tag]").textContent = "已登录";
    var s = saved() || {};
    ["name", "email", "company"].forEach(function (k) {
      var input = fieldInput(k);
      if (!input.value) input.value = s[k] || memberValue(k);
    });
    $("[data-member-info]").innerHTML = [["称呼", memberValue("name")], ["手机号", member.phone], ["邮箱", memberValue("email")], ["公司 / 档口", memberValue("company")]]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    showMemberCard(memberComplete());
  }

  function leaveMemberMode() {
    memberMode = false;
    var phone = fieldInput("phone");
    phone.readOnly = false;
    phone.required = true;
    phone.value = "";
    $("[data-phone-hint]").hidden = true;
    $("[data-phone-tag]").textContent = "必填";
    showMemberCard(false);
  }

  function loadRegistration() {
    var endpoint = "/api/events/" + encodeURIComponent(slug);
    var guest = receipt
      ? api("POST", endpoint + "/registration", { receipt: receipt })
      : Promise.resolve({});
    return Promise.all([api("GET", endpoint + "/me"), guest]).then(function (results) {
      var account = results[0];
      if (account.ok && account.member) {
        member = account.member;
        memberMode = true;
        registration = account.lead;
      } else if (results[1].ok) {
        registration = results[1].registration;
      }
    });
  }

  $("[data-quick]").addEventListener("click", function () {
    $("[data-quick-error]").textContent = "";
    if (ev.state === "draft") {
      $("[data-quick-error]").textContent = "预览模式不能提交。请在后台把活动状态改为「报名中」。";
      return;
    }
    submitSignup({
      account: true, name: memberValue("name"), email: memberValue("email"), company: memberValue("company"), project: "", consent: true
    }, $("[data-quick]"), $("[data-quick-error]"));
  });

  $("[data-member-edit]").addEventListener("click", function () {
    showMemberCard(false);
    fieldInput(fieldMode("name") === "off" ? "email" : "name").focus();
  });

  /* mailedTo：这次提交后邀请函发往的邮箱（没发就是空） */
  function showDone(updated, mailedTo) {
    var s = saved();
    form.hidden = true;
    $("[data-done]").hidden = false;
    $("[data-done-title]").textContent = updated ? "报名信息已更新" : "报名成功";
    $("[data-done-text]").textContent = (s && s.name ? s.name + "，" : "") +
      "我们已经收到你的报名" + (ev.startAt ? "，" + fmtTime(ev.startAt) + "现场见" : "") + "。";
    var mailed = $("[data-done-mail]");
    mailed.hidden = !mailedTo;
    mailed.textContent = mailedTo ? "活动邀请函正在发往 " + mailedTo + "，几分钟内没收到的话，看看垃圾邮件箱。" : "";
    ctaLabel.textContent = "已报名 · 查看";
    $("[data-done]").focus({ preventScroll: true });
  }

  $("[data-edit]").addEventListener("click", function () {
    var s = saved() || {};
    ["name", "email", "company", "project"].forEach(function (k) { if (s[k]) fieldInput(k).value = s[k]; });
    if (!memberMode && s.phone) fieldInput("phone").value = s.phone;
    showMemberCard(false);
    $("[data-done]").hidden = true;
    form.hidden = false;
    fieldInput(ev.fields.name === "off" ? "phone" : "name").focus();
  });

  $("[data-share]").addEventListener("click", function () {
    var url = ev.url;
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      toast("点右上角「···」发送给朋友");
      return;
    }
    if (navigator.share) {
      navigator.share({ title: ev.title, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("链接已复制"); }, function () { toast(url); });
    } else {
      toast(url);
    }
  });

  /* ---------------- 邀请函在线版 / 长图海报 ---------------- */
  var inviteCanvas = null;
  var inviteKey = "";
  var inviteMode = "letter";
  var inviteFocus = null;
  var closeTimer = null;

  /* 金粉从上往下飘一次 */
  function burst() {
    var fx = $("[data-invite-fx]");
    fx.innerHTML = "";
    if (reduceMotion) return;
    for (var i = 0; i < 28; i++) {
      var p = document.createElement("i");
      p.style.left = (Math.random() * 100).toFixed(1) + "%";
      p.style.animationDelay = (Math.random() * 0.9).toFixed(2) + "s";
      p.style.animationDuration = (2.2 + Math.random() * 1.6).toFixed(2) + "s";
      var size = 4 + Math.random() * 7;
      p.style.width = size.toFixed(1) + "px";
      p.style.height = (size * (0.5 + Math.random())).toFixed(1) + "px";
      fx.appendChild(p);
    }
  }

  /* 读屏文字里说明长图还包含哪些内容 */
  function moreText(data) {
    var a = data.agenda && data.agenda.length;
    var t = data.talks && data.talks.length;
    return a && t ? "，含流程安排和 " + t + " 个议题" : a ? "，含流程安排" : t ? "，含 " + t + " 个议题" : "";
  }

  /* mode：letter 邀请函（和发到邮箱的是同一张）；poster 长图海报 */
  function openInvite(mode) {
    if (!ev || (mode !== "poster" && !ev.invite) || !window.YWInvite) return;
    var data = window.YWInvite.fromEvent(ev, mode);
    var key = JSON.stringify(data);
    var poster = mode === "poster";
    var long = data.style === "tech";
    var touch = isWeChat || matchMedia("(pointer: coarse)").matches;
    inviteMode = mode;
    clearTimeout(closeTimer);
    inviteFocus = document.activeElement;
    $("[data-invite-title]").textContent = poster ? "活动长图海报" : "「" + ev.title + "」邀请函";
    $("[data-invite-hint]").textContent = (touch
      ? (poster ? "长按图片保存，发到群里或朋友圈" : "长按图片保存，发给朋友或朋友圈")
      : "点「" + (poster ? "保存海报" : "保存邀请函") + "」下载高清图片") + (long ? " · 上下滑动看完整长图" : "");
    $("[data-invite-save-label]").textContent = poster ? "保存海报" : "保存邀请函";
    $(".inv__kicker").textContent = poster ? "EVENT POSTER" : "INVITATION";
    inviteEl.classList.toggle("inv--tech", long);
    inviteEl.hidden = false;
    root.inert = true;
    document.documentElement.classList.add("inv-lock");
    requestAnimationFrame(function () { inviteEl.classList.add("is-on"); });
    burst();
    $("[data-invite-title]").focus({ preventScroll: true });

    if (key === inviteKey && inviteCanvas) {
      inviteImg.hidden = false;
      $("[data-invite-loading]").hidden = true;
      inviteSave.disabled = false;
      return;
    }
    inviteImg.hidden = true;
    inviteImg.classList.remove("is-revealed");
    $("[data-invite-card]").scrollTop = 0;
    $("[data-invite-loading]").hidden = false;
    $("[data-invite-loading]").lastChild.textContent = long ? " 正在生成长图…" : " 正在为您烫金…";
    inviteSave.disabled = true;
    window.YWInvite.render(data).then(function (c) {
      inviteCanvas = c;
      inviteKey = key;
      inviteImg.onload = function () {
        $("[data-invite-loading]").hidden = true;
        inviteImg.hidden = false;
        requestAnimationFrame(function () { inviteImg.classList.add("is-revealed"); });
        inviteSave.disabled = false;
      };
      inviteImg.alt = (poster ? "活动海报：「" + ev.title + "」" :
        "邀请函：" + (data.greeting || "尊敬的" + (data.name || data.company || "嘉宾")) + "，诚邀莅临「" + ev.title + "」") +
        (data.timeText ? "，" + data.timeText : "") + (data.place ? "，" + data.place : "") +
        (long ? moreText(data) : "") + "，底部有报名二维码";
      inviteImg.src = c.toDataURL("image/jpeg", long ? 0.9 : 0.92);
    }, function () {
      $("[data-invite-loading]").lastChild.textContent = poster ? " 海报生成失败，请稍后再试" : " 邀请函生成失败，请稍后再试";
    });
  }

  function closeInvite() {
    inviteEl.classList.remove("is-on");
    root.inert = false;
    document.documentElement.classList.remove("inv-lock");
    closeTimer = setTimeout(function () { inviteEl.hidden = true; }, reduceMotion ? 0 : 220);
    if (inviteFocus && inviteFocus.focus) inviteFocus.focus({ preventScroll: true });
  }

  function saveInvite() {
    if (!inviteCanvas) return;
    var what = inviteMode === "poster" ? "海报" : "邀请函";
    if (isWeChat) { toast("长按上面的" + what + "，选择「保存图片」或「发送给朋友」"); return; }
    inviteCanvas.toBlob(function (blob) {
      if (!blob) { toast("保存失败，可以长按图片保存"); return; }
      var name = what + "-" + ev.title.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24) + ".jpg";
      var file = null;
      try { file = new File([blob], name, { type: "image/jpeg" }); } catch (e) {}
      if (file && matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: ev.title + " · " + what }).catch(function () {});
        return;
      }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      toast(what + "已保存");
    }, "image/jpeg", 0.92);
  }

  inviteSave.addEventListener("click", saveInvite);
  $("[data-invite-close]").addEventListener("click", closeInvite);
  inviteEl.addEventListener("click", function (e) {
    if (e.target === inviteEl) closeInvite();
  });

  /* ---------------- 渲染 ---------------- */
  /* 「指导单位」显示成「指导」，「赞助方」显示成「赞助」 */
  function shortLabel(label) { return String(label).replace(/(单位|方)$/, "") || label; }

  function paintOrgs() {
    var el = $("[data-orgs]");
    var groups = Array.isArray(ev.orgs) ? ev.orgs : [];
    var rows = [];
    /* 组织单位里已经写了「主办单位」时，不再单独列主办方 */
    if (ev.host && !groups.some(function (g) { return /主办/.test(g.label); })) rows.push(["主办", [ev.host]]);
    groups.forEach(function (g) { rows.push([shortLabel(g.label), g.names]); });
    el.hidden = !rows.length;
    el.innerHTML = rows.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd>" + r[1].map(esc).join("<i>·</i>") + "</dd></div>";
    }).join("");
  }

  /* 流程安排和议题收在「查看流程与议题」里，不把报名表挤到下面去 */
  function paintMore() {
    var agenda = ev.agenda || [];
    var talks = ev.talks || [];
    $("[data-agenda-wrap]").hidden = !agenda.length;
    $("[data-talks-wrap]").hidden = !talks.length;
    $("[data-agenda]").innerHTML = agenda.map(function (r) {
      return "<li><span>" + esc(r.time || "—") + "</span><b>" + esc(r.item) + "</b></li>";
    }).join("");
    $("[data-talks]").innerHTML = talks.map(function (t, i) {
      var who = [t.speaker, t.role].filter(Boolean).join(" · ");
      return "<li><span>" + String(i + 1).padStart(2, "0") + "</span><div><b>《" + esc(t.title) + "》</b>" +
        (who ? "<small>分享人：" + esc(who) + "</small>" : "") + "</div></li>";
    }).join("");
    $("[data-more]").hidden = !agenda.length && !talks.length;
    $("[data-more-label]").textContent = agenda.length && talks.length ? "查看流程安排和 " + talks.length + " 个议题" :
      agenda.length ? "查看流程安排" : "查看 " + talks.length + " 个议题";
    $("[data-notice]").hidden = !ev.notice;
    $("[data-notice-text]").textContent = ev.notice || "";
  }

  function paintState() {
    var info = STATE_TEXT[ev.state] || STATE_TEXT.closed;
    var s = saved();
    var canSubmit = ev.state === "open" || ev.state === "draft" || (ev.state === "full" && Boolean(s));
    ctaBtn.disabled = false;
    ctaLabel.textContent = s && canSubmit ? "已报名 · 查看" : info.cta;
    $("[data-closed]").hidden = canSubmit;
    if (!canSubmit) {
      form.hidden = true;
      $("[data-done]").hidden = true;
      $("[data-closed-title]").textContent = info.title;
      $("[data-closed-text]").textContent = s ? "你已经报过名了，" + (ev.startAt ? fmtTime(ev.startAt) + "现场见。" : "现场见。") : info.text;
    } else if (s) {
      form.hidden = true;
      $("[data-done]").hidden = false;
      $("[data-done-title]").textContent = "你已报名";
      $("[data-done-text]").textContent = (s.name ? s.name + "，" : "") + "报名信息已经提交" + (ev.startAt ? "，" + fmtTime(ev.startAt) + "现场见" : "") + "。";
    }
  }

  /* 同意书和个人信息说明里写主办方的名字；页面上不出现平台名称，也不链到别的页面 */
  function paintOrgName() {
    var org = String(ev.host || "").trim() || "主办方";
    Array.prototype.forEach.call(document.querySelectorAll("[data-org-name]"), function (el) { el.textContent = org; });
    $("[data-privacy-contact]").textContent = ev.contact ? "（报名咨询：" + ev.contact + "）" : "";
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-privacy-open]"), function (b) {
    b.addEventListener("click", function () {
      var box = $("[data-privacy]");
      box.open = true;
      box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });

  function render() {
    document.title = ev.title + " · 活动报名";
    paintOrgName();
    root.dataset.state = "ready";
    $("[data-preview]").hidden = ev.state !== "draft";

    if (ev.posterUrl) {
      var img = $("[data-poster]");
      img.src = ev.posterUrl;
      img.alt = ev.title + " 活动海报";
      img.hidden = false;
      $("[data-cover]").hidden = true;
      $("[data-bg]").style.backgroundImage = "url(" + JSON.stringify(ev.posterUrl) + ")";
    } else {
      $("[data-cover-title]").textContent = ev.title;
      $("[data-cover-sub]").textContent = ev.subtitle || "";
      $("[data-cover-meta]").textContent = [withEnd(fmtTime(ev.startAt), ev.startAt, ev.endAt), ev.place].filter(Boolean).join("\n");
    }

    $("[data-title]").textContent = ev.title;
    var meta = [];
    if (ev.startAt) meta.push(ICONS.time + "<span>" + esc(withEnd(fmtTime(ev.startAt), ev.startAt, ev.endAt)) + "</span>");
    if (ev.place) meta.push(ICONS.place + "<span>" + esc(ev.place) + "</span>");
    if (ev.deadline) meta.push(ICONS.deadline + "<span>报名截止 " + esc(fmtTime(ev.deadline)) + "</span>");
    if (ev.contact) meta.push(ICONS.phone + "<span>报名咨询 " + esc(ev.contact) + "</span>");
    $("[data-meta]").innerHTML = meta.map(function (m) { return "<li>" + m + "</li>"; }).join("");
    if (ev.intro) { $("[data-intro]").textContent = ev.intro; $("[data-intro]").hidden = false; }
    paintOrgs();
    paintMore();

    ["name", "email", "company", "project"].forEach(function (k) {
      var mode = fieldMode(k);
      var wrap = form.querySelector('[data-field="' + k + '"]');
      wrap.hidden = mode === "off";
      var input = fieldInput(k);
      input.required = mode === "required";
      var mark = wrap.querySelector("[data-mark]");
      mark.textContent = mode === "required" ? "必填" : "选填";
      mark.classList.toggle("ev__tag--req", mode === "required");
    });

    if (ev.musicUrl) {
      audio.src = ev.musicUrl;
      musicBtn.hidden = false;
      paintMusic();
      startMusic();
    }
    if (member) applyMember();
    paintState();
    $("[data-email-hint]").hidden = !ev.mailInvite;
    if (params.get("poster")) openInvite("poster");
    else if (ev.invite && params.get("invite")) openInvite("letter");
  }

  function missing() {
    root.dataset.state = "missing";
    $("[data-missing]").hidden = false;
    document.title = "活动不存在";
  }

  front.inert = false;
  back.inert = true;
  back.setAttribute("aria-hidden", "true");

  if (!slug) { missing(); return; }
  api("GET", "/api/events/" + encodeURIComponent(slug)).then(function (r) {
    if (!r.ok || !r.event) { missing(); return; }
    ev = r.event;
    if (ev.state === "draft") render();
    else loadRegistration().then(render);
  });
})();
