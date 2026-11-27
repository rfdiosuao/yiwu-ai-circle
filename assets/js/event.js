/* ==========================================================================
   义乌AI圈 · 活动报名页
   扫码打开 /e/<slug>：正面海报，点「立即报名」翻到背面填表，提交即成为客资。
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

  var match = location.pathname.match(/^\/e\/([a-z0-9-]{1,40})\/?$/);
  var slug = match ? match[1] : new URLSearchParams(location.search).get("e") || "";
  var STORE_KEY = "ywai.ev." + slug;
  var MUSIC_KEY = "ywai.ev.music." + slug;
  var ev = null;
  var flipped = false;

  var FIELD_LABEL = { name: "称呼", phone: "手机号", company: "公司 / 档口", project: "项目 / 需求" };
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
    deadline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>'
  };

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var week = "日一二三四五六".charAt(d.getDay());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日（周" + week + "）" +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }

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
    if (e.key === "Escape" && flipped) flip(false);
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
    ["name", "phone", "company", "project", "consent"].forEach(function (k) { setError(k, ""); });
    $("[data-form-error]").textContent = "";
  }

  function readForm() {
    return {
      name: fieldInput("name").value.trim(),
      phone: fieldInput("phone").value.replace(/[\s-]/g, ""),
      company: fieldInput("company").value.trim(),
      project: fieldInput("project").value.trim(),
      consent: fieldInput("consent").checked
    };
  }

  function validate(v) {
    var errors = {};
    if (!/^1[3-9]\d{9}$/.test(v.phone)) errors.phone = "请输入 11 位手机号";
    ["name", "company", "project"].forEach(function (k) {
      if (ev.fields[k] === "required" && !v[k]) errors[k] = "请填写" + FIELD_LABEL[k];
    });
    if (!v.consent) errors.consent = "请先勾选同意，我们才能收集报名信息";
    return errors;
  }

  function showErrors(errors) {
    var first = null;
    ["name", "phone", "company", "project", "consent"].forEach(function (k) {
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

    submitBtn.disabled = true;
    submitBtn.textContent = "提交中…";
    api("POST", "/api/events/" + encodeURIComponent(slug) + "/register", v).then(function (r) {
      submitBtn.disabled = false;
      submitBtn.textContent = "提交报名";
      if (r.ok) {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ name: v.name, phone: v.phone, company: v.company, project: v.project, at: Date.now() }));
        } catch (err) {}
        showDone(r.updated);
        return;
      }
      if (r.errors) { showErrors(r.errors); return; }
      if (r.error && /^event_/.test(r.error)) {
        ev.state = r.error.replace("event_", "");
        paintState();
        return;
      }
      $("[data-form-error]").textContent = r.message || "提交失败，请稍后再试";
    });
  });

  function showDone(updated) {
    var s = saved();
    form.hidden = true;
    $("[data-done]").hidden = false;
    $("[data-done-title]").textContent = updated ? "报名信息已更新" : "报名成功";
    $("[data-done-text]").textContent = (s && s.name ? s.name + "，" : "") +
      "我们已经收到你的报名" + (ev.startAt ? "，" + fmtTime(ev.startAt) + "现场见" : "") + "。";
    ctaLabel.textContent = "已报名 · 查看";
    $("[data-done]").focus({ preventScroll: true });
  }

  $("[data-edit]").addEventListener("click", function () {
    var s = saved() || {};
    ["name", "phone", "company", "project"].forEach(function (k) { if (s[k]) fieldInput(k).value = s[k]; });
    $("[data-done]").hidden = true;
    form.hidden = false;
    fieldInput(ev.fields.name === "off" ? "phone" : "name").focus();
  });

  $("[data-share]").addEventListener("click", function () {
    var url = location.origin + "/e/" + slug;
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

  /* ---------------- 渲染 ---------------- */
  function paintState() {
    var info = STATE_TEXT[ev.state] || STATE_TEXT.closed;
    var s = saved();
    var canSubmit = ev.state === "open" || ev.state === "draft";
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

  function render() {
    document.title = ev.title + " · 活动报名";
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
      $("[data-cover-meta]").textContent = [fmtTime(ev.startAt), ev.place].filter(Boolean).join("\n");
    }

    $("[data-title]").textContent = ev.title;
    var meta = [];
    if (ev.startAt) meta.push(ICONS.time + "<span>" + esc(fmtTime(ev.startAt)) + "</span>");
    if (ev.place) meta.push(ICONS.place + "<span>" + esc(ev.place) + "</span>");
    if (ev.deadline) meta.push(ICONS.deadline + "<span>报名截止 " + esc(fmtTime(ev.deadline)) + "</span>");
    $("[data-meta]").innerHTML = meta.map(function (m) { return "<li>" + m + "</li>"; }).join("");
    if (ev.intro) { $("[data-intro]").textContent = ev.intro; $("[data-intro]").hidden = false; }

    ["name", "company", "project"].forEach(function (k) {
      var mode = ev.fields[k] || "optional";
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
    paintState();
  }

  function missing() {
    root.dataset.state = "missing";
    $("[data-missing]").hidden = false;
    document.title = "活动不存在 · 义乌AI圈";
  }

  front.inert = false;
  back.inert = true;
  back.setAttribute("aria-hidden", "true");

  if (!slug) { missing(); return; }
  api("GET", "/api/events/" + encodeURIComponent(slug)).then(function (r) {
    if (!r.ok || !r.event) { missing(); return; }
    ev = r.event;
    render();
  });
})();
