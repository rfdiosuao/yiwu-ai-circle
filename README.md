# 义乌AI圈 · Yiwu AI Circle

供应链直联、AI 工具、商家名录的社区站点。纯 Node.js（≥ 20）内置模块实现，**无需 `npm install`**。

## 本地运行

```bash
npm start
# 打开 http://localhost:8000
```

- 开发环境默认监听 `127.0.0.1`，演示短信会在页面显示验证码。
- 首次使用运营后台 `/admin.html` 前，配置 `ADMIN_USER` 和 `ADMIN_PASS`。升级前已有的后台哈希账号仍可登录。
- `npm run check` 检查 JavaScript 语法，`npm test` 启动隔离实例运行回归测试。

## 数据持久化

所有业务数据保存在 `data/db.json`（目录可用 `DATA_DIR` 修改，已加入 `.gitignore`）：

| 数据 | 说明 |
| --- | --- |
| 用户 | 手机号、昵称、头像色、密码（scrypt 加盐哈希） |
| 个人主页 | 简介、标签、联系方式、头像与相册（压缩后的图片） |
| 社区 | 圈友帖子、点赞、收藏、评论 |
| 商家认证 | 认证申请资料 |
| 运营后台 | 商家、AI 工具、资讯、方案、订单、站点设置。新生产实例从空商家、工具、资讯、订单和统计起步 |
| 后台账号 | 账号与 scrypt 哈希后的密码（不再明文保存，也不会下发到浏览器） |
| 操作日志 | 后台登录、改账号、保存数据、处理用户/帖子/认证/客资的记录，保留最近 500 条 |
| 活动与客资 | 活动报名页配置（含开始 / 结束时间、主办方与组织单位、流程安排、活动议题、温馨提示、报名咨询、底部标语、邀请函样式与信件内容、发邮件用的邀请函图片）、扫码报名提交的称呼 / 手机 / 邮箱 / 公司 / 需求、邀请函邮件的发送状态及跟进状态 |
| 合作伙伴 | 首页滚动展示的赞助方、合作方、支持方：名称、类型、Logo、官网链接、排序、是否展示 |
| 上传文件 | 活动海报、长图主视觉、长图顶部的主办协办 Logo、背景音乐和合作伙伴 Logo，存放在 `data/uploads/`，经 `/uploads/…` 访问 |

写盘采用「临时文件 + rename」，进程退出前会强制落盘。**备份只需复制 `data/` 目录。**
单实例部署足够；后续访问量上来可把 `lib/store.js` 换成 SQLite / Postgres，接口不用改。

## 配置

环境变量优先；不方便注入环境变量时，复制 `secrets.example.json` 为 `secrets.json` 填写（已被 git 忽略）。

| 变量 | 说明 |
| --- | --- |
| `PORT` | 端口，默认 8000 |
| `PUBLIC_URL` | 对外访问地址，如 `https://www.example.com`。活动二维码、邀请函和长图海报上的二维码、邀请函邮件里的链接都用它，上线务必填写 |
| `SMTP_HOST` / `SMTP_PORT` | 发信服务器和端口，如 QQ 邮箱 `smtp.qq.com` / `465`、腾讯企业邮 `smtp.exmail.qq.com` / `465`、阿里云邮件推送 `smtpdm.aliyun.com` / `465`。不填就不发邀请函邮件 |
| `SMTP_SECURE` | `ssl`（465 端口默认）或 `starttls`（其他端口默认）；`none` 只能在本机测试用，生产环境会拒绝启动 |
| `SMTP_USER` / `SMTP_PASS` | 发信邮箱账号和密码。QQ / 163 / 企业邮箱一般要在邮箱设置里开启 SMTP，并用生成的「授权码」当密码 |
| `SMTP_FROM` | 发件人，如 `义乌AI圈 <invite@example.com>`；留空用 `SMTP_USER`。大多数邮箱要求和登录账号一致 |
| `HOST` | 监听地址，默认 `127.0.0.1` |
| `NODE_ENV` | 线上设为 `production`，启用生产配置校验并关闭演示恢复 |
| `SESSION_SECRET` | 生产必填，使用至少 32 字节随机密钥。开发可自动生成并保存到 `data/.session-secret` |
| `ADMIN_USER` / `ADMIN_PASS` | 后台账号。设置后以此为准，忽略后台「设置」页里的账号 |
| `SMS_MODE` | `demo`（演示）或 `api`（真实短信） |
| `SMS_SEND_URL` / `SMS_VERIFY_URL` | 短信上游接口接收表单 POST `phone`、`code`。成功返回 HTTP 2xx 和 JSON `{ "ok": true }`，验证码错误返回 `{ "ok": false }` 或 HTTP 400 / 401 / 403 |
| `WAG_API_KEY` / `WAG_ENTITLEMENT_ID` | 爱猹收支付，商家认证付费用 |
| `CERT_PRICE` | 认证价格，默认 99 |
| `DATA_DIR` | 数据目录，默认 `./data` |
| `COOKIE_SECURE` | `1` 强制 Secure Cookie，生产默认开启 |
| `TRUST_PROXY` / `TRUSTED_PROXY_IPS` | 只有前者设为 `1` 且连接来自后者列出的 IP，才读取反代头。默认可信地址是回环地址 |

