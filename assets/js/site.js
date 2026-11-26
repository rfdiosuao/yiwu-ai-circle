/* ==========================================================================
   义乌AI圈 — site interactions
   ========================================================================== */
(function () {
  "use strict";

  var A = window.YW.auth;
  var U = window.YW.ui;

  /* ---------------- reveal on scroll ---------------- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    Array.prototype.forEach.call(revealEls, function (el, i) {
      el.style.transitionDelay = Math.min(i % 4, 3) * 70 + "ms";
      io.observe(el);
    });
  } else {
    Array.prototype.forEach.call(revealEls, function (el) { el.classList.add("is-in"); });
  }

  /* ---------------- counters ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll("[data-count]"), function (el) {
    var target = Number(el.dataset.count);
    if (!target) return;
    var dur = 1100;
    var start = null;
    function tick(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(target * eased);
      el.textContent = val.toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  /* ---------------- active nav ---------------- */
  var page = document.body.dataset.page;
  if (page) {
    var link = document.querySelector('.nav a[data-nav="' + page + '"]');
    if (link) link.classList.add("is-active");
  }

  /* ---------------- helpers ---------------- */
  function fmtTime(ts) {
    var d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "刚刚";
    if (d < 3600) return Math.floor(d / 60) + " 分钟前";
    if (d < 86400) return Math.floor(d / 3600) + " 小时前";
    return Math.floor(d / 86400) + " 天前";
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initials(name) {
    return (name || "义").trim().slice(0, 1);
  }

  /* ======================================================================
     SITE DATA（运营后台配置的商家、AI 工具与站点开关）
     ====================================================================== */
  var sitePromise = A.api("GET", "/api/site").then(function (r) { return r && r.ok ? r : null; });

  var PLATFORM_KEY = { "全平台": "all", "TikTok Shop": "tiktok", "亚马逊": "amazon", "独立站": "indie", "1688": "1688" };
  var BILLING_LABEL = { monthly: "Monthly · 按月", yearly: "Yearly · 按年", "per-unit": "Per unit · 按次", free: "Free · 免费" };
  var LEVEL_LABEL = { diamond: "钻石商家", gold: "金牌商家", normal: "认证商家" };

  function dictLabel(list, v) {
    var hit = (list || []).filter(function (x) { return x.v === v; })[0];
    return hit ? hit.t : v;
  }

  function priceText(p, short) {
    if (p.price === null || p.price === undefined) return "登录可见";
    if (!p.price) return "免费";
    return "¥" + p.price + (short ? "" : " <u>/ " + escapeHTML(p.unit || "") + "</u>");
  }

  function goodCard(p, i, site) {
    var plat = PLATFORM_KEY[p.platform] || "all";
    return '<article class="good" data-cat="' + escapeHTML(p.cat) + '" data-platform="' + plat + '" data-price="' + (Number(p.price) || 0) +
      '" data-order="' + i + '" data-name="' + escapeHTML((p.name + " " + (p.desc || "") + " " + (p.vendor || "")).toLowerCase()) + '">' +
      '<div class="good__media good__media--type"><span class="good__no">' + escapeHTML(p.id) + "</span>" +
      '<span class="good__big">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<span class="good__glyph">' + escapeHTML((p.name || "工").slice(0, 1)) + "</span>" +
      (p.badge ? '<span class="good__flag">' + escapeHTML(p.badge) + "</span>" : "") + "</div>" +
      '<div class="good__body"><div class="good__cat"><span>' + escapeHTML(dictLabel(site.dicts.cats, p.cat)) + "</span><span>" + escapeHTML(p.platform || "") + "</span></div>" +
      "<h3>" + escapeHTML(p.name) + "</h3>" +
      '<p class="good__desc">' + escapeHTML(p.desc || "") + "</p>" +
      '<div class="good__specs">' +
      '<div class="good__spec"><span>交付</span><b>' + escapeHTML(p.delivery || "—") + "</b></div>" +
      '<div class="good__spec"><span>语言</span><b>' + escapeHTML(p.langs || "—") + "</b></div>" +
      '<div class="good__spec"><span>试用</span><b>' + (p.trial ? p.trial + " 天" : "—") + "</b></div></div>" +
      '<div class="good__foot"><div class="price"><small>' + escapeHTML(BILLING_LABEL[p.billing] || "") + "</small><b>" + priceText(p) + "</b></div>" +
      '<button class="btn btn--sm btn--red" type="button" data-apply="' + escapeHTML(p.name) + '">' + (p.billing === "free" ? "申请内测" : "申请对接") + "</button></div>" +
      (p.vendor ? '<div class="good__vendor" style="margin-top:10px">' + escapeHTML(p.vendor) + " · 已认证商家</div>" : "") +
      "</div></article>";
  }

  function merchantCard(m, site) {
    return '<article class="merchant" data-zone="' + escapeHTML(m.zone) + '" data-id="' + escapeHTML(m.id) + '">' +
      '<div class="merchant__stall"><span class="mono">铺位号</span><b>' + escapeHTML(m.stall || "—") + "</b><span>" +
      escapeHTML(dictLabel(site.dicts.zones, m.zone)) + "</span></div>" +
      '<div class="merchant__main"><h3>' + escapeHTML(m.name) + (m.verified ? ' <span class="verified">已认证</span>' : "") + "</h3>" +
      '<p class="merchant__desc">' + escapeHTML(m.intro || "") + "</p>" +
      '<div class="merchant__tags">' + (m.tags || []).map(function (t) { return '<span class="tag">' + escapeHTML(t) + "</span>"; }).join("") + "</div>" +
      '<div class="merchant__stats"><span>起订 <b>' + escapeHTML(m.minOrder || "—") + "</b></span><span>时效 <b>" + escapeHTML(m.leadTime || "—") +
      "</b></span><span>营业 <b>" + escapeHTML(m.hours || "—") + "</b></span></div></div>" +
      '<div class="merchant__act"><button class="btn btn--sm btn--ink" type="button" data-contact data-mid="' + escapeHTML(m.id) +
      '" data-name="' + escapeHTML(m.name) + '" data-zone-name="' + escapeHTML((m.zoneName || "") + " " + (m.stall || "")) + '">查看联系方式</button>' +
      '<span class="mono" style="color:var(--ink-40)">' + escapeHTML(LEVEL_LABEL[m.level] || "认证商家") + "</span></div></article>";
  }

  sitePromise.then(function (site) {
    if (!site) return;
    var st = site.settings || {};
    var t = st.toggles || {};

    document.documentElement.classList.toggle("no-comment", t.comment === false);
    if (t.merchantApply === false) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-join], a[href^="certify.html"]'), function (el) {
        var li = el.closest("li");
        (li || el).hidden = true;
      });
    }
    if (st.siteName && st.siteName !== "义乌AI圈") document.title = document.title.replace("义乌AI圈", st.siteName);

    /* 自定义滚动公告：插在两段循环内容的末尾，保证无缝滚动 */
    var track = document.querySelector(".ticker__track");
    if (track && st.ticker && st.ticker.length) {
      var items = track.querySelectorAll(".ticker__item");
      var half = Math.floor(items.length / 2);
      var extra = st.ticker.map(function (x) {
        return '<span class="ticker__item"><i class="dot"></i>' + escapeHTML(x) + "</span>";
      }).join("");
      if (items[half]) items[half].insertAdjacentHTML("beforebegin", extra);
      track.insertAdjacentHTML("beforeend", extra);
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-stat="products"]'), function (el) {
      el.textContent = site.products.length;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-stat="cats"]'), function (el) {
      var seen = {};
      site.products.forEach(function (p) { seen[p.cat] = 1; });
      el.textContent = Object.keys(seen).length;
    });

    /* 首页：商家名录与 AI 工具预览 */
    var homeDir = document.querySelector("[data-home-merchants]");
    if (homeDir && site.merchants.length) {
      homeDir.innerHTML = site.merchants.slice(0, 5).map(function (m) {
        return '<a class="dir-row" href="merchants.html"><div class="dir-row__stall">' + escapeHTML(m.stall || "—") +
          "<span>" + escapeHTML(dictLabel(site.dicts.zones, m.zone)) + "</span></div>" +
          '<div class="dir-row__name">' + escapeHTML(m.name) + (m.verified ? ' <span class="verified">认证</span>' : "") + "</div>" +
          '<div class="dir-row__tags">' + (m.tags || []).slice(0, 3).map(function (x) { return '<span class="tag">' + escapeHTML(x) + "</span>"; }).join("") + "</div>" +
          '<div class="dir-row__loc">' + escapeHTML(m.zoneName || "") + "</div>" +
          '<div class="dir-row__loc">' + escapeHTML(m.leadTime || "") + "</div>" +
          '<span class="dir-row__go">→</span></a>';
      }).join("");
    }
    var homeShelf = document.querySelector("[data-home-products]");
    if (homeShelf && site.products.length) {
      homeShelf.innerHTML = site.products.slice(0, 4).map(function (p) {
        return '<a class="smini" href="products.html"><div class="smini__body"><div class="smini__cat">' +
          escapeHTML(dictLabel(site.dicts.cats, p.cat)) + " · " + escapeHTML(p.id) + "</div>" +
          "<h4>" + escapeHTML(p.name) + "</h4><p>" + escapeHTML(p.desc || "") + "</p></div>" +
          '<div class="smini__price"><b>' + priceText(p, true) + "</b><span>" +
          (p.price ? "每" + escapeHTML(p.unit || "") : p.price === 0 ? "内测" : "") + "</span></div></a>";
      }).join("");
    }
  });

  /* ======================================================================
     POSTS
     ====================================================================== */
  var feed = document.querySelector("[data-feed]");

  if (feed) {
    var seqCounter = 100000;
    Array.prototype.forEach.call(feed.querySelectorAll(".post"), function (p) {
      p.dataset.seq = String(seqCounter--);
    });

    /* 点赞 / 收藏 / 评论都存在服务端：/api/posts */
    var reactions = {};   // postId -> { likes, marks, liked, marked }
    var commentsStore = {}; // postId -> [{ name, text, at }]
    var TONE_CLASS = ["", "avatar--red", "avatar--teal", "avatar--gold"];

    function paintActs(postEl) {
      var id = postEl.dataset.post;
      var state = reactions[id] || {};
      var likeBtn = postEl.querySelector('[data-act="like"]');
      var markBtn = postEl.querySelector('[data-act="mark"]');
      if (likeBtn) {
        var base = Number(likeBtn.dataset.base) || 0;
        likeBtn.classList.toggle("is-on", !!state.liked);
        likeBtn.setAttribute("aria-pressed", state.liked ? "true" : "false");
        var span = likeBtn.querySelector("[data-n]");
        if (span) span.textContent = base + (state.likes || 0);
      }
      if (markBtn) {
        var mb = Number(markBtn.dataset.base) || 0;
        markBtn.classList.toggle("is-on", !!state.marked);
        markBtn.setAttribute("aria-pressed", state.marked ? "true" : "false");
        var ms = markBtn.querySelector("[data-n]");
        if (ms) ms.textContent = mb + (state.marks || 0);
      }
    }

    function paintComments(postEl) {
      var id = postEl.dataset.post;
      var box = postEl.querySelector(".post__comments");
      if (!box) return;
      var list = commentsStore[id] || [];
      var html = list.map(function (c) {
        return '<div class="cmt"><b>' + escapeHTML(c.name) +
          "<span>" + escapeHTML(typeof c.at === "number" ? fmtTime(c.at) : c.at) + "</span></b><p>" + escapeHTML(c.text) + "</p></div>";
      }).join("");
      var old = box.querySelectorAll(".cmt");
      Array.prototype.forEach.call(old, function (n) { n.remove(); });
      var form = box.querySelector(".cmt-form");
      if (form) form.insertAdjacentHTML("beforebegin", html);
      else box.insertAdjacentHTML("afterbegin", html);
      var countBtn = postEl.querySelector('[data-act="comment"]');
      var count = countBtn ? countBtn.querySelector("[data-n]") : null;
      if (count && countBtn) {
        count.textContent = list.length + (Number(countBtn.dataset.base) || 0);
      }
    }

    function buildPost(data) {
      var node = document.createElement("article");
      var fresh = Date.now() - data.at < 60 * 1000;
      node.className = "post is-fresh";
      node.dataset.post = data.id;
      node.dataset.tag = data.tag;
      node.dataset.seq = data.seq || "999999";
      node.innerHTML =
        '<div class="post__head">' +
        '<span class="avatar ' + (TONE_CLASS[data.tone] || "avatar--red") + '">' + escapeHTML(initials(data.name)) + "</span>" +
        '<div class="post__who"><strong>' +
        (data.hasProfile && data.uid
          ? '<a href="profile.html?id=' + encodeURIComponent(data.uid) + '" title="查看 ' + escapeHTML(data.name) + ' 的主页">' + escapeHTML(data.name || "圈友") + "</a>"
          : escapeHTML(data.name || "圈友")) +
        ' <span class="tag tag--red">' + (fresh ? "刚刚发布" : "圈友发帖") + "</span></strong>" +
        "<span>义乌 · " + escapeHTML(data.tag) + " · " + escapeHTML(fmtTime(data.at)) + "</span></div></div>" +
        '<div class="post__title">' + escapeHTML(data.title) + "</div>" +
        '<p class="post__body">' + escapeHTML(data.body || "") + "</p>" +
        '<div class="post__foot">' +
        '<button class="act" type="button" data-act="like" data-base="0">♡ 赞 <span data-n>0</span></button>' +
        '<button class="act" type="button" data-act="comment" data-base="0">◌ 评论 <span data-n>0</span></button>' +
        '<button class="act" type="button" data-act="mark" data-base="0">◇ 收藏 <span data-n>0</span></button>' +
        (data.mine ? '<button class="act act--danger" type="button" data-act="delete" style="margin-left:auto">删除</button>' : '<span class="tag" style="margin-left:auto">' + escapeHTML(data.tag) + "</span>") + "</div>" +
        '<div class="post__comments"><div class="cmt-form">' +
        '<input type="text" placeholder="写下你的回应…" maxlength="120" aria-label="评论内容">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-cmt-send>发送</button>' +
        "</div></div>";
      return node;
    }

    function isMine(p) {
      var me = A.getSession();
      return !!(me && me.userId && p.uid === me.userId);
    }

    function loadFeed() {
      return A.api("GET", "/api/posts").then(function (r) {
        if (!r.ok) return;
        reactions = r.reactions || {};
        commentsStore = r.comments || {};
        Array.prototype.forEach.call(feed.querySelectorAll(".post[data-server]"), function (n) { n.remove(); });
        (r.posts || []).slice().reverse().forEach(function (p) {
          p.mine = isMine(p);
          var el = buildPost(p);
          el.dataset.server = "1";
          el.dataset.seq = String(200000 + Math.floor(p.at / 1000));
          if (Date.now() - p.at > 60 * 1000) el.classList.remove("is-fresh");
          feed.insertBefore(el, feed.firstElementChild);
        });
        Array.prototype.forEach.call(feed.querySelectorAll(".post"), function (postEl) {
          paintActs(postEl);
          paintComments(postEl);
        });
        syncFeedCount();
        var active = document.querySelector("[data-filter-tag].is-on");
        if (active) active.click();
      });
    }

    function syncFeedCount() {
      var el = document.querySelector("[data-feed-count]");
      if (el) el.textContent = feed.querySelectorAll(".post").length;
    }
    syncFeedCount();
    loadFeed();
    A.onChange(function () { loadFeed(); });

    feed.addEventListener("click", function (e) {
      var postEl = e.target.closest(".post");
      if (!postEl) return;
      var id = postEl.dataset.post;

      var act = e.target.closest("[data-act]");
      if (act) {
        var kind = act.dataset.act;
        if (kind === "comment") {
          var box = postEl.querySelector(".post__comments");
          if (box) {
            box.classList.toggle("is-open");
            if (box.classList.contains("is-open")) {
              var field = box.querySelector("input");
              if (field) setTimeout(function () { field.focus(); }, 60);
            }
          }
          return;
        }
        if (kind === "delete") {
          if (!window.confirm("确定删除这条帖子吗？删除后无法恢复。")) return;
          A.api("DELETE", "/api/posts/" + encodeURIComponent(id)).then(function (r) {
            if (!r.ok) { U.toast(r.msg || "删除失败"); return; }
            postEl.remove();
            syncFeedCount();
            paintLiveStats();
            U.toast("帖子已删除");
          });
          return;
        }
        A.requireAuth("参与互动需要先登录，用手机号 10 秒入场。", function () {
          act.disabled = true;
          A.api("POST", "/api/posts/" + encodeURIComponent(id) + "/react", { kind: kind }).then(function (r) {
            act.disabled = false;
            if (!r.ok) { U.toast(r.msg || "操作失败，请重试"); return; }
            reactions[id] = { likes: r.likes, marks: r.marks, liked: r.liked, marked: r.marked };
            if (kind === "mark") U.toast(r.marked ? "已收藏这条帖子" : "已取消收藏");
            paintActs(postEl);
          });
        });
        return;
      }

      var send = e.target.closest("[data-cmt-send]");
      if (send) {
        var input = postEl.querySelector(".cmt-form input");
        var text = input ? input.value.trim() : "";
        if (!text) return;
        A.requireAuth("发评论前先登录一下。", function () {
          send.disabled = true;
          A.api("POST", "/api/posts/" + encodeURIComponent(id) + "/comments", { text: text }).then(function (r) {
            send.disabled = false;
            if (!r.ok) { U.toast(r.msg || "评论失败，请重试"); return; }
            var list = commentsStore[id] || (commentsStore[id] = []);
            list.unshift(r.comment);
            paintComments(postEl);
            if (input) input.value = "";
            U.toast("评论已发布");
          });
        });
      }
    });

    feed.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var input = e.target.closest(".cmt-form input");
      if (!input) return;
      e.preventDefault();
      var btn = input.parentElement.querySelector("[data-cmt-send]");
      if (btn) btn.click();
    });

    /* -------- composer -------- */
    var composer = document.querySelector("[data-composer]");
    if (composer) {
      var text = composer.querySelector("[data-composer-text]");
      var counter = composer.querySelector("[data-composer-count]");
      var submit = composer.querySelector("[data-composer-submit]");
      var lockedBar = composer.querySelector("[data-composer-locked]");
      var form = composer.querySelector("[data-composer-form]");
      var topic = composer.querySelector("[data-composer-topic]");

      function syncAuth() {
        var session = A.getSession();
        if (form) form.hidden = !session;
        if (lockedBar) lockedBar.hidden = !!session;
        var av = composer.querySelector("[data-composer-avatar]");
        if (av && session) av.textContent = initials(session.nickname);
      }

      syncAuth();
      A.onChange(syncAuth);

      if (text && counter) {
        text.addEventListener("input", function () {
          var n = text.value.length;
          counter.textContent = n + " / 400";
          counter.classList.toggle("is-warn", n > 400);
        });
      }

      var loginBtn = composer.querySelector("[data-composer-login]");
      if (loginBtn) {
        loginBtn.addEventListener("click", function () {
          A.openGate("发帖需要先登录，义乌AI圈用手机号即可入场。");
        });
      }

      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var session = A.getSession();
          if (!session) {
            A.openGate("发帖需要先登录。");
            return;
          }
          var val = (text.value || "").trim();
          if (val.length < 6) {
            U.toast("再多写几个字吧（至少 6 个字）");
            text.focus();
            return;
          }
          if (val.length > 400) {
            U.toast("最多 400 字，精简一下");
            return;
          }
          var lines = val.split("\n").filter(function (l) { return l.trim(); });
          var title = "";
          var body = "";
          if (lines.length > 1) {
            title = lines[0].slice(0, 42);
            body = lines.slice(1).join(" ");
          } else if (val.length <= 42) {
            title = val;
          } else {
            title = "圈友动态 · " + val.slice(0, 24) + "…";
            body = val;
          }
          var tag = topic ? topic.value : "闲聊";
          if (submit) U.busy(submit, true);
          A.api("POST", "/api/posts", { title: title, body: body, tag: tag }).then(function (r) {
            if (submit) U.busy(submit, false);
            if (!r.ok) {
              if (r.status === 401) { A.openGate("登录已过期，请重新登录后再发。"); return; }
              U.toast(r.msg || "发布失败，请重试");
              return;
            }
            var post = r.post;
            post.mine = true;
            var node = buildPost(post);
            node.dataset.server = "1";
            node.dataset.seq = String(200000 + Math.floor(post.at / 1000));
            var first = feed.querySelector(".post");
            if (first) feed.insertBefore(node, first);
            else feed.appendChild(node);
            text.value = "";
            if (counter) counter.textContent = "0 / 400";
            syncFeedCount();
            paintLiveStats();
            U.toast("发布成功，已发到社区");
            paintActs(node);
            paintComments(node);
          });
        });
      }
    }

    /* -------- filters -------- */
    var filterBtns = document.querySelectorAll("[data-filter-tag]");
    if (filterBtns.length) {
      Array.prototype.forEach.call(filterBtns, function (btn) {
        btn.addEventListener("click", function () {
          var tag = btn.dataset.filterTag;
          Array.prototype.forEach.call(filterBtns, function (b) {
            b.classList.toggle("is-on", b === btn);
          });
          var shown = 0;
          Array.prototype.forEach.call(document.querySelectorAll(".post"), function (p) {
            var ok = tag === "all" || (p.dataset.tag || "") === tag;
            p.hidden = !ok;
            if (ok) shown++;
          });
          var countEl = document.querySelector("[data-feed-count]");
          if (countEl) countEl.textContent = shown;
          var empty = document.querySelector("[data-feed-empty]");
          if (empty) empty.hidden = shown > 0;
        });
      });
    }

    /* -------- sort -------- */
    var sortBtns = document.querySelectorAll("[data-sort]");
    Array.prototype.forEach.call(sortBtns, function (btn) {
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(sortBtns, function (b) { b.classList.remove("is-on"); });
        btn.classList.add("is-on");
        var mode = btn.dataset.sort;
        var posts = Array.prototype.slice.call(feed.querySelectorAll(".post"));
        if (mode === "hot") {
          posts.sort(function (a, b) {
            var la = a.querySelector('[data-act="like"]');
            var lb = b.querySelector('[data-act="like"]');
            var na = la ? Number(la.querySelector("[data-n]").textContent) : 0;
            var nb = lb ? Number(lb.querySelector("[data-n]").textContent) : 0;
            return nb - na || Number(b.dataset.seq) - Number(a.dataset.seq);
          });
        } else {
          posts.sort(function (a, b) {
            return Number(b.dataset.seq) - Number(a.dataset.seq);
          });
        }
        posts.forEach(function (p) { feed.appendChild(p); });
        U.toast(mode === "hot" ? "已按热度排序" : "已按最新排序");
      });
    });

    if (window.location.hash === "#composer") {
      setTimeout(function () {
        var el = document.querySelector("[data-composer]");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          var t = el.querySelector("[data-composer-text]");
          if (t) t.focus();
        }
      }, 400);
    }
  }

  /* ======================================================================
     PRODUCTS
     ====================================================================== */
  var goodsGrid = document.querySelector("[data-goods]");

  if (goodsGrid) {
    var goods = [];
    var state = { cat: "all", platform: "all", q: "" };

    function applyGoods() {
      var shown = 0;
      goods.forEach(function (card) {
        var okCat = state.cat === "all" || card.dataset.cat === state.cat;
        var okPlat = state.platform === "all" || card.dataset.platform === state.platform || card.dataset.platform === "all";
        var okQ = !state.q || (card.dataset.name || "").toLowerCase().indexOf(state.q) > -1;
        var ok = okCat && okPlat && okQ;
        card.hidden = !ok;
        if (ok) shown++;
      });
      var counter = document.querySelector("[data-goods-count]");
      if (counter) counter.textContent = String(shown);
      var empty = document.querySelector("[data-goods-empty]");
      if (empty) empty.hidden = shown > 0;
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.dataset.filter;
        state[group] = btn.dataset.val;
        Array.prototype.forEach.call(
          document.querySelectorAll('[data-filter="' + group + '"]'),
          function (b) { b.classList.toggle("is-on", b === btn); }
        );
        applyGoods();
      });
    });

    var search = document.querySelector("[data-goods-search]");
    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value.trim().toLowerCase();
        applyGoods();
      });
    }

    var sortSel = document.querySelector("[data-goods-sort]");
    if (sortSel) {
      sortSel.addEventListener("change", function () {
        var mode = sortSel.value;
        var sorted = goods.slice().sort(function (a, b) {
          if (mode === "price-asc") return Number(a.dataset.price) - Number(b.dataset.price);
          if (mode === "price-desc") return Number(b.dataset.price) - Number(a.dataset.price);
          return Number(a.dataset.order) - Number(b.dataset.order);
        });
        sorted.forEach(function (c) { goodsGrid.appendChild(c); });
      });
    }

    goodsGrid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-apply]");
      if (!btn) return;
      var name = btn.dataset.apply;
      A.requireAuth("申请对接「" + name + "」需要先登录，方便商家回复你。", function () {
        btn.disabled = true;
        btn.textContent = "已提交申请";
        btn.classList.remove("btn--red");
        btn.classList.add("btn--ghost");
        U.toast("已把「" + name + "」的对接申请发给商家");
      });
    });

    sitePromise.then(function (site) {
      var loading = goodsGrid.querySelector("[data-list-loading]");
      if (!site) {
        if (loading) loading.textContent = "AI 工具暂时加载失败，请刷新重试。";
        return;
      }
      if (loading) loading.remove();
      var empty = goodsGrid.querySelector("[data-goods-empty]");
      var html = site.products.map(function (p, i) { return goodCard(p, i, site); }).join("");
      if (empty) empty.insertAdjacentHTML("beforebegin", html);
      else goodsGrid.insertAdjacentHTML("beforeend", html);
      goods = Array.prototype.slice.call(goodsGrid.querySelectorAll(".good"));
      Array.prototype.forEach.call(document.querySelectorAll('[data-filter="cat"]'), function (b) {
        var n = b.dataset.val === "all" ? site.products.length
          : site.products.filter(function (p) { return p.cat === b.dataset.val; }).length;
        var c = b.querySelector(".chip__n");
        if (c) c.textContent = n;
      });
      applyGoods();
    });
  }

  /* ======================================================================
     MERCHANTS
     ====================================================================== */
  var merchantGrid = document.querySelector("[data-merchants]");

  if (merchantGrid) {
    var cards = [];

    sitePromise.then(function (site) {
      var loading = merchantGrid.querySelector("[data-list-loading]");
      if (!site) {
        if (loading) loading.textContent = "商家名录暂时加载失败，请刷新重试。";
        return;
      }
      if (loading) loading.remove();
      var empty = merchantGrid.querySelector("[data-merchant-empty]");
      var html = site.merchants.map(function (m) { return merchantCard(m, site); }).join("");
      if (empty) empty.insertAdjacentHTML("beforebegin", html);
      else merchantGrid.insertAdjacentHTML("beforeend", html);
      cards = Array.prototype.slice.call(merchantGrid.querySelectorAll(".merchant"));
      Array.prototype.forEach.call(document.querySelectorAll("[data-zone-filter]"), function (b) {
        var z = b.dataset.zoneFilter;
        var n = z === "all" ? cards.length : cards.filter(function (c) { return c.dataset.zone === z; }).length;
        var c = b.querySelector(".chip__n");
        if (c) c.textContent = n;
      });
      var counter = document.querySelector("[data-merchant-count]");
      if (counter) counter.textContent = String(cards.length);
      if (empty) empty.hidden = cards.length > 0;
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-zone-filter]"), function (btn) {
      btn.addEventListener("click", function () {
        var zone = btn.dataset.zoneFilter;
        Array.prototype.forEach.call(document.querySelectorAll("[data-zone-filter]"), function (b) {
          b.classList.toggle("is-on", b === btn);
        });
        var shown = 0;
        cards.forEach(function (c) {
          var ok = zone === "all" || c.dataset.zone === zone;
          c.hidden = !ok;
          if (ok) shown++;
        });
        var counter = document.querySelector("[data-merchant-count]");
        if (counter) counter.textContent = String(shown);
        var empty = document.querySelector("[data-merchant-empty]");
        if (empty) empty.hidden = shown > 0;
      });
    });

    var contactModal = document.getElementById("contactModal");
    if (!contactModal) {
      contactModal = document.createElement("div");
      contactModal.className = "modal";
      contactModal.id = "contactModal";
      contactModal.setAttribute("aria-hidden", "true");
      contactModal.innerHTML =
        '<div class="modal__veil" data-close></div>' +
        '<div class="modal__sheet" role="dialog" aria-modal="true" aria-labelledby="contactTitle">' +
        '<button class="modal__close" type="button" data-close aria-label="关闭">✕</button>' +
        '<div class="gate-head"><span class="mono">Stall contact · 档口联系</span>' +
        '<h3 id="contactTitle">联系方式</h3><p data-contact-sub></p></div>' +
        '<div class="contact-card" data-contact-body></div>' +
        '<div class="gate-foot"><span>联系时请说明来自义乌AI圈</span><a href="merchants.html">浏览更多商家 →</a></div>' +
        "</div>";
      document.body.appendChild(contactModal);
    }

    merchantGrid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-contact]");
      if (!btn) return;
      var name = btn.dataset.name;
      var zone = btn.dataset.zoneName || "";
      A.requireAuth("查看商家联系方式需要先登录，避免被批量采集。", function (session) {
        btn.disabled = true;
        A.api("GET", "/api/merchants/" + encodeURIComponent(btn.dataset.mid || "") + "/contact").then(function (r) {
          btn.disabled = false;
          if (!r.ok) {
            U.toast(r.msg || "联系方式暂时获取失败，请稍后再试");
            return;
          }
          showContact(session, r.contact || {});
        });
      });

      function showContact(session, ct) {
        var body = contactModal.querySelector("[data-contact-body]");
        var sub = contactModal.querySelector("[data-contact-sub]");
        sub.textContent = name + (zone ? " · " + zone : "") + "　（已登录：" + session.nickname + "）";
        body.innerHTML =
          '<div class="contact-row"><span>联系人</span><b>' + escapeHTML(ct.owner || "档口负责人") + "</b></div>" +
          '<div class="contact-row"><span>手机</span><b>' + escapeHTML(ct.phone || "—") + "</b></div>" +
          '<div class="contact-row"><span>微信</span><b>' + escapeHTML(ct.wechat || "—") + "</b></div>" +
          '<div class="contact-row"><span>营业时间</span><b>' + escapeHTML(ct.hours || "—") + "</b></div>" +
          '<button class="btn btn--red btn--block" type="button" data-copy>' +
          '<span>复制微信号</span></button>';
        body.querySelector("[data-copy]").addEventListener("click", function () {
          var v = ct.wechat || ct.phone || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(v).then(function () {
              U.toast("微信号已复制：" + v);
            }, function () {
              U.toast("微信号：" + v);
            });
          } else {
            U.toast("微信号：" + v);
          }
        });
        U.openModal(contactModal);
      }
    });
  }

  /* ---------------- 手机端「发帖」悬浮按钮 ---------------- */
  document.addEventListener("click", function (e) {
    var fab = e.target.closest("[data-fab-compose]");
    if (!fab) return;
    var box = document.querySelector("[data-composer]");
    if (!box) return;
    e.preventDefault();
    if (!A.getSession()) {
      A.openGate("发帖需要先登录，义乌AI圈用手机号即可入场。");
      return;
    }
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    var t = box.querySelector("[data-composer-text]");
    if (t) setTimeout(function () { t.focus(); }, 380);
  });

  /* ======================================================================
     misc
     ====================================================================== */
  Array.prototype.forEach.call(document.querySelectorAll("[data-demo]"), function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      U.toast(el.dataset.demo);
    });
  });

  /* ---------------- author -> profile links ---------------- */
  (function linkAuthors() {
    var known = {
      "义乌阿岚": "13800138000",
      "阿灿": "13911112222",
      "哈桑在中国": "13655556666",
      "朱哥尾货": "13755551203",
      "金师傅": "13733335518",
      "圈助手": "13000000000"
    };

    Array.prototype.forEach.call(document.querySelectorAll(".post__who strong"), function (strong) {
      var node = strong.firstChild;
      if (!node || node.nodeType !== 3) return;
      var name = node.textContent.trim();
      var phone = known[name];
      if (!phone) return;
      var a = document.createElement("a");
      a.href = "profile.html?u=" + phone;
      a.textContent = name;
      a.title = "查看 " + name + " 的主页";
      a.style.borderBottom = "1px solid rgba(20, 18, 10, 0.24)";
      node.parentNode.replaceChild(a, node);
    });
  })();

  var joinBtns = document.querySelectorAll("[data-join]");
  Array.prototype.forEach.call(joinBtns, function (btn) {
    btn.addEventListener("click", function () {
      A.requireAuth("申请入驻需要先登录，我们会在 1 个工作日内联系你。", function () {
        U.toast("入驻申请已提交，运营会尽快联系你");
      });
    });
  });

  /* ---------------- live stats: 今日新帖 / 认证商家 ---------------- */
  var BASE_POSTS_TODAY = 9;   // posts.html 中今天发布的静态帖子
  var BASE_MERCHANTS = 8;     // merchants.html 中已认证的商家

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  var serverStats = null;

  function liveCounts() {
    return {
      posts: BASE_POSTS_TODAY + (serverStats ? serverStats.postsToday || 0 : 0),
      merchants: serverStats && typeof serverStats.merchants === "number" ? serverStats.merchants : BASE_MERCHANTS
    };
  }

  function paintLiveStats() {
    A.api("GET", "/api/stats").then(function (r) {
      if (r.ok) serverStats = r;
      var n = liveCounts();
      Array.prototype.forEach.call(document.querySelectorAll('[data-stat="posts-today"]'), function (el) {
        el.textContent = n.posts;
        el.title = "今天社区发布 " + n.posts + " 条";
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-stat="merchants"]'), function (el) {
        el.textContent = n.merchants;
        if (el.hasAttribute("data-count")) el.setAttribute("data-count", n.merchants);
        el.title = "商家名录中已认证 " + n.merchants + " 家";
      });
    });
  }

  paintLiveStats();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) paintLiveStats();
  });

  /* ---------------- live USD / CNY ticker ---------------- */
  (function () {
    var items = document.querySelectorAll("[data-fx]");
    if (!items.length) return;

    var KEY = "ywai.fx.usdcny.v1";
    var REFRESH = 60 * 1000;
    var FALLBACK = 7.2415;
    var paintedAt = 0;

    function readCache() {
      try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
    }

    function saveCache(rate, source) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ rate: rate, source: source, at: Date.now() }));
      } catch (e) {}
    }

    function paint(rate, note) {
      var value = Number(rate).toFixed(4);
      Array.prototype.forEach.call(items, function (item) {
        var b = item.querySelector("[data-fx-rate]");
        var d = item.querySelector("[data-fx-delta]");
        if (b) b.textContent = value;
        if (d) {
          d.className = note.cls;
          d.textContent = note.text;
        }
        item.title = note.title;
      });
    }

    var cache = readCache();
    if (cache && cache.rate) {
      paint(cache.rate, {
        cls: "up",
        text: "连接中",
        title: "上次抓取：" + new Date(cache.at).toLocaleString("zh-CN") + "（" + cache.source + "）"
      });
    }

    // 依次尝试三个公开汇率源，任意一个成功即停止（优先当天更新的数据）
    var SOURCES = [
      {
        name: "exchangerate-api.com",
        url: "https://api.exchangerate-api.com/v4/latest/USD",
        read: function (d) { return d && d.rates && d.rates.CNY; },
        stamp: function (d) { return d.date; }
      },
      {
        name: "frankfurter.dev",
        url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
        read: function (d) { return d && d.rates && d.rates.CNY; },
        stamp: function (d) { return d.date; }
      },
      {
        name: "open.er-api.com",
        url: "https://open.er-api.com/v6/latest/USD",
        read: function (d) { return d && d.rates && d.rates.CNY; },
        stamp: function (d) { return d.time_last_update_utc; }
      }
    ];

    function offline() {
      var last = readCache();
      if (last && last.rate) {
        paint(last.rate, {
          cls: "up",
          text: "离线",
          title: "网络不可用，显示 " + new Date(last.at).toLocaleString("zh-CN") + " 抓取的汇率"
        });
      } else {
        paint(FALLBACK, { cls: "up", text: "演示", title: "网络不可用，当前为演示汇率" });
      }
    }

    function load() {
      var i = 0;

      function attempt() {
        if (i >= SOURCES.length) { offline(); return; }
        var src = SOURCES[i++];
        var ctrl = "AbortController" in window ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
        var opt = ctrl ? { signal: ctrl.signal } : {};

        fetch(src.url, opt)
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          })
          .then(function (data) {
            var rate = Number(src.read(data));
            if (!rate || !isFinite(rate)) throw new Error("bad payload");
            if (timer) clearTimeout(timer);
            var now = new Date();
            var hhmm = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
            paintedAt = Date.now();
            paint(rate, {
              cls: "up",
              text: "实时 " + hhmm,
              title: "数据来源：" + src.name + " · " + (src.stamp(data) || now.toLocaleString("zh-CN"))
            });
            saveCache(rate, src.name);
          })
          .catch(function () {
            if (timer) clearTimeout(timer);
            attempt();
          });
      }

      attempt();
    }

    load();
    setInterval(load, REFRESH);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && Date.now() - paintedAt > REFRESH) load();
    });
  })();

  /* ---- 中东专线舱位 / 义乌→利雅得运价：演示实时或物流接口 ---- */
  (function logisticsLive() {
    var targets = document.querySelectorAll("[data-live-space], [data-live-rate], [data-live-rate-num]");
    if (!targets.length) return;

    var CFG = (window.YW_CONFIG && window.YW_CONFIG.logistics) || {};
    var MODE = CFG.mode === "api" ? "api" : "demo";
    var REFRESH = Math.max(30, Number(CFG.refreshSeconds) || 60) * 1000;
    var KEY = "ywai.logistics.v1";
    var state = { space: 92, rate: 18.6, at: 0, online: true };

    function readCache() {
      try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
    }

    function saveCache() {
      try {
        localStorage.setItem(KEY, JSON.stringify({ space: state.space, rate: state.rate, at: state.at }));
      } catch (e) {}
    }

    function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

    function hhmm(ts) {
      return new Date(ts || Date.now()).toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit", hour12: false
      });
    }

    function paint(note) {
      var spaceText = Math.round(state.space) + "%";
      var rateText = state.rate.toFixed(1);

      Array.prototype.forEach.call(document.querySelectorAll("[data-live-space]"), function (el) {
        el.textContent = spaceText;
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-live-rate]"), function (el) {
        el.textContent = rateText + " 元/kg";
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-live-rate-num]"), function (el) {
        el.textContent = rateText;
      });

      var stamp = note || ("实时 " + hhmm(state.at));
      Array.prototype.forEach.call(document.querySelectorAll("[data-live-stamp]"), function (el) {
        el.textContent = stamp;
        el.className = "up";
      });

      var title = "中东专线舱位与义乌→利雅得运价 · " +
        (MODE === "api"
          ? (state.online ? "数据来源：物流接口" : "物流接口不可用，显示上次数据")
          : "演示实时，每 " + Math.round(REFRESH / 1000) + " 秒模拟波动；接入物流接口后为真实数据") +
        (state.at ? " · 更新于 " + new Date(state.at).toLocaleString("zh-CN") : "");
      Array.prototype.forEach.call(document.querySelectorAll("[data-live='logistics']"), function (el) {
        el.title = title;
      });
    }

    var cache = readCache();
    if (cache && isFinite(cache.space) && isFinite(cache.rate)) {
      state.space = Number(cache.space);
      state.rate = Number(cache.rate);
      state.at = Number(cache.at) || 0;
    }

    function simulate() {
      state.space = clamp(state.space + (Math.random() * 3 - 1.5), 88, 96);
      state.rate = clamp(state.rate + (Math.random() * 0.4 - 0.2), 18.2, 19.2);
      state.at = Date.now();
      state.online = true;
      saveCache();
      paint();
    }

    function loadApi() {
      fetch(CFG.endpoint || "/api/logistics/live", { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          var space = Number(d && d.space);
          var rate = Number(d && d.rate);
          if (!d || d.ok === false || !isFinite(space) || !isFinite(rate)) throw new Error("bad payload");
          state.space = clamp(space, 0, 100);
          state.rate = rate;
          state.at = d.updatedAt ? new Date(d.updatedAt).getTime() : Date.now();
          if (!isFinite(state.at)) state.at = Date.now();
          state.online = true;
          saveCache();
          paint();
        })
        .catch(function () {
          state.online = false;
          paint("离线");
        });
    }

    function tick() {
      if (MODE === "api") loadApi();
      else simulate();
    }

    if (MODE === "demo" && state.at && Date.now() - state.at > REFRESH) {
      simulate();
    } else {
      paint(state.at ? "" : (MODE === "api" ? "连接中" : "实时 " + hhmm()));
    }
    if (MODE === "api") loadApi();
    setInterval(tick, REFRESH);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (Date.now() - (state.at || 0) > REFRESH) tick();
    });
  })();

  /* ---- 档口通行证卡堆：循环切换 ---- */
  (function cardCycle() {
    var visual = document.querySelector(".hero__visual");
    if (!visual) return;
    var cards = Array.prototype.slice.call(visual.querySelectorAll(".stall-card"));
    if (cards.length < 3) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var paused = false;
    var timer = null;

    function setAria() {
      cards.forEach(function (card) {
        card.setAttribute("aria-hidden", card.classList.contains("stall-card--main") ? "false" : "true");
      });
    }

    function rotate() {
      if (paused || document.hidden) return;
      var main = visual.querySelector(".stall-card--main");
      var mid = visual.querySelector(".stall-card--mid");
      var back = visual.querySelector(".stall-card--back");
      if (!main || !mid || !back) return;

      // 旧主卡先抬到最上层，动画结束后再落回牌堆底部
      main.style.zIndex = "4";
      main.classList.remove("stall-card--main");
      main.classList.add("stall-card--back");
      mid.classList.remove("stall-card--mid");
      mid.classList.add("stall-card--main");
      back.classList.remove("stall-card--back");
      back.classList.add("stall-card--mid");
      setAria();

      setTimeout(function () { main.style.zIndex = ""; }, 700);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function start() {
      stop();
      timer = setInterval(rotate, 6000);
    }

    visual.addEventListener("mouseenter", function () { paused = true; });
    visual.addEventListener("mouseleave", function () { paused = false; });
    document.addEventListener("visibilitychange", function () { paused = document.hidden; });

    setAria();
    if (!reduce) start();
  })();

})();
