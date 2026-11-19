/* ==========================================================================
   义乌AI圈 · 后台数据层
   单机演示数据库：localStorage 持久化，结构与真实后端表一一对应。
   ========================================================================== */
(function () {
  "use strict";

  var KEY = "ywai.admin.db.v1";
  var DAY = 86400000;

  function iso(offsetDays) {
    return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
  }

  function uid(prefix, n) {
    return prefix + "-" + String(n).padStart(3, "0");
  }

  function seed() {
    return {
      meta: { version: 1, createdAt: Date.now() },

      stats: {
        revenue: [820, 1190, 640, 1580, 1220, 2100, 960, 1740, 1490, 2380, 2010, 2640],
        signups: [3, 5, 2, 6, 4, 8, 3, 7, 5, 9, 6, 11],
        visits: [420, 510, 380, 620, 590, 740, 610, 830, 760, 910, 870, 1040]
      },

      plans: [
        {
          id: "free", name: "体验版", price: 0, unit: "月", active: true, tone: "mute",
          desc: "先逛一圈，看看圈子里的活人。",
          features: ["浏览社区、AI 工具与商家", "每月 3 次发帖", "AI 工具试用 1 次", "线下活动围观"]
        },
        {
          id: "pro", name: "经营者", price: 399, unit: "月", active: true, tone: "red",
          desc: "一个人跑通选品、上架、发货。",
          features: ["无限发帖与评论", "查看商家真实联系方式", "AI 工具 9 折", "每月 1 次档口对接"]
        },
        {
          id: "studio", name: "老板娘", price: 1299, unit: "月", active: true, tone: "ink",
          desc: "带团队，多个账号一起干活。",
          features: ["3 个子账号", "全部 AI 工具不限量", "优先对接与代运营", "线下据点优先预约"]
        }
      ],

      users: [
        { id: "U-1042", name: "义乌阿岚", phone: "13800138000", plan: "pro", status: "active", joined: iso(-128), expire: iso(22), spend: 4788, posts: 36, tone: 1, note: "" },
        { id: "U-1039", name: "阿灿", phone: "13911112222", plan: "studio", status: "active", joined: iso(-210), expire: iso(18), spend: 12800, posts: 84, tone: 2, note: "跨境内容服务商" },
        { id: "U-1037", name: "哈桑在中国", phone: "13655556666", plan: "pro", status: "active", joined: iso(-96), expire: iso(45), spend: 2793, posts: 28, tone: 3, note: "中东采购" },
        { id: "U-1035", name: "朱哥尾货", phone: "13755551203", plan: "studio", status: "active", joined: iso(-320), expire: iso(60), spend: 16800, posts: 152, tone: 1, note: "北下朱 B-12" },
        { id: "U-1033", name: "老莫货代", phone: "13566667777", plan: "pro", status: "expired", joined: iso(-300), expire: iso(-6), spend: 4788, posts: 41, tone: 2, note: "待到账续费" },
        { id: "U-1031", name: "小满", phone: "13822223333", plan: "pro", status: "active", joined: iso(-75), expire: iso(30), spend: 1596, posts: 19, tone: 3, note: "" },
        { id: "U-1029", name: "阿哲", phone: "13988889999", plan: "free", status: "active", joined: iso(-64), expire: "", spend: 0, posts: 7, tone: 1, note: "找 RTL 前端" },
        { id: "U-1027", name: "义乌小陈", phone: "13811119999", plan: "free", status: "active", joined: iso(-88), expire: "", spend: 0, posts: 23, tone: 2, note: "" },
        { id: "U-1025", name: "楼厂长", phone: "13566663388", plan: "pro", status: "active", joined: iso(-240), expire: iso(12), spend: 7173, posts: 12, tone: 3, note: "廿三里注塑" },
        { id: "U-1023", name: "吴姐", phone: "13922227706", plan: "free", status: "frozen", joined: iso(-150), expire: "", spend: 0, posts: 3, tone: 1, note: "因刷屏被冻结" },
        { id: "U-1021", name: "金师傅", phone: "13733335518", plan: "pro", status: "active", joined: iso(-190), expire: iso(88), spend: 3591, posts: 16, tone: 2, note: "佛堂红糖" },
        { id: "U-1019", name: "小林", phone: "13544446621", plan: "pro", status: "active", joined: iso(-44), expire: iso(26), spend: 1197, posts: 9, tone: 3, note: "方格视觉" },
        { id: "U-1017", name: "周经理", phone: "13811119922", plan: "free", status: "active", joined: iso(-160), expire: "", spend: 0, posts: 5, tone: 1, note: "" },
        { id: "U-1015", name: "圈助手", phone: "13000000000", plan: "free", status: "active", joined: iso(-365), expire: "", spend: 0, posts: 128, tone: 2, note: "官方账号" },
        { id: "U-1013", name: "陈经理", phone: "13888888821", plan: "pro", status: "active", joined: iso(-260), expire: iso(34), spend: 5985, posts: 22, tone: 3, note: "恒通货代" },
        { id: "U-1011", name: "阿庆", phone: "13677774410", plan: "studio", status: "active", joined: iso(-288), expire: iso(72), spend: 9357, posts: 64, tone: 1, note: "青口直播基地" },
        { id: "U-1009", name: "王工", phone: "13522228888", plan: "pro", status: "expired", joined: iso(-220), expire: iso(-30), spend: 2394, posts: 11, tone: 2, note: "" },
        { id: "U-1007", name: "李姐", phone: "13699990011", plan: "free", status: "active", joined: iso(-38), expire: "", spend: 0, posts: 2, tone: 3, note: "" },
        { id: "U-1005", name: "小北", phone: "13788882233", plan: "pro", status: "active", joined: iso(-52), expire: iso(14), spend: 798, posts: 6, tone: 1, note: "" },
        { id: "U-1003", name: "阿力", phone: "13966665544", plan: "free", status: "active", joined: iso(-21), expire: "", spend: 0, posts: 1, tone: 2, note: "" }
      ],

      orders: [
        { id: "YW-20261116-01", userId: "U-1042", userName: "义乌阿岚", plan: "pro", amount: 399, method: "alipay", status: "paid", createdAt: iso(0) },
        { id: "YW-20261115-03", userId: "U-1019", userName: "小林", plan: "pro", amount: 399, method: "alipay", status: "paid", createdAt: iso(-1) },
        { id: "YW-20261115-02", userId: "U-1037", userName: "哈桑在中国", plan: "pro", amount: 399, method: "alipay", status: "paid", createdAt: iso(-1) },
        { id: "YW-20261114-05", userId: "U-1011", userName: "阿庆", plan: "studio", amount: 1299, method: "wechat", status: "paid", createdAt: iso(-2) },
        { id: "YW-20261114-02", userId: "U-1021", userName: "金师傅", plan: "pro", amount: 399, method: "wechat", status: "pending", createdAt: iso(-2) },
        { id: "YW-20261113-04", userId: "U-1031", userName: "小满", plan: "pro", amount: 399, method: "wechat", status: "paid", createdAt: iso(-3) },
        { id: "YW-20261113-01", userId: "U-1033", userName: "老莫货代", plan: "pro", amount: 399, method: "alipay", status: "refund", createdAt: iso(-3) },
        { id: "YW-20261112-06", userId: "U-1013", userName: "陈经理", plan: "pro", amount: 399, method: "bank", status: "paid", createdAt: iso(-4) },
        { id: "YW-20261112-02", userId: "U-1025", userName: "楼厂长", plan: "pro", amount: 399, method: "alipay", status: "paid", createdAt: iso(-4) },
        { id: "YW-20261111-03", userId: "U-1039", userName: "阿灿", plan: "studio", amount: 1299, method: "wechat", status: "paid", createdAt: iso(-5) },
        { id: "YW-20261110-02", userId: "U-1035", userName: "朱哥尾货", plan: "studio", amount: 1299, method: "bank", status: "paid", createdAt: iso(-6) },
        { id: "YW-20261109-01", userId: "U-1009", userName: "王工", plan: "pro", amount: 399, method: "alipay", status: "refund", createdAt: iso(-7) },
        { id: "YW-20261108-04", userId: "U-1005", userName: "小北", plan: "pro", amount: 399, method: "wechat", status: "paid", createdAt: iso(-8) }
      ],

      merchants: [
        { id: "M-001", name: "恒通货代", stall: "Ⅱ-17-088", zone: "tradecity", zoneName: "国际商贸城二区", owner: "陈经理", phone: "138 8888 8821", wechat: "hengtong_yw", tags: ["中东专线", "双清包税", "拼柜"], intro: "中东与非洲专线，双清包税，每周三、周六固定拼柜，可代做产地证与商业发票。", level: "diamond", minOrder: "1 方", leadTime: "48 小时内", hours: "08:30 - 17:30", license: "91330782MA2A1B3C4", certExpire: iso(240), verified: true, status: "approved", rejectReason: "", featured: true, weight: 100, views: 2860, leads: 48, joined: iso(-260), updated: iso(-3) },
        { id: "M-002", name: "朱哥尾货仓", stall: "B-12", zone: "beixiazhu", zoneName: "北下朱电商小镇", owner: "朱哥", phone: "137 5555 1203", wechat: "zhuge_huoyuan", tags: ["一件代发", "9.9 包邮", "直播供货"], intro: "北下朱现货仓，清仓尾货与直播货盘，支持一件代发。", level: "gold", minOrder: "1 件", leadTime: "当天", hours: "07:00 - 22:00", license: "91330782MA2C7D8E2", certExpire: iso(180), verified: true, status: "approved", rejectReason: "", featured: true, weight: 98, views: 4210, leads: 132, joined: iso(-318), updated: iso(-1) },
        { id: "M-003", name: "青口直播基地", stall: "QK-C03", zone: "qingkou", zoneName: "江东街道青口", owner: "阿庆", phone: "136 7777 4410", wechat: "qingkou_live", tags: ["50+ 直播间", "设备租赁", "主播培训"], intro: "52 间直播间 24 小时可用，设备租赁与新手主播孵化。", level: "diamond", minOrder: "4 小时", leadTime: "当天", hours: "24 小时", license: "91330782MA2E3F9A6", certExpire: iso(150), verified: true, status: "approved", rejectReason: "", featured: true, weight: 96, views: 1980, leads: 64, joined: iso(-286), updated: iso(-4) },
        { id: "M-004", name: "三立注塑", stall: "G-21", zone: "niansanli", zoneName: "廿三里工厂带", owner: "楼厂长", phone: "135 6666 3388", wechat: "sanli_mould", tags: ["小批量开模", "来样加工"], intro: "小批量开模与来样加工，500 件起做，7 天打样。", level: "normal", minOrder: "500 件", leadTime: "7 天打样", hours: "08:00 - 18:00", license: "91330782MA2G5H1J8", certExpire: iso(90), verified: true, status: "approved", rejectReason: "", featured: false, weight: 80, views: 940, leads: 21, joined: iso(-238), updated: iso(-8) },
        { id: "M-005", name: "明视眼镜", stall: "Ⅲ-05-113", zone: "tradecity", zoneName: "国际商贸城三区", owner: "吴姐", phone: "139 2222 7706", wechat: "mingshi_optical", tags: ["出厂直供", "小单快反"], intro: "眼镜出厂直供，支持贴牌与定制包装，50 副起批。", level: "gold", minOrder: "50 副", leadTime: "48 小时", hours: "08:30 - 17:30", license: "91330782MA2K6L2M4", certExpire: iso(26), verified: true, status: "approved", rejectReason: "", featured: false, weight: 88, views: 1620, leads: 37, joined: iso(-205), updated: iso(-5) },
        { id: "M-006", name: "袜都针织", stall: "Ⅳ-12-046", zone: "tradecity", zoneName: "国际商贸城四区", owner: "周经理", phone: "138 1111 9922", wechat: "wadu_knit", tags: ["秋冬打底", "5 件起批"], intro: "秋冬打底与运动袜，5 件起批，季末清仓价格更低。", level: "normal", minOrder: "5 件", leadTime: "当天", hours: "08:30 - 17:30", license: "91330782MA2N8P3Q6", certExpire: iso(120), verified: true, status: "approved", rejectReason: "", featured: false, weight: 72, views: 760, leads: 18, joined: iso(-198), updated: iso(-12) },
        { id: "M-007", name: "方格视觉", stall: "QK-A07", zone: "qingkou", zoneName: "青口直播基地", owner: "小林", phone: "135 4444 6621", wechat: "fangge_visual", tags: ["商品图", "短视频", "AI 换背景"], intro: "商品图与短视频拍摄，白底、场景、模特三条线，24 小时交付。", level: "normal", minOrder: "10 张", leadTime: "24 小时", hours: "09:00 - 21:00", license: "", certExpire: "", verified: false, status: "pending", rejectReason: "", featured: false, weight: 60, views: 120, leads: 2, joined: iso(-3), updated: iso(-3) },
        { id: "M-008", name: "佛堂红糖文创", stall: "F-08", zone: "fotang", zoneName: "佛堂古镇", owner: "金师傅", phone: "137 3333 5518", wechat: "fotang_tang", tags: ["非遗工艺", "礼盒定制"], intro: "非遗红糖与文创礼盒，支持企业定制与一件代发。", level: "normal", minOrder: "20 盒", leadTime: "3 天打样", hours: "08:30 - 17:00", license: "", certExpire: "", verified: false, status: "pending", rejectReason: "", featured: false, weight: 60, views: 90, leads: 1, joined: iso(-2), updated: iso(-2) },
        { id: "M-009", name: "新光饰品", stall: "Ⅰ-03-207", zone: "tradecity", zoneName: "国际商贸城一区", owner: "王某", phone: "138 0000 0000", wechat: "", tags: ["饰品"], intro: "", level: "normal", minOrder: "1 件", leadTime: "—", hours: "—", license: "", certExpire: "", verified: false, status: "rejected", rejectReason: "营业执照与档口照片不符，请补充租赁合同。", featured: false, weight: 50, views: 30, leads: 0, joined: iso(-9), updated: iso(-7) }
      ],

      products: [
        { id: "AI-001", name: "选品雷达 Pro", cat: "tool", platform: "全平台", price: 399, unit: "月", billing: "monthly", trial: 7, commission: 15, delivery: "网页端", langs: "中文 / 英文", vendor: "云枢数据", desc: "实时监控 TikTok、亚马逊与 1688 热榜，按义乌品类给出爆品信号。", badge: "热门", status: "on", featured: true, sales: 186, revenue: 74214, weight: 100, updated: iso(-2) },
        { id: "AI-002", name: "多语种 Listing 工厂", cat: "tool", platform: "TikTok Shop", price: 0.5, unit: "条", billing: "per-unit", trial: 0, commission: 10, delivery: "API / 网页", langs: "12 种语言", vendor: "字舟科技", desc: "输入义乌货号，一次输出 12 种语言的标题、描述与关键词。", badge: "", status: "on", featured: false, sales: 12840, revenue: 6420, weight: 96, updated: iso(-1) },
        { id: "AI-003", name: "商品图重制", cat: "tool", platform: "亚马逊", price: 1.2, unit: "张", billing: "per-unit", trial: 0, commission: 12, delivery: "网页 / 插件", langs: "中文 / 英文", vendor: "方格视觉", desc: "白底图、场景图、模特图 30 秒出图，批量换背景。", badge: "", status: "on", featured: false, sales: 9320, revenue: 11184, weight: 92, updated: iso(-3) },
        { id: "AI-004", name: "数字人口播工厂", cat: "tool", platform: "TikTok Shop", price: 299, unit: "月", billing: "monthly", trial: 3, commission: 20, delivery: "网页端", langs: "12 种语言", vendor: "青口内容实验室", desc: "12 种语言口播视频，绑定当日热点脚本，一个人也能日更。", badge: "新上", status: "on", featured: true, sales: 97, revenue: 29003, weight: 94, updated: iso(-1) },
        { id: "AI-005", name: "询盘翻译官", cat: "tool", platform: "独立站", price: 199, unit: "月", billing: "monthly", trial: 7, commission: 15, delivery: "浏览器插件", langs: "9 种语言", vendor: "译站网络", desc: "WhatsApp 与邮件询盘实时翻译，自动生成带利润率的报价。", badge: "", status: "on", featured: false, sales: 64, revenue: 12736, weight: 86, updated: iso(-6) },
        { id: "AI-006", name: "尾货估价", cat: "tool", platform: "1688", price: 0, unit: "内测", billing: "free", trial: 0, commission: 0, delivery: "小程序", langs: "中文", vendor: "北下朱数据组", desc: "基于历史成交数据估算合理收购价，附同品类成交区间。", badge: "内测", status: "off", featured: false, sales: 0, revenue: 0, weight: 70, updated: iso(-9) },
        { id: "SV-001", name: "出口合规查", cat: "service", platform: "亚马逊", price: 99, unit: "月", billing: "monthly", trial: 0, commission: 8, delivery: "报告 PDF", langs: "中文 / 阿拉伯语", vendor: "明关咨询", desc: "出口国认证、标签、限售品类自查，2 小时出报告。", badge: "", status: "on", featured: false, sales: 142, revenue: 14058, weight: 84, updated: iso(-4) },
        { id: "SV-002", name: "档口 SaaS", cat: "service", platform: "全平台", price: 599, unit: "年", billing: "yearly", trial: 14, commission: 10, delivery: "App + 后台", langs: "中文", vendor: "档口云", desc: "库存、一件代发、对账单三合一，手机就能开单。", badge: "", status: "on", featured: false, sales: 38, revenue: 22762, weight: 78, updated: iso(-7) },
        { id: "TP-001", name: "中东节日营销日历", cat: "template", platform: "独立站", price: 49, unit: "份", billing: "per-unit", trial: 0, commission: 30, delivery: "Notion + 表格", langs: "中文 / 阿拉伯语", vendor: "哈桑工作室", desc: "斋月、开斋节、白色星期五的备货节奏与内容排期模板。", badge: "", status: "on", featured: false, sales: 216, revenue: 10584, weight: 74, updated: iso(-5) },
        { id: "ST-001", name: "圣诞尾货货盘", cat: "stock", platform: "1688", price: 1.8, unit: "件", billing: "per-unit", trial: 0, commission: 5, delivery: "实物货盘", langs: "中文", vendor: "义乌小陈", desc: "商贸城二区工厂尾单，500 起拿，支持混批与一件代发。", badge: "尾货", status: "off", featured: false, sales: 0, revenue: 0, weight: 60, updated: iso(-10) }
      ],

      dicts: {
        zones: [
          { v: "tradecity", t: "国际商贸城" },
          { v: "beixiazhu", t: "北下朱" },
          { v: "qingkou", t: "青口" },
          { v: "niansanli", t: "廿三里" },
          { v: "fotang", t: "佛堂" }
        ],
        cats: [
          { v: "tool", t: "AI 工具" },
          { v: "service", t: "服务" },
          { v: "template", t: "模板" },
          { v: "stock", t: "货盘" }
        ]
      },

      articles: [
        { id: "A-021", title: "义乌跨境电商综试区扶持政策", type: "政策", source: "义乌市商务局", status: "published", pinned: true, date: iso(-4), summary: "对年交易额超 100 万美元的跨境电商企业给予一次性 10 万元奖励；新建海外仓按投资额 30% 补贴。", body: "" },
        { id: "A-020", title: "小型商品出口查验率下调至 8%", type: "政策", source: "义乌海关", status: "published", pinned: true, date: iso(-6), summary: "单件低于 5kg 的小型商品出口查验率从 12% 下调至 8%，B2C 包裹可走集中申报、清单核放。", body: "" },
        { id: "A-019", title: "个体户跨境电商所得税核定征收", type: "政策", source: "义乌市税务局", status: "published", pinned: false, date: iso(-8), summary: "年销售额 500 万以下按 0.8% 核定应税所得率。", body: "" },
        { id: "A-018", title: "义乌个体户注册「一网通办」升级", type: "政策", source: "义乌市市场监管局", status: "published", pinned: false, date: iso(-11), summary: "全程线上办理，1 个工作日办结，外籍创业者可凭护照在线申请。", body: "" },
        { id: "A-017", title: "市场采购贸易方式 1039 扩容", type: "政策", source: "商务部", status: "published", pinned: false, date: iso(-14), summary: "新增文创产品、数码配件等 12 个品类，单票货值上限提升至 15 万美元。", body: "" },
        { id: "A-016", title: "义乌电商直播基地扶持政策", type: "政策", source: "义乌市文化和旅游局", status: "draft", pinned: false, date: iso(-1), summary: "入驻指定直播基地的主播享前 6 个月免租，年销超 1000 万额外奖励 5 万元。", body: "" },
        { id: "A-015", title: "2026 圣诞季备货节奏观察", type: "资讯", source: "圈内编辑部", status: "published", pinned: false, date: iso(-2), summary: "中东与欧美补货窗口提前两周，毛绒与灯串类目询盘同比增长 41%。", body: "" },
        { id: "A-014", title: "TikTok Shop 义乌直发新规解读", type: "资讯", source: "运营组", status: "draft", pinned: false, date: iso(0), summary: "义乌直发通道日订单上限提升至 500 单，对发货时效提出新要求。", body: "" }
      ],

      posts: [
        { id: "P-009", author: "义乌阿岚", tag: "选品", title: "沙特客户要的包装，和欧美完全是两套逻辑", likes: 87, comments: 12, reports: 0, status: "normal", date: iso(0) },
        { id: "P-001", author: "阿灿", tag: "选品", title: "用 AI 把 1688 详情页改成 TikTok 脚本，一条视频卖了 400 单", likes: 129, comments: 23, reports: 0, status: "normal", date: iso(0) },
        { id: "P-002", author: "哈桑在中国", tag: "合规", title: "Arabic 标签不是翻译就行：沙特 SASO 这几个字段最容易漏", likes: 96, comments: 18, reports: 0, status: "normal", date: iso(0) },
        { id: "P-003", author: "老莫货代", tag: "物流", title: "义乌到利雅得新舱位，含税 18.6/kg，周三截单", likes: 64, comments: 31, reports: 0, status: "normal", date: iso(0) },
        { id: "P-004", author: "朱哥尾货", tag: "直播", title: "青口今晚 8 点空出一间直播间，4 小时免费给新手", likes: 211, comments: 57, reports: 0, status: "normal", date: iso(0) },
        { id: "P-005", author: "小满", tag: "AI工具", title: "数字人直播 30 天复盘：GMV 4.2 万，退货率 11%", likes: 173, comments: 44, reports: 0, status: "normal", date: iso(-1) },
        { id: "P-006", author: "吴姐", tag: "选品", title: "【爆款】加微信 xxxx 拿一手货源，日赚三千不是梦", likes: 2, comments: 14, reports: 6, status: "reported", date: iso(-1) },
        { id: "P-007", author: "阿哲", tag: "求助", title: "有没有人做中东独立站？想找一个懂 RTL 排版的前端", likes: 27, comments: 19, reports: 0, status: "normal", date: iso(-1) },
        { id: "P-008", author: "阿力", tag: "闲聊", title: "测试发帖，忽略我", likes: 0, comments: 0, reports: 0, status: "hidden", date: iso(-2) }
      ],

      settings: {
        siteName: "义乌AI圈",
        tagline: "让每个档口都有一支 AI 团队",
        description: "供应链直联、AI 工具共建、订单撮合的实战社区。",
        ticker: [
          "美元 / 人民币 7.2415 ▲ 0.12%",
          "今日可发货源 3,204",
          "中东专线舱位 92%",
          "义乌 → 利雅得 18.6 元/kg",
          "今日新帖 46",
          "认证商家 128"
        ],
        toggles: {
          register: true,
          inviteOnly: false,
          comment: true,
          showPrice: true,
          merchantApply: true,
          maintenance: false
        },
        pay: {
          alipay: "ywai@alipay.com",
          wechat: "ywai_pay",
          bank: "义乌农商银行 2010 0088 7766 5544",
          trialDays: 7,
          autoRenew: true
        },
        admin: { user: "admin", pass: "ywai2026", name: "管理员" }
      }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var db = JSON.parse(raw);
      if (!db || !db.users || !db.settings) return null;
      return db;
    } catch (e) {
      return null;
    }
  }

  function migrate(src) {
    if (!src.dicts) {
      src.dicts = {
        zones: [
          { v: "tradecity", t: "国际商贸城" },
          { v: "beixiazhu", t: "北下朱" },
          { v: "qingkou", t: "青口" },
          { v: "niansanli", t: "廿三里" },
          { v: "fotang", t: "佛堂" }
        ],
        cats: [
          { v: "tool", t: "AI 工具" },
          { v: "service", t: "服务" },
          { v: "template", t: "模板" },
          { v: "stock", t: "货盘" }
        ]
      };
    }
    (src.merchants || []).forEach(function (m) {
      if (m.intro === undefined) m.intro = "";
      if (m.level === undefined) m.level = "normal";
      if (m.minOrder === undefined) m.minOrder = "1 件";
      if (m.leadTime === undefined) m.leadTime = "当天";
      if (m.hours === undefined) m.hours = "08:30 - 17:30";
      if (m.license === undefined) m.license = "";
      if (m.certExpire === undefined) m.certExpire = "";
      if (m.rejectReason === undefined) m.rejectReason = "";
      if (m.weight === undefined) m.weight = 60;
      if (m.views === undefined) m.views = 0;
      if (m.leads === undefined) m.leads = 0;
      if (m.updated === undefined) m.updated = m.joined || "";
    });
    (src.products || []).forEach(function (p) {
      if (p.billing === undefined) p.billing = p.price ? "monthly" : "free";
      if (p.trial === undefined) p.trial = 0;
      if (p.commission === undefined) p.commission = 10;
      if (p.delivery === undefined) p.delivery = "网页端";
      if (p.langs === undefined) p.langs = "中文 / 英文";
      if (p.badge === undefined) p.badge = "";
      if (p.weight === undefined) p.weight = 60;
      if (p.revenue === undefined) p.revenue = 0;
      if (p.desc === undefined) p.desc = "";
      if (p.updated === undefined) p.updated = "";
    });
    return src;
  }

  var db = load();
  var fresh = false;
  if (!db) {
    db = seed();
    fresh = true;
  }
  db = migrate(db);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }

  function reset() {
    db = seed();
    save();
    return db;
  }

  function nextId(prefix, list, pad) {
    var max = 0;
    list.forEach(function (item) {
      var n = parseInt(String(item.id).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return uid(prefix, max + 1, pad || 3);
  }

  function orderId() {
    var d = new Date();
    var ymd = "" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    var today = db.orders.filter(function (o) { return o.id.indexOf("YW-" + ymd) === 0; }).length + 1;
    return "YW-" + ymd + "-" + String(today).padStart(2, "0");
  }

  function planOf(id) {
    return db.plans.filter(function (p) { return p.id === id; })[0] || db.plans[0];
  }

  function userOf(id) {
    return db.users.filter(function (u) { return u.id === id; })[0] || null;
  }

  function money(n) {
    return "¥" + Number(n || 0).toLocaleString("zh-CN");
  }

  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.ceil((new Date(dateStr + "T23:59:59").getTime() - Date.now()) / DAY);
  }

  function addDays(dateStr, n) {
    var base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    return new Date(base.getTime() + n * DAY).toISOString().slice(0, 10);
  }

  window.AdminDB = {
    db: db,
    KEY: KEY,
    fresh: fresh,
    save: save,
    reset: reset,
    seed: seed,
    nextId: nextId,
    orderId: orderId,
    planOf: planOf,
    userOf: userOf,
    money: money,
    daysLeft: daysLeft,
    addDays: addDays
  };
})();