## 上线清单

1. 设置 `NODE_ENV=production`、随机 `SESSION_SECRET`，以及 `ADMIN_USER` 和至少 12 位的 `ADMIN_PASS`。已有独立哈希账号可以继续使用。仅有旧版明文账号的部署，首次升级时先配置环境变量账号。
2. 前面挂 Nginx / Caddy 做 HTTPS，限制后端端口只能由反代访问。配置可信反代地址，并由反代覆盖 `X-Forwarded-Proto`、正确设置 `X-Forwarded-For`。
3. 用 systemd / pm2 守护进程，`data/` 放在持久化磁盘上并定期备份。
4. 接真实短信：服务端设 `SMS_MODE=api` 与两个接口地址，同时把 `assets/js/config.js` 里的 `sms.mode` 改为 `"api"`（隐藏页面上的演示提示）。

## 运营后台

后台和前台用的是同一份数据：

- **用户**：前台真实注册的用户。可改方案、到期日、备注；冻结后对方立即登出，且无法登录、发帖、评论。
- **社区帖子**：前台真实帖子。隐藏后前台不可见（可恢复），删除会连同点赞评论一起清除。
- **商家档口**：前台「商家认证」提交的申请会以「认证申请」标签出现在列表里，点「通过」后自动上架为正式商家。
- **商家 / AI 工具**：前台商家页、AI 工具页、首页预览都直接读取后台数据；商家联系方式只对已登录用户返回。
- **站点设置**：开放注册、允许评论、前台展示价格、接受入驻申请、维护模式都会真实生效（服务端校验）。
- **多人编辑**：整库提交要求当前版本号。冲突时当前页面保留编辑结果并停止继续提交，刷新后可按最新版重新应用修改。真实用户、帖子和认证操作在整库请求成功后逐条提交。
- **操作日志**：左侧「操作日志」可查看谁在什么时候改了什么。
- **活动报名**：新建活动时上传海报和背景音乐，选择收集哪些项（称呼 / 公司 / 需求，手机号固定必填），设置截止时间和名额。保存后生成 `/e/<后缀>` 报名链接和二维码（SVG / PNG 下载）。草稿状态只有后台能预览。
- **主办与组织单位**：每场活动可填主办方（默认义乌AI圈，也是邀请函落款）和若干类组织单位，身份名称自己写（指导单位、协办单位、赞助方……），显示在报名页背面、邀请函和长图海报上。旧数据里的赞助 / 合作 / 支持方会自动转成这种格式。
- **流程与议题**：可填结束时间、流程安排（时间 + 环节）、活动议题（题目、分享人、头衔）和温馨提示。报名页把流程和议题收在「查看流程安排和 N 个议题」里，不把报名表挤到下面。
- **邀请函邮件**：报名表可以收邮箱（后台按活动设为不收集 / 选填 / 必填）。报名成功后，服务端把这场活动的邀请函发到报名人邮箱：邮件正文写「尊敬的 + 称呼」和时间地点，附上邀请函图片（信件式：抬头如「各位行业家人们」、正文最多 600 字、落款和落款日期；鸿运朱金 / 墨金典藏 / 海报定制 / 科技蓝长图四种样式）。同一个人再次提交只有换了邮箱才重发，同一个收件地址每天最多 3 封；发送失败自动重试 3 次。客资列表显示邮箱和发送状态，可以「重发邀请函」。没配置 `SMTP_HOST` 时只报名、不发信。
- **会员一键报名**：报名不需要登录；已登录的会员打开报名页，资料自动带出（手机号用账号里验证过的，称呼 / 邮箱 / 公司取上次报名留下的，没有就用昵称和商家认证的店名），这场活动的必填项都有就直接「一键报名」，也可以点「修改报名信息」再提交。报名后把这次填的资料存回账号。
- **邀请函图片**：后台保存活动时，用报名页同一套画图代码在浏览器里重画邀请函并上传（旧图自动删除），邮件附的就是这张；`/e/<后缀>?invite=letter` 是它的在线版，后台活动列表的「邀请函」按钮打开它。
- **长图海报**：后台活动列表的「长图海报」打开 `/e/<后缀>?poster=1`，生成不带称呼的科技蓝长图（主办协办 Logo、标题、主题标语、主视觉、组织单位、时间地点、流程、议题、席位与报名二维码、报名咨询、温馨提示、底部标语），用来发群和朋友圈。标题写成「2026 义乌 · 某某大会」时，前半句做第一行大字。主视觉可以放在标题下方（科技插画，深色底会自动融进背景；不传就用代码画的光效舞台），也可以放在海报底部（场馆、城市实景照片，铺满宽度、往上渐隐）。只有题目、没有分享人的议题画成「核心议题」列表。
- **合作伙伴**：维护赞助方、合作方、支持方，设为展示的会出现在首页底部两排左右反向滚动的展示条里（可暂停；系统开启「减少动态效果」时改为手动横向浏览）。
- **前台活动板块**：首页「近期活动」显示最近 3 场，`events.html` 列出全部即将开始和往期活动。
- **客资**：扫码报名的人无需登录，同一活动同一手机号只保留一条。可按活动、跟进状态筛选，写备注，导出 CSV（Excel 直接打开，导出会记录在操作日志里）。

