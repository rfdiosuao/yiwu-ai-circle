/* ==========================================================================
   义乌AI圈 · 个人主页
   每位圈友一张可装扮的名片：封面、头像、联系、在做的事、相册。
   ========================================================================== */
(function () {
  "use strict";

  var A = window.YW.auth;
  var U = window.YW.ui;
  var PKEY = "ywai.profiles.v1";
  var DAY = 86400000;
  var MAX_GALLERY = 6;

  var params = new URLSearchParams(location.search);
  var session = A.getSession();
  var byId = params.get("id") || "";
  var phone = params.get("u") || (!byId && session && session.phone) || "";

  var profile = null;
  var isOwner = false;
  var serverPosts = [];
  var serverLikes = 0;

  var state = { draft: null, theme: "paper", tone: 1 };

  var entry = document.querySelector("[data-auth-entry]");
  if (entry) {
    entry.href = "login.html?redirect=" +
      encodeURIComponent(phone ? "profile.html?u=" + phone : "profile.html");
  }

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function $(s) { return document.querySelector(s); }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysSince(d) {
    var t = new Date(d + "T00:00:00").getTime();
    if (isNaN(t)) return 1;
    return Math.max(1, Math.round((Date.now() - t) / DAY));
  }

  function toast(msg) { U.toast(msg); }

  /* ---------------- seed ---------------- */
  function seedProfiles() {
    return {
      "13800138000": {
        nickname: "义乌阿岚", role: "跨境选品 / 中东市场", city: "义乌 · 北苑",
        tagline: "把义乌的小商品，卖到中东的货架上。",
        bio: "在义乌做了六年跨境。现在一个人跑选品、拍内容、发货，AI 是唯一的同事。\n白天在商贸城，晚上在青口，凌晨回消息。",
        theme: "paper", tone: 1, avatar: "",
        phone: "13800138000", wechat: "alan_yiwu", joined: "2026-07-11",
        tags: ["中东专线", "家居小件", "TikTok Shop", "AI 选品"],
        doing: [
          { t: "中东家居小件选品", d: "每周跑两趟商贸城二区，专挑能进沙特家庭的小件，客单 30-80 元。" },
          { t: "TikTok Shop 美区 / 中东区", d: "自营 4 个店铺，主做短视频带货，月出两万单左右。" },
          { t: "帮工厂做出海内容", d: "给三家义乌工厂做阿拉伯语素材，收固定服务费。" }
        ],
        gallery: [
          { label: "二区档口", glyph: "档", tone: "ink" },
          { label: "本周样品", glyph: "样", tone: "red" },
          { label: "夜班直播", glyph: "播", tone: "teal" }
        ]
      },
      "13911112222": {
        nickname: "阿灿", role: "跨境内容 / 短视频", city: "义乌 · 稠城",
        tagline: "一条视频，顶一个业务员。",
        bio: "拍过 3000 条带货视频，跑通过 12 个类目。现在只接能长期合作的工厂。",
        theme: "ink", tone: 2, avatar: "",
        phone: "13911112222", wechat: "acan_video", joined: "2026-04-20",
        tags: ["TikTok 内容", "美区", "脚本模板", "工厂出海"],
        doing: [
          { t: "短视频代运营", d: "从脚本、拍摄到投流，按条或按月结算，不做纯剪辑。" },
          { t: "内容陪跑", d: "带义乌工厂自己的运营团队，两个月跑出稳定更新节奏。" }
        ],
        gallery: [
          { label: "拍摄现场", glyph: "拍", tone: "ink" },
          { label: "脚本墙", glyph: "稿", tone: "red" },
          { label: "数据复盘", glyph: "数", tone: "teal" }
        ]
      },
      "13755551203": {
        nickname: "朱哥尾货", role: "尾货清仓 / 一件代发", city: "义乌 · 北下朱",
        tagline: "北下朱没有卖不掉的货，只有不对的价。",
        bio: "在北下朱守了九年仓。谁的货压手了，可以来找我看看。",
        theme: "red", tone: 1, avatar: "",
        phone: "13755551203", wechat: "zhuge_huoyuan", joined: "2025-12-30",
        tags: ["尾货", "一件代发", "直播供货", "9.9 包邮"],
        doing: [
          { t: "尾货收购与清仓", d: "库存、尾单、断码都收，现金结算，量大的可以上门。" },
          { t: "直播间供货", d: "现成货盘，支持一件代发，新手主播可以先拿样。" }
        ],
        gallery: [
          { label: "B-12 仓", glyph: "仓", tone: "ink" },
          { label: "本周货盘", glyph: "盘", tone: "red" },
          { label: "打包现场", glyph: "包", tone: "teal" }
        ]
      },
      "13655556666": {
        nickname: "哈桑在中国", role: "中东采购 / 驻义乌", city: "义乌 · 江东",
        tagline: "替中东客户，在义乌把好每一道关。",
        bio: "来自利雅得，在义乌七年。中文、阿拉伯语、英语都能谈。帮客户验货、盯船期。",
        theme: "teal", tone: 3, avatar: "",
        phone: "13655556666", wechat: "hassan_yw", joined: "2026-02-14",
        tags: ["SASO 合规", "验货", "阿语翻译", "中东渠道"],
        doing: [
          { t: "采购代理与验货", d: "按客户清单跑市场、比价、验货，出货前拍完整视频。" },
          { t: "SASO 标签合规", d: "阿拉伯语标签与认证字段核对，减少清关退运。" }
        ],
        gallery: [
          { label: "验货现场", glyph: "验", tone: "teal" },
          { label: "阿语标签", glyph: "签", tone: "ink" },
          { label: "装柜", glyph: "柜", tone: "red" }
        ]
      },
      "13733335518": {
        nickname: "金师傅", role: "非遗红糖 / 文创礼盒", city: "义乌 · 佛堂",
        tagline: "老手艺，也能做成年轻人愿意送人的礼物。",
        bio: "佛堂做红糖第三代。现在把红糖做成礼盒、伴手礼和联名款。",
        theme: "paper", tone: 4, avatar: "",
        phone: "13733335518", wechat: "fotang_tang", joined: "2026-01-08",
        tags: ["非遗工艺", "礼盒定制", "内容电商", "佛堂"],
        doing: [
          { t: "红糖文创礼盒", d: "节气礼盒、企业定制、婚庆伴手礼，起订 20 盒。" },
          { t: "小红书内容", d: "拍古法熬糖，做非遗叙事，给礼盒带自然流量。" }
        ],
        gallery: [
          { label: "熬糖", glyph: "糖", tone: "red" },
          { label: "礼盒", glyph: "礼", tone: "ink" },
          { label: "古镇店", glyph: "店", tone: "teal" }
        ]
      },
      "13000000000": {
        nickname: "圈助手", role: "官方账号", city: "义乌AI圈",
        tagline: "每天整理一条对你有用的义乌情报。",
        bio: "义乌AI圈官方账号。政策、行情、线下活动，先在这里发。",
        theme: "ink", tone: 2, avatar: "",
        phone: "13000000000", wechat: "ywai_official", joined: "2025-11-16",
        tags: ["政策速递", "官方", "圈子运营"],
        doing: [
          { t: "政策与行情整理", d: "每天扫一遍政府与平台公告，挑出影响发货和结汇的部分。" },
          { t: "线下据点运营", d: "青口、北下朱、商贸城的据点排期与活动。" }
        ],
        gallery: [
          { label: "政策速递", glyph: "政", tone: "ink" },
          { label: "线下活动", glyph: "活", tone: "red" },
          { label: "档口走访", glyph: "访", tone: "teal" }
        ]
      }
    };
  }

  function persist(draft) {
    return A.api("PUT", "/api/profiles/me", { profile: draft });
  }

  function defaultProfile(sess) {
    return {
      nickname: sess.nickname,
      role: "义乌圈友",
      city: "义乌",
      tagline: "刚入场，正在找自己的那条链路。",
      bio: "",
      theme: "paper",
      tone: sess.tone || 1,
      avatar: "",
      phone: sess.phone,
      wechat: "",
      joined: today(),
      tags: ["义乌", "新入场"],
      doing: [],
      gallery: []
    };
  }

  /* ---------------- derived ---------------- */
  function stats() {
    return {
      posts: serverPosts.length,
      likes: serverLikes,
      days: daysSince(profile.joined),
      photos: profile.gallery ? profile.gallery.length : 0
    };
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------------- render ---------------- */
  function render() {
    document.title = profile.nickname + " · 义乌AI圈";

    var cover = $("#cover");
    cover.dataset.theme = profile.theme || "paper";
    $("#coverMark").textContent = (profile.nickname || "义").slice(0, 1);
    $("#coverSince").textContent = "加入于 " + (profile.joined || today()).slice(0, 7).replace("-", " / ");

    var av = $("#pAvatar");
    av.dataset.tone = String(profile.tone || 1);
    if (profile.avatar) {
      av.innerHTML = '<img src="' + profile.avatar + '" alt="' + esc(profile.nickname) + '的头像">';
    } else {
      av.textContent = (profile.nickname || "义").slice(0, 1);
    }

    $("#pName").textContent = profile.nickname;
    $("#pRole").textContent = profile.role || "";
    $("#pRole").hidden = !profile.role;
    $("#pTag").textContent = profile.tagline || "";

    $("#pTags").innerHTML = (profile.tags || []).map(function (t) {
      return '<span class="tag">' + esc(t) + "</span>";
    }).join("");

    $("#pEdit").hidden = !isOwner;

    var st = stats();
    $("#pStats").innerHTML =
      statBlock(st.posts, "发帖") +
      statBlock(st.likes, "获赞") +
      statBlock(st.days, "在圈天数") +
      statBlock(st.photos, "相册照片");

    renderBio();
    renderDoing();
    renderGallery();
    renderPosts();
    renderSide();
  }

  function statBlock(n, label, unit) {
    return '<div class="pstat"><b>' + Number(n).toLocaleString("zh-CN") +
      (unit ? "<small> " + unit + "</small>" : "") + "</b><span>" + label + "</span></div>";
  }

  function renderBio() {
    var block = $("#pBioBlock");
    if (profile.bio) {
      block.hidden = false;
      $("#pBio").textContent = profile.bio;
    } else {
      block.hidden = true;
    }
  }

  function renderDoing() {
    var list = profile.doing || [];
    var box = $("#pDoing");
    if (!list.length) {
      box.innerHTML = '<div class="pempty"><strong>还没有填写「我在做的事」</strong>' +
        (isOwner ? "点右上角「装扮主页」，写下你正在做的事。" : "这位圈友还没写完自己的介绍。") + "</div>";
      return;
    }
    box.innerHTML = list.map(function (it, i) {
      return '<div class="doing__item">' +
        '<span class="doing__n">' + String(i + 1).padStart(2, "0") + "</span>" +
        "<div><h3>" + esc(it.t) + "</h3>" +
        (it.d ? "<p>" + esc(it.d) + "</p>" : "") + "</div></div>";
    }).join("");
  }

  function renderGallery() {
    var g = profile.gallery || [];
    $("#pCount").textContent = g.length ? g.length + " 张" : "";
    var box = $("#pGallery");
    if (!g.length) {
      box.innerHTML = '<div class="pempty" style="grid-column:1/-1"><strong>相册还是空的</strong>' +
        (isOwner ? "在「装扮主页」里上传几张图，可以是档口、样品、打包现场。" : "这位圈友还没有上传照片。") + "</div>";
      return;
    }
    box.innerHTML = g.map(function (item, i) {
      if (item.src) {
        return '<button class="tile" type="button" data-photo="' + i + '" aria-label="' + esc(item.label || "照片") + '">' +
          '<img src="' + item.src + '" alt="' + esc(item.label || "相册照片") + '" loading="lazy">' +
          (item.label ? '<span class="tile__cap">' + esc(item.label) + "</span>" : "") + "</button>";
      }
      return '<div class="tile tile--art" data-tone="' + (item.tone || "ink") + '">' +
        "<b>" + esc(item.glyph || "照") + "</b>" +
        (item.label ? '<span class="tile__cap">' + esc(item.label) + "</span>" : "") + "</div>";
    }).join("");
  }

  function renderPosts() {
    var box = $("#pPosts");
    var rows = serverPosts.slice(0, 4).map(function (p) {
      return '<a class="ppost" href="posts.html"><div><strong>' + esc(p.title) + "</strong>" +
        "<span>" + esc(p.tag) + " · " + esc(fmtDate(p.at)) + "</span></div><em>查看 →</em></a>";
    });

    if (!rows.length) {
      box.innerHTML = '<div class="pempty"><strong>还没有发过帖</strong>' +
        (isOwner ? "去社区写下第一条，别只当潜水员。" : "这位圈友还在潜水。") + "</div>";
      return;
    }
    box.innerHTML = rows.slice(0, 4).join("");
  }

  function renderSide() {
    var authed = !!session;
    var c = $("#pContact");
    var html = '<div class="scard"><div class="scard__head"><span>Contact · 名片</span><span>' +
      (authed ? "已解锁" : "需登录") + "</span></div>";

    if (authed) {
      html += '<div class="crow"><span>手机</span><b>' + esc(profile.phone || "——") + "</b></div>";
      if (profile.phone) {
        html += '<button class="copy-btn" type="button" data-copy="' + esc(profile.phone) + '"><span>复制手机号</span><i>COPY</i></button>';
      }
      html += '<div class="crow"><span>微信</span><b>' + esc(profile.wechat || "——") + "</b></div>";
      if (profile.wechat) {
        html += '<button class="copy-btn" type="button" data-copy="' + esc(profile.wechat) + '"><span>复制微信号</span><i>COPY</i></button>';
      }
    } else {
      html += '<div class="crow"><span>手机</span><b class="masked">' + esc(profile.phone || "13800000000") + "</b></div>";
      html += '<div class="crow"><span>微信</span><b class="masked">' + esc(profile.wechat || "ywai_0000") + "</b></div>";
      html += '<div class="lock-row"><span>登录后查看完整联系方式</span>' +
        '<button class="row-btn" type="button" data-gate>登录</button></div>';
    }

    if (!isOwner) {
      html += '<div class="lock-row"><span>资料由本人维护</span><span class="mono">SELF-EDIT</span></div>';
    } else {
      html += '<div class="lock-row"><span>这些信息由你本人填写</span>' +
        '<button class="row-btn" type="button" data-edit>修改</button></div>';
    }
    html += "</div>";
    c.innerHTML = html;

    var a = $("#pAbout");
    a.innerHTML = '<div class="scard"><div class="scard__head"><span>File · 档案</span><span>NO. ' +
      esc((profile.phone || "").slice(-4)) + "</span></div>" +
      '<div class="crow"><span>身份</span><b>' + esc(profile.role || "圈友") + "</b></div>" +
      '<div class="crow"><span>坐标</span><b>' + esc(profile.city || "义乌") + "</b></div>" +
      '<div class="crow"><span>入场</span><b>' + esc(profile.joined || "——") + "</b></div>" +
      '<div class="crow"><span>主页更新</span><b>' + esc(profile.updated || profile.joined || "——") + "</b></div>" +
      "</div>";

    var t = $("#pSideTags");
    t.innerHTML = '<div class="scard"><div class="scard__head"><span>Tags · 标签</span><span>' +
      (profile.tags || []).length + "</span></div>" +
      '<div class="tagcloud">' + (profile.tags || []).map(function (x) {
        return '<span class="tag">' + esc(x) + "</span>";
      }).join("") + "</div></div>";
  }

  /* ---------------- actions ---------------- */
  document.addEventListener("click", function (e) {
    var gate = e.target.closest("[data-gate]");
    if (gate) {
      A.openGate("登录后即可查看 " + profile.nickname + " 的联系方式。", function () {
        location.reload();
      });
      return;
    }

    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var v = copy.dataset.copy;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(function () { toast("已复制：" + v); },
          function () { toast(v); });
      } else {
        toast(v);
      }
      return;
    }

    if (e.target.closest("[data-edit]")) { openEditor(); return; }

    var photo = e.target.closest("[data-photo]");
    if (photo) {
      var item = (profile.gallery || [])[Number(photo.dataset.photo)];
      if (item && item.src) {
        $("#lightImg").src = item.src;
        $("#lightbox").classList.add("is-open");
      }
    }
  });

  $("#pEdit").addEventListener("click", openEditor);

  $("#pShare").addEventListener("click", function () {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("主页链接已复制"); }, function () { toast(url); });
    } else {
      toast(url);
    }
  });

  $("#lightbox").addEventListener("click", function (e) {
    if (e.target.id === "lightbox" || e.target.closest(".lightbox__close")) {
      $("#lightbox").classList.remove("is-open");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      $("#lightbox").classList.remove("is-open");
      closeEditor();
    }
  });

  /* ---------------- editor ---------------- */
  function openEditor() {
    if (!isOwner) return;
    state.draft = JSON.parse(JSON.stringify(profile));
    state.theme = profile.theme || "paper";
    state.tone = profile.tone || 1;

    $("#fNick").value = profile.nickname || "";
    $("#fTag").value = profile.tagline || "";
    $("#fRole").value = profile.role || "";
    $("#fCity").value = profile.city || "";
    $("#fPhone").value = profile.phone || "";
    $("#fWechat").value = profile.wechat || "";
    $("#fBio").value = profile.bio || "";
    $("#fTags").value = (profile.tags || []).join("、");

    for (var i = 1; i <= 3; i++) {
      var item = (profile.doing || [])[i - 1] || { t: "", d: "" };
      $("#d" + i + "t").value = item.t;
      $("#d" + i + "d").value = item.d;
    }

    paintThemes();
    paintTones();
    paintUploads();
    clearErrors();

    $("#editVeil").classList.add("is-open");
    $("#editPanel").classList.add("is-open");
    $("#editPanel").setAttribute("aria-hidden", "false");
    setTimeout(function () { $("#fNick").focus(); }, 150);
  }

  function closeEditor() {
    if (!$("#editPanel").classList.contains("is-open")) return;
    $("#editVeil").classList.remove("is-open");
    $("#editPanel").classList.remove("is-open");
    $("#editPanel").setAttribute("aria-hidden", "true");
    state.draft = null;
  }

  function paintThemes() {
    Array.prototype.forEach.call(document.querySelectorAll(".theme-sw"), function (b) {
      b.classList.toggle("is-on", b.dataset.t === state.theme);
    });
    var map = { paper: "纸", ink: "墨", red: "朱", teal: "青" };
    $("#themeName").textContent = map[state.theme] || "纸";
  }

  function paintTones() {
    Array.prototype.forEach.call(document.querySelectorAll(".tone-dot"), function (b) {
      b.classList.toggle("is-on", Number(b.dataset.tone) === Number(state.tone));
    });
    var prev = $("#avatarPrev");
    prev.dataset.tone = String(state.tone);
    if (state.draft.avatar) {
      prev.innerHTML = '<img src="' + state.draft.avatar + '" alt="头像预览">';
    } else {
      prev.textContent = (state.draft.nickname || "义").slice(0, 1);
    }
  }

  function paintUploads() {
    var grid = $("#upGrid");
    var g = state.draft.gallery || [];
    grid.innerHTML = g.map(function (item, i) {
      if (item.src) {
        return '<div class="upcell"><img src="' + item.src + '" alt="相册照片">' +
          '<button class="upcell__del" type="button" data-del="' + i + '" aria-label="删除">✕</button></div>';
      }
      return '<div class="upcell" data-tone="' + (item.tone || "ink") + '">' +
        '<span class="mono" style="font-size:8px;color:var(--ink-40)">占位图</span>' +
        '<button class="upcell__del" type="button" data-del="' + i + '" aria-label="删除">✕</button></div>';
    }).join("");
    if (g.length < MAX_GALLERY) {
      grid.innerHTML += '<button class="upcell upcell--add" type="button" data-add-photo>＋ 添加<br>照片</button>';
    }
  }

  function clearErrors() {
    Array.prototype.forEach.call(document.querySelectorAll(".perr"), function (e) {
      e.textContent = "";
      e.classList.remove("is-on");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".pfield input, .pfield textarea"), function (e) {
      e.classList.remove("is-error");
    });
  }

  function setErr(id, msg) {
    var input = $("#" + id);
    var err = document.querySelector('[data-err="' + id + '"]');
    if (err) { err.textContent = msg; err.classList.add("is-on"); }
    if (input) input.classList.add("is-error");
  }

  document.addEventListener("click", function (e) {
    var sw = e.target.closest(".theme-sw");
    if (sw) {
      state.theme = sw.dataset.t;
      paintThemes();
      return;
    }
    var dot = e.target.closest(".tone-dot");
    if (dot) {
      state.tone = Number(dot.dataset.tone);
      paintTones();
      return;
    }
    var add = e.target.closest("[data-add-photo]");
    if (add) { $("#fileGallery").click(); return; }

    var del = e.target.closest("[data-del]");
    if (del && state.draft) {
      state.draft.gallery.splice(Number(del.dataset.del), 1);
      paintUploads();
      return;
    }

    var avBtn = e.target.closest("[data-pick-avatar]");
    if (avBtn) { $("#fileAvatar").click(); return; }

    var clr = e.target.closest("[data-clear-avatar]");
    if (clr) {
      state.draft.avatar = "";
      paintTones();
      return;
    }
  });

  $("#editClose").addEventListener("click", closeEditor);
  $("#editCancel").addEventListener("click", closeEditor);
  $("#editVeil").addEventListener("click", closeEditor);

  /* ---------------- image intake ---------------- */
  function fileToDataURL(file, max, cb) {
    if (!/^image\//.test(file.type)) { cb(null); return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        var ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        try {
          cb(c.toDataURL("image/jpeg", 0.82));
        } catch (err) {
          cb(null);
        }
      };
      img.onerror = function () { cb(null); };
      img.src = ev.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  $("#fileAvatar").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f || !state.draft) return;
    if (f.size > 8 * 1024 * 1024) { toast("图片超过 8MB，换一张小一点的"); return; }
    fileToDataURL(f, 480, function (url) {
      if (!url) { toast("这张图片读不出来，换一张试试"); return; }
      state.draft.avatar = url;
      paintTones();
    });
  });

  $("#fileGallery").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = "";
    if (!state.draft) return;
    var room = MAX_GALLERY - state.draft.gallery.length;
    if (room <= 0) { toast("最多 " + MAX_GALLERY + " 张照片"); return; }
    files.slice(0, room).forEach(function (f) {
      if (f.size > 8 * 1024 * 1024) { toast("「" + f.name + "」超过 8MB，已跳过"); return; }
      fileToDataURL(f, 1100, function (url) {
        if (!url) { toast("有一张图片读不出来，已跳过"); return; }
        state.draft.gallery.push({ src: url, label: "现场照片", glyph: "照", tone: "ink" });
        paintUploads();
      });
    });
  });

  /* ---------------- save ---------------- */
  $("#editSave").addEventListener("click", function () {
    if (!state.draft) return;
    clearErrors();

    var nick = $("#fNick").value.trim();
    var tag = $("#fTag").value.trim();
    var role = $("#fRole").value.trim();
    var city = $("#fCity").value.trim();
    var ph = $("#fPhone").value.trim().replace(/\s|-/g, "");
    var wx = $("#fWechat").value.trim();
    var bio = $("#fBio").value.trim();
    var tags = $("#fTags").value.split(/[、,，]+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8);

    var bad = false;
    if (nick.length < 2 || nick.length > 14) { setErr("fNick", "昵称 2-14 个字"); bad = true; }
    if (tag.length > 40) { setErr("fTag", "签名最多 40 个字"); bad = true; }
    if (ph && !/^1[3-9]\d{9}$/.test(ph)) { setErr("fPhone", "手机号格式不正确"); bad = true; }
    if (wx.length > 30) { setErr("fWechat", "微信号最多 30 个字符"); bad = true; }
    if (bio.length > 200) { setErr("fBio", "简介最多 200 个字"); bad = true; }
    if (bad) {
      toast("有几处需要改一下");
      return;
    }

    var doing = [];
    for (var i = 1; i <= 3; i++) {
      var t = $("#d" + i + "t").value.trim();
      var d = $("#d" + i + "d").value.trim();
      if (t) doing.push({ t: t.slice(0, 24), d: d.slice(0, 90) });
    }

    state.draft.nickname = nick;
    state.draft.tagline = tag;
    state.draft.role = role.slice(0, 20);
    state.draft.city = city.slice(0, 20);
    state.draft.phone = ph;
    state.draft.wechat = wx;
    state.draft.bio = bio;
    state.draft.tags = tags;
    state.draft.doing = doing;
    state.draft.theme = state.theme;
    state.draft.tone = state.tone;
    state.draft.updated = today();

    var saveBtn = $("#editSave");
    saveBtn.disabled = true;
    persist(state.draft).then(function (r) {
      saveBtn.disabled = false;
      if (!r.ok) {
        toast(r.status === 413 ? "图片太大了，删掉两张再试" : (r.msg || "保存失败，请重试"));
        return;
      }
      profile = r.profile;
      if (r.user) A.updateSession({ nickname: r.user.nickname, tone: r.user.tone });
      closeEditor();
      render();
      toast("主页已更新");
    });
  });

  /* ---------------- boot ---------------- */
  function notFound(title, desc) {
    $("#nfTitle").textContent = title;
    $("#nfDesc").textContent = desc;
    $("#profileMain").hidden = true;
    $("#notFound").hidden = false;
  }

  (function boot() {
    if (!phone && !byId) {
      notFound("先登录，再装扮", "每个手机号对应一个主页。登录后就能写下你在义乌做的事，加上电话、微信和照片。");
      return;
    }

    var q = byId ? "id=" + encodeURIComponent(byId) : "u=" + encodeURIComponent(phone);
    A.api("GET", "/api/profiles?" + q).then(function (r) {
      if (!r.ok) {
        notFound("主页暂时打不开", r.status === 0 ? "网络异常，请稍后刷新重试。" : "这个链接不正确。");
        return;
      }
      isOwner = !!r.isOwner;
      session = A.getSession();
      serverPosts = r.posts || [];
      serverLikes = r.likes || 0;
      var seeds = seedProfiles();

      if (r.profile) {
        profile = r.profile;
      } else if (phone && seeds[phone]) {
        profile = seeds[phone];
      } else if (isOwner && session) {
        profile = defaultProfile(session);
      } else {
        notFound("这个主页还没被布置", (phone ? phone.replace(/(\d{3})\d{4}(\d{4})/, "$1 **** $2") : "这位圈友") + " 还没有填写主页资料。");
        return;
      }

      $("#notFound").hidden = true;
      $("#profileMain").hidden = false;
      render();
    });
  })();
})();
