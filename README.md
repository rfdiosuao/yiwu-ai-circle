# 义乌AI圈 · Yiwu AI Circle

供应链直联、AI 工具、商家名录的社区站点。纯 Node.js（≥ 20）内置模块实现，**无需 `npm install`**。

## 本地运行

```bash
npm start
# 打开 http://localhost:8000
```

- 默认是演示短信模式：验证码会直接显示在页面提示里。
- 运营后台：`/admin.html`，默认账号 `admin / ywai2026`（上线前务必修改，见下文）。

## 数据持久化

所有业务数据保存在 `data/db.json`（目录可用 `DATA_DIR` 修改，已加入 `.gitignore`）：

| 数据 | 说明 |
| --- | --- |
| 用户 | 手机号、昵称、头像色、密码（scrypt 加盐哈希） |
| 个人主页 | 简介、标签、联系方式、头像与相册（压缩后的图片） |
| 社区 | 圈友帖子、点赞、收藏、评论 |
| 商家认证 | 认证申请资料 |
| 运营后台 | 后台整库（商家、产品、订单、套餐、设置） |

写盘采用「临时文件 + rename」，进程退出前会强制落盘。**备份只需复制 `data/` 目录。**
单实例部署足够；后续访问量上来可把 `lib/store.js` 换成 SQLite / Postgres，接口不用改。

## 配置

环境变量优先；不方便注入环境变量时，复制 `secrets.example.json` 为 `secrets.json` 填写（已被 git 忽略）。

| 变量 | 说明 |
| --- | --- |
| `PORT` | 端口，默认 8000 |
| `SESSION_SECRET` | 会话签名密钥；不填会自动生成并存到 `data/.session-secret` |
| `ADMIN_USER` / `ADMIN_PASS` | 后台账号。设置后以此为准，忽略后台「设置」页里的账号 |
| `SMS_MODE` | `demo`（演示）或 `api`（真实短信） |
| `SMS_SEND_URL` / `SMS_VERIFY_URL` | 真实短信的发送 / 校验接口（表单 POST `phone`、`code`） |
| `WAG_API_KEY` / `WAG_ENTITLEMENT_ID` | 爱猹收支付，商家认证付费用 |
| `CERT_PRICE` | 认证价格，默认 99 |
| `DATA_DIR` | 数据目录，默认 `./data` |
| `COOKIE_SECURE` | `1` 强制 Secure Cookie；留空按是否 HTTPS 自动判断 |

## 上线清单

1. 设置 `ADMIN_USER` / `ADMIN_PASS`、`SESSION_SECRET`。
2. 前面挂 Nginx / Caddy 做 HTTPS，反向代理到 `8000`，并传 `X-Forwarded-Proto`。
3. 用 systemd / pm2 守护进程，`data/` 放在持久化磁盘上并定期备份。
4. 接真实短信：服务端设 `SMS_MODE=api` 与两个接口地址，同时把 `assets/js/config.js` 里的 `sms.mode` 改为 `"api"`（隐藏页面上的演示提示）。

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
| GET / PUT | `/api/profiles`、`/api/profiles/me` | 查看主页（未登录不返回联系方式）/ 保存自己的主页 |
| POST / GET | `/api/cert/apply`、`/api/cert/status` | 商家认证申请 / 支付状态 |
| POST / GET / PUT | `/api/admin/login`、`/api/admin/db` | 后台登录 / 拉取与保存后台数据 |
| GET | `/api/stats`、`/api/health` | 首页实时统计 / 健康检查 |

## 目录

```
server.js          服务入口与全部接口
lib/store.js       JSON 文件存储
*.html             页面
assets/css/        样式；refresh.css 为新版 UI 层（卡片、圆角、导航、按钮）
assets/js/         前端脚本；auth.js 负责登录态，site.js 负责社区等交互
data/              运行时数据（不入库）
```