升级前备份 `data/`。启动时旧后台明文密码转为哈希，并移除旧的演示用户和帖子集合。已有商家、工具、订单和设置会保留。版本号由服务端管理，保存时对记录及设置执行字段校验。浏览器导出会移除结构化的账号口令、联系方式和收款字段，完整备份请使用服务端数据目录。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/send` | 发送验证码（同号 60 秒限频） |
| POST | `/api/auth/session` | 验证码登录 / 注册，失败 5 次锁 60 秒 |
| POST | `/api/auth/password` | 密码登录，失败 5 次锁 5 分钟 |
| GET / PATCH | `/api/auth/session`、`/api/auth/me` | 当前用户 / 改昵称、设密码 |
| GET / POST | `/api/posts` | 帖子列表（含点赞、评论）/ 发帖 |
| POST | `/api/posts/:id/react`、`/api/posts/:id/comments` | 点赞收藏切换 / 评论 |
| DELETE | `/api/posts/:id` | 删除自己的帖子 |
| GET / PUT | `/api/profiles`、`/api/profiles/me` | 查看主页（个人联系方式仅本人可见）/ 保存自己的主页 |
| POST / GET | `/api/cert/apply`、`/api/cert/status` | 商家认证申请 / 支付状态 |
| GET | `/api/site` | 前台读取商家、AI 工具与站点开关 |
| GET | `/api/merchants/:id/contact` | 商家联系方式（需登录） |
| POST | `/api/admin/login`、`/api/admin/account` | 后台登录 / 修改后台账号密码 |
| GET / PUT | `/api/admin/db` | 拉取 / 保存后台数据（带版本号，冲突返回 409） |
| POST / PATCH / DELETE | `/api/admin/members`、`/api/admin/posts/:id`、`/api/admin/applications/:uid` | 管理真实用户、帖子、认证申请 |
| GET / POST | `/api/admin/audit`、`/api/admin/reset` | 操作日志 / 恢复初始内容 |
| GET | `/api/events` | 前台活动列表：即将开始 / 往期（不含草稿、报名人数和内部 id） |
| GET / POST | `/api/events/:slug`、`/api/events/:slug/register` | 活动报名页读取活动（含流程议题、邀请函设置和二维码点阵）/ 提交报名（无需登录，按 IP 和手机号限频；留了邮箱且已配置发信时返回 `mail: "queued"`） |
| GET | `/api/events/:slug/me` | 已登录会员在这场活动的报名资料（手机号打码）和是否已报名；没登录返回 `member: null` |
| PUT | `/api/admin/events/:id/invite-image` | 上传发邮件用的邀请函图片（后台保存活动时自动调用），替换并删除旧图 |
| POST | `/api/admin/leads/:id/mail` | 重发邀请函邮件 |
| GET | `/api/partners` | 首页合作伙伴展示（只含名称、类型、Logo、链接、简介） |
| GET / POST / PATCH / DELETE | `/api/admin/partners`、`/api/admin/partners/:id` | 管理合作伙伴（操作记入日志） |
| GET / POST / PATCH / DELETE | `/api/admin/events`、`/api/admin/events/:id`、`/api/admin/events/:id/qr.svg` | 管理活动、下载报名二维码 |
| POST | `/api/admin/uploads` | 上传海报（JPG / PNG / WebP ≤ 5MB）和音乐（MP3 / M4A / OGG ≤ 10MB），按文件头校验类型 |
| GET / PATCH / DELETE | `/api/admin/leads`、`/api/admin/leads/:id`、`/api/admin/leads.csv` | 客资列表、跟进状态与备注、导出 |
| GET | `/api/stats`、`/api/health` | 首页实时统计 / 健康检查 |

## 目录

```
server.js          服务入口与全部接口
lib/store.js       JSON 文件存储
lib/admin-seed.js  后台初始内容（商家、AI 工具、资讯、方案）
lib/events.js      活动报名、客资、上传文件、前台活动列表
lib/partners.js    合作伙伴（赞助方 / 合作方 / 支持方）
lib/mailer.js      发邮件（最小 SMTP 客户端，支持 SSL / STARTTLS、内嵌图片）
lib/qrcode.js      二维码生成（无第三方依赖）
event.html         活动报名页（/e/<后缀>），脚本与样式为 assets/js/event.js、assets/css/event.css；邀请函绘制在 assets/js/invite.js，科技蓝长图在 assets/js/invite-tech.js
events.html        前台活动板块；首页「近期活动」「合作伙伴」与它共用 assets/js/showcase.js、assets/css/showcase.css
*.html             页面
assets/css/        样式；refresh.css 为新版 UI 层（卡片、圆角、导航、按钮）
assets/js/         前端脚本；auth.js 负责登录态，site.js 负责社区等交互
data/              运行时数据（不入库）
```
