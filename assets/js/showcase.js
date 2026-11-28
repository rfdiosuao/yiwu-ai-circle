/* ==========================================================================
   义乌AI圈 · 首页「近期活动」「合作伙伴」与活动页（events.html）
   数据来自 /api/events 与 /api/partners，都由运营后台维护。
   ========================================================================== */
(function () {
  "use strict";

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var STATE = { open: "报名中", full: "名额已满", deadline: "报名截止", closed: "已结束" };
  var GO = { open: "立即报名 →", full: "查看活动 →", deadline: "查看活动 →", closed: "查看活动 →" };
  var PLACE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>';

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getJSON(url) {
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function fmtDate(v) {
    if (!v) return "时间待定";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "时间待定";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + "日一二三四五六".charAt(d.getDay()) + " " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------------- 活动卡片 ---------------- */
  function evCard(e, past) {
    /* 卡片上只放主办方和第一类组织单位（通常是赞助方），完整名单在报名页 */
    var groups = Array.isArray(e.orgs) ? e.orgs : [];
    var org = [];
    if (e.host) org.push("<b>主办</b>" + esc(e.host));
    var first = groups.filter(function (g) { return !/主办/.test(g.label); })[0];
    if (first) org.push("<b>" + esc(first.label.replace(/(单位|方)$/, "") || first.label) + "</b>" + esc(first.names.slice(0, 3).join("、")) + (first.names.length > 3 ? " 等" : ""));
    var state = past ? "closed" : e.state;
    return '<a class="evcard' + (past ? " evcard--past" : "") + '" href="/e/' + encodeURIComponent(e.slug) + '">' +
      '<div class="evcard__media">' +
      (e.posterUrl
        ? '<img src="' + esc(e.posterUrl) + '" alt="" loading="lazy">'
        : '<div class="evcard__cover"><b>' + esc(e.title) + "</b><span>" + esc(e.subtitle || "义乌AI圈 · 线下活动") + "</span></div>") +
      '<span class="evcard__state' + (state === "open" ? " evcard__state--open" : "") + '">' + (STATE[state] || "已结束") + "</span>" +
      "</div>" +
      '<div class="evcard__body">' +
      '<span class="evcard__date">' + esc(fmtDate(e.startAt)) + "</span>" +
      "<h3>" + esc(e.title) + "</h3>" +
      (e.subtitle ? '<p class="evcard__sub">' + esc(e.subtitle) + "</p>" : "") +
      (e.place ? '<p class="evcard__place">' + PLACE_ICON + "<span>" + esc(e.place) + "</span></p>" : "") +
      (org.length ? '<p class="evcard__orgs">' + org.join("　") + "</p>" : "") +
      '<span class="evcard__go">' + (GO[state] || GO.closed) + "</span>" +
      "</div></a>";
  }

  var homeEvents = document.querySelector("[data-home-events]");
  var board = document.querySelector("[data-events-board]");
  var partnersSec = document.querySelector("[data-partners]");

  if (homeEvents || board) {
    getJSON("/api/events").then(function (r) {
      var upcoming = (r && r.upcoming) || [];
      var past = (r && r.past) || [];
      if (homeEvents) {
        if (upcoming.length) {
          homeEvents.querySelector("[data-home-events-list]").innerHTML = upcoming.slice(0, 3).map(function (e) { return evCard(e, false); }).join("");
          homeEvents.hidden = false;
        } else if (partnersSec) {
          /* 没有近期活动就不显示这一节，后面的板块编号顺延 */
          var idx = partnersSec.querySelector("[data-sec-idx]");
          if (idx) idx.textContent = "06";
        }
      }
      if (board) {
        var up = board.querySelector("[data-events-upcoming]");
        var old = board.querySelector("[data-events-past]");
        up.innerHTML = upcoming.length
          ? '<div class="evgrid">' + upcoming.map(function (e) { return evCard(e, false); }).join("") + "</div>"
          : '<div class="evempty"><strong>近期暂无活动</strong>新活动发布后会第一时间出现在这里，也会在社区里通知。</div>';
        board.querySelector("[data-events-count]").textContent = upcoming.length;
        if (past.length) {
          old.innerHTML = '<div class="evgrid">' + past.map(function (e) { return evCard(e, true); }).join("") + "</div>";
          old.closest(".evboard__sec").hidden = false;
        }
      }
    });
  }

  /* ---------------- 合作伙伴：两排左右滚动 ---------------- */
  if (!partnersSec) return;

  var toggle = partnersSec.querySelector("[data-marquee-toggle]");
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 5.5v13l10-6.5z"></path></svg>';
  var paused = false;
  try { paused = localStorage.getItem("ywai.partners.paused") === "1"; } catch (e) {}

  function paintToggle() {
    partnersSec.classList.toggle("is-paused", paused);
    toggle.innerHTML = (paused ? PLAY : PAUSE) + "<span>" + (paused ? "继续滚动" : "暂停滚动") + "</span>";
    toggle.setAttribute("aria-pressed", paused ? "true" : "false");
  }
  toggle.addEventListener("click", function () {
    paused = !paused;
    try { localStorage.setItem("ywai.partners.paused", paused ? "1" : "0"); } catch (e) {}
    paintToggle();
  });

  function mark(p, clone) {
    var tag = p.url ? "a" : "div";
    var attrs = p.url ? ' href="' + esc(p.url) + '" target="_blank" rel="noopener nofollow"' : "";
    if (clone) attrs += ' data-clone aria-hidden="true"' + (p.url ? ' tabindex="-1"' : "");
    if (p.intro) attrs += ' title="' + esc(p.name + "：" + p.intro) + '"';
    var inner = p.logoUrl
      ? '<img src="' + esc(p.logoUrl) + '" alt="' + esc(p.name) + '" loading="lazy">'
      : '<span class="pmark__word">' + esc(p.name) + "</span>";
    if (p.kind === "supporter") inner += "<em>支持</em>";
    return "<" + tag + ' class="pmark"' + attrs + ">" + inner + "</" + tag + ">";
  }

  var rows = [];

  /* 第一组是给读屏和键盘用的真实列表；后面重复的只为让滚动首尾相接，对辅助技术隐藏 */
  function build(row) {
    var list = row.items;
    var vp = row.el.querySelector(".marquee__viewport");
    var track = row.el.querySelector(".marquee__track");
    track.innerHTML = '<ul class="marquee__group" role="list">' +
      list.map(function (p) { return "<li>" + mark(p, false) + "</li>"; }).join("") + "</ul>";
    if (reduce) return;
    var group = track.firstChild;
    /* 名单太短填不满一行时，在同一组里重复几遍，保证循环时不露空 */
    var one = group.scrollWidth || 1;
    var repeat = Math.max(1, Math.ceil((vp.clientWidth + 40) / one));
    var copies = function (n) {
      var html = "";
      for (var i = 0; i < n; i++) html += list.map(function (p) { return mark(p, true); }).join("");
      return html;
    };
    if (repeat > 1) {
      group.insertAdjacentHTML("beforeend", '<li aria-hidden="true" class="marquee__more">' + copies(repeat - 1) + "</li>");
    }
    track.insertAdjacentHTML("beforeend", '<div class="marquee__group" aria-hidden="true" data-clone>' + copies(repeat) + "</div>");
    /* 每秒走约 40px，名单越长一圈越久，速度保持一致 */
    track.style.setProperty("--dur", Math.max(18, Math.round(group.scrollWidth / 40)) + "s");
  }

  getJSON("/api/partners").then(function (r) {
    var list = (r && r.partners) || [];
    if (!list.length) {
      partnersSec.querySelector("[data-partners-empty]").hidden = false;
      return;
    }
    var groups = {
      sponsor: list.filter(function (p) { return p.kind === "sponsor"; }),
      other: list.filter(function (p) { return p.kind !== "sponsor"; })
    };
    Object.keys(groups).forEach(function (k) {
      var el = partnersSec.querySelector('[data-prow="' + k + '"]');
      if (!el || !groups[k].length) return;
      el.hidden = false;
      rows.push({ el: el, items: groups[k] });
    });
    rows.forEach(build);
    if (!reduce) { toggle.hidden = false; paintToggle(); }

    var lastW = window.innerWidth;
    var timer = null;
    window.addEventListener("resize", function () {
      if (Math.abs(window.innerWidth - lastW) < 40) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(function () { rows.forEach(build); }, 200);
    });
  });
})();
