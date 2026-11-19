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
     POSTS
     ====================================================================== */
  var feed = document.querySelector("[data-feed]");

  if (feed) {
    var seqCounter = 100000;
    Array.prototype.forEach.call(feed.querySelectorAll(".post"), function (p) {
      p.dataset.seq = String(seqCounter--);
    });

    var likesStore = U.store.get(U.keys.likes, {});
    var commentsStore = U.store.get(U.keys.comments || "ywai.comments.v1", {});

    function persistLikes() { U.store.set(U.keys.likes, likesStore); }
    function persistComments() { U.store.set("ywai.comments.v1", commentsStore); }

    function paintActs(postEl) {
      var id = postEl.dataset.post;
      var state = likesStore[id] || {};
      var likeBtn = postEl.querySelector('[data-act="like"]');
      var markBtn = postEl.querySelector('[data-act="mark"]');
      if (likeBtn) {
        var base = Number(likeBtn.dataset.base) || 0;
        likeBtn.classList.toggle("is-on", !!state.liked);
        var span = likeBtn.querySelector("[data-n]");
        if (span) span.textContent = base + (state.liked ? 1 : 0);
      }
      if (markBtn) {
        var mb = Number(markBtn.dataset.base) || 0;
        markBtn.classList.toggle("is-on", !!state.marked);
        var ms = markBtn.querySelector("[data-n]");
        if (ms) ms.textContent = mb + (state.marked ? 1 : 0);
      }
    }

    function paintComments(postEl) {
      var id = postEl.dataset.post;
      var box = postEl.querySelector(".post__comments");
      if (!box) return;
      var list = commentsStore[id] || [];
      var html = list.map(function (c) {
        return '<div class="cmt"><b>' + escapeHTML(c.name) +
          "<span>" + escapeHTML(c.at) + "</span></b><p>" + escapeHTML(c.text) + "</p></div>";
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
        '<span class="avatar avatar--red">' + escapeHTML(initials(data.name)) + "</span>" +
        '<div class="post__who"><strong>' + escapeHTML(data.name || "圈友") +
        ' <span class="tag tag--red">' + (fresh ? "刚刚发布" : "圈友发帖") + "</span></strong>" +
        "<span>义乌 · " + escapeHTML(data.tag) + " · " + escapeHTML(fmtTime(data.at)) + "</span></div></div>" +
        '<div class="post__title">' + escapeHTML(data.title) + "</div>" +
        '<p class="post__body">' + escapeHTML(data.body || "") + "</p>" +
        '<div class="post__foot">' +
        '<button class="act" type="button" data-act="like" data-base="0">♡ 赞 <span data-n>0</span></button>' +
        '<button class="act" type="button" data-act="comment" data-base="0">◌ 评论 <span data-n>0</span></button>' +
        '<button class="act" type="button" data-act="mark" data-base="0">◇ 收藏 <span data-n>0</span></button>' +
        '<span class="tag" style="margin-left:auto">' + escapeHTML(data.tag) + "</span></div>" +
        '<div class="post__comments"><div class="cmt-form">' +
        '<input type="text" placeholder="写下你的回应…" maxlength="120" aria-label="评论内容">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-cmt-send>发送</button>' +
        "</div></div>";
      return node;
    }

    var savedMine = U.store.get("ywai.mine.v1", []);
    savedMine.slice().reverse().forEach(function (p) {
      var el = buildPost(p);
      feed.insertBefore(el, feed.firstElementChild);
      paintActs(el);
      paintComments(el);
    });

    function syncFeedCount() {
      var el = document.querySelector("[data-feed-count]");
      if (el) el.textContent = feed.querySelectorAll(".post").length;
    }
    syncFeedCount();

    Array.prototype.forEach.call(document.querySelectorAll(".post"), function (postEl) {
      paintActs(postEl);
      paintComments(postEl);
    });

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
        A.requireAuth("参与互动需要先登录，用手机号 10 秒入场。", function () {
          var state = likesStore[id] || (likesStore[id] = {});
          if (kind === "like") state.liked = !state.liked;
          if (kind === "mark") {
            state.marked = !state.marked;
            U.toast(state.marked ? "已收藏这条帖子" : "已取消收藏");
          }
          persistLikes();
          paintActs(postEl);
        });
        return;
      }

      var send = e.target.closest("[data-cmt-send]");
      if (send) {
        var input = postEl.querySelector(".cmt-form input");
        var text = input ? input.value.trim() : "";
        if (!text) return;
        A.requireAuth("发评论前先登录一下。", function (session) {
          var list = commentsStore[id] || (commentsStore[id] = []);
          list.unshift({ name: session.nickname, text: text, at: fmtTime(Date.now()) });
          persistComments();
          paintComments(postEl);
          if (input) input.value = "";
          U.toast("评论已发布");
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
          var post = {
            id: "u" + Date.now(),
            title: title,
            body: body,
            tag: tag,
            at: Date.now(),
            name: session.nickname,
            seq: "999999"
          };
          var node = buildPost(post);

          var first = feed.querySelector(".post");
          if (first) feed.insertBefore(node, first);
          else feed.appendChild(node);

          var saved = U.store.get("ywai.mine.v1", []);
          saved.unshift(post);
          U.store.set("ywai.mine.v1", saved.slice(0, 30));

          text.value = "";
          if (counter) counter.textContent = "0 / 400";
          syncFeedCount();
          paintLiveStats();
          U.toast("发布成功，已发到社区");
          paintComments(node);
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
    var goods = Array.prototype.slice.call(goodsGrid.querySelectorAll(".good"));
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
  }

  /* ======================================================================
     MERCHANTS
     ====================================================================== */
  var merchantGrid = document.querySelector("[data-merchants]");

  if (merchantGrid) {
    var cards = Array.prototype.slice.call(merchantGrid.querySelectorAll(".merchant"));

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
        '<div class="gate-foot"><span>SAMPLE DATA · 演示数据</span><a href="merchants.html">浏览更多商家 →</a></div>' +
        "</div>";
      document.body.appendChild(contactModal);
    }

    merchantGrid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-contact]");
      if (!btn) return;
      var name = btn.dataset.name;
      var zone = btn.dataset.zoneName || "";
      A.requireAuth("查看商家联系方式需要先登录，避免被批量采集。", function (session) {
        var body = contactModal.querySelector("[data-contact-body]");
        var sub = contactModal.querySelector("[data-contact-sub]");
        sub.textContent = name + (zone ? " · " + zone : "") + "　（已登录：" + session.nickname + "）";
        body.innerHTML =
          '<div class="contact-row"><span>联系人</span><b>' + escapeHTML(btn.dataset.person || "档口负责人") + "</b></div>" +
          '<div class="contact-row"><span>手机 / 微信同号</span><b>' + escapeHTML(btn.dataset.phone) + "</b></div>" +
          '<div class="contact-row"><span>微信</span><b>' + escapeHTML(btn.dataset.wechat) + "</b></div>" +
          '<div class="contact-row"><span>营业时间</span><b>' + escapeHTML(btn.dataset.hours || "08:30 - 17:30") + "</b></div>" +
          '<button class="btn btn--red btn--block" type="button" data-copy>' +
          '<span>复制微信号</span></button>';
        body.querySelector("[data-copy]").addEventListener("click", function () {
          var v = btn.dataset.wechat;
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
      });
    });
  }

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
    try {
      var stored = JSON.parse(localStorage.getItem("ywai.profiles.v1") || "{}");
      Object.keys(stored).forEach(function (phone) {
        if (stored[phone] && stored[phone].nickname) known[stored[phone].nickname] = phone;
      });
    } catch (e) {}

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

  function approvedFromAdmin() {
    try {
      var db = JSON.parse(localStorage.getItem("ywai.admin.db.v1") || "null");
      if (!db || !Array.isArray(db.merchants)) return 0;
      return db.merchants.filter(function (m) { return m && m.status === "approved"; }).length;
    } catch (e) { return 0; }
  }

  function liveCounts() {
    var mine = U.store.get("ywai.mine.v1", []);
    var today = dayKey(Date.now());
    var myToday = (Array.isArray(mine) ? mine : []).filter(function (p) {
      return p && p.at && dayKey(p.at) === today;
    }).length;
    return {
      posts: BASE_POSTS_TODAY + myToday,
      merchants: Math.max(BASE_MERCHANTS, approvedFromAdmin())
    };
  }

  function paintLiveStats() {
    var n = liveCounts();
    Array.prototype.forEach.call(document.querySelectorAll('[data-stat="posts-today"]'), function (el) {
      el.textContent = n.posts;
      el.title = "今天社区实际发布 " + n.posts + " 条（含你在本机发布的）";
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-stat="merchants"]'), function (el) {
      el.textContent = n.merchants;
      el.title = "商家名录中已认证 " + n.merchants + " 家";
    });
  }

  paintLiveStats();
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === "ywai.mine.v1" || e.key === "ywai.admin.db.v1") paintLiveStats();
  });
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
