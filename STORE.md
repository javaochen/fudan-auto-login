# Edge 加载项商店提交材料

本文件是上架用的文案与填报答案，不参与扩展打包。
打包：`powershell -File scripts/pack-extension.ps1`，产物在 `dist/`。

## 0. 提交前检查

- [ ] 本地加载 `edge-extension/`，确认弹窗、角标、通知、设置页都正常（见第 5 节自测）
- [ ] 隐私政策页已发布，URL 可匿名访问
- [ ] 截图与商店 Logo 就位（第 4 节）
- [ ] `manifest.json` 的 `version` 已递增

## 1. 商店信息

| 字段 | 中文 | English |
|---|---|---|
| 名称 | 复旦登录监测 | Fudan Login Monitor |
| 摘要（≤132 字符） | 定时检查复旦常用站点的统一认证登录态，失效时提醒并在后台补开认证页。 | Periodically checks Fudan SSO session status, notifies you when it expires, and reopens the sign-in page in the background. |
| 分类 | 生产力 / Productivity | Productivity |
| 语言 | 中文（简体），English | — |

**详细描述（中文）**

> 复旦登录监测会按你设定的间隔（默认 20 分钟）检查 icourse、eHall、eLearning、个人门户这 4 个站点的统一认证登录态。
>
> · 会话仍然有效时，探测请求本身会完成一次被动续期，不需要你操作；
> · 会话失效时，插件在后台补开对应站点的认证页，并弹出一次提醒；
> · 工具栏图标上的数字表示当前需要重新登录的站点数量，点击可查看明细。
>
> 插件不保存账号密码，不读取或导出浏览器 Cookie，不自动填写或提交登录表单。所有请求只发往 fudan.edu.cn 域名，不含任何统计或远程代码。
>
> 本插件与复旦大学官方无关，仅用于个人账号的日常使用。

**Detailed description (English)**

> Fudan Login Monitor checks the single sign-on (SSO) status of four Fudan University sites — icourse, eHall, eLearning, and the personal portal — at an interval you choose (20 minutes by default).
>
> · While the session is valid, the probe itself passively renews it; no action needed.
> · When the session expires, the extension reopens that site's sign-in page in a background tab and shows a single notification.
> · The badge on the toolbar shows how many sites currently need re-authentication.
>
> It never stores your password, never reads or exports browser cookies, and never autofills or submits a login form. All requests go to fudan.edu.cn domains only; there is no analytics or remotely hosted code.
>
> This extension is not affiliated with Fudan University.

## 2. 权限理由（逐条粘贴）

| 权限 | 理由（中文） | Justification (English) |
|---|---|---|
| `alarms` | 按用户设定的间隔定时检查登录态；MV3 下 `setInterval` 在 Service Worker 休眠后不可靠。 | Schedules the periodic login check. `setInterval` is unreliable in an MV3 service worker that gets suspended. |
| `notifications` | 登录态失效时提醒用户一次，否则用户无法得知会话已过期。 | Shows one notification when a session expires; otherwise the user cannot learn about it. |
| `storage` | 在本机保存各站点探测结果、上次检查时间、提醒去重标记和检查间隔。 | Stores per-site status, last check time, a notification de-dup key, and the interval locally. |
| `https://id.fudan.edu.cn/*` | 统一认证入口，用于判断会话是否有效。 | SSO entry point used to detect whether the session is valid. |
| `https://icourse.fudan.edu.cn/*` 等 4 个站点 | 失效时打开对应站点的认证页，复用已打开的标签页。 | Opens/reuses the corresponding sign-in tab when a session expires. |

不申请 `tabs`：读取标签页 URL 的能力对本扩展没有用处，改用本地记录的标签页 ID 复用标签页。

## 3. 数据使用声明（提交表单选项）

- 是否收集个人数据：**否**（不收集、不上传；仅浏览器本地存储）
- 是否使用远程代码：**否**
- 是否使用 Cookie：**否**（不读取、不写入、不导出）
- 是否包含广告或跟踪：**否**
- 隐私政策 URL：`https://javaochen.github.io/fudan-auto-login/privacy.html`

> 该 URL 已通过 GitHub Pages（`main` 分支 `/docs`）发布，2026-11-06 实测可匿名访问、返回 `text/html`。
> 若以后改了文件名或目录，记得同步修改这里和商店表单里的 URL。

## 4. 素材清单

| 素材 | 规格 | 状态 |
|---|---|---|
| 商店 Logo | 300×300 PNG | ✅ `store/logo-300.png` |
| 截图 | 1280×800 或 640×480，1–10 张 | ⬜ 需人工截取（见下） |
| 宣传图 | 可选 | ⬜ 不需要 |

建议截图 3 张（在 1280×800 窗口下截取，避免包含真实学号）：

1. 弹窗正常态：4 个站点全部“已登录”；
2. 弹窗异常态：1–2 个站点“需重新登录”，展示“去登录”按钮；
3. 设置页：检查频率与隐私说明。

截图里不要出现姓名、学号、课程名等个人信息。

## 5. 审核备注（Reviewer notes，可直接粘贴）

> This extension has a single purpose: monitor Fudan University SSO session status and reopen the sign-in tab when it expires.
>
> To test without a Fudan account: install the extension, click the toolbar icon — the popup performs a live probe against id.fudan.edu.cn and shows one row per site. Without a Fudan session all rows will read “需重新登录” (needs sign-in) and a badge count will appear; that is the expected result. The “去登录” button opens the site's sign-in page in a background tab. No account is required to verify behavior.
>
> There is no remote code, no analytics, and no data collection. `chrome.storage.local` only holds probe results, timestamps, tab IDs, and the interval setting.

## 6. 上架后自测清单

1. 加载解压目录后，`edge://extensions` 无红色错误；Service Worker 显示“inactive/active”可唤醒；
2. 点图标 → 弹窗列出 5 行，点击“立即检查”后状态刷新，时间显示“刚刚检查”；
3. 角标数字 = 异常站点数；全部正常时角标消失；
4. 断网后点“立即检查” → 显示“网络异常”而不是崩溃；
5. 设置页改间隔为 5 分钟 → 保存 → `edge://extensions` 的 Service Worker 控制台执行 `chrome.alarms.get('fudan-login-probe')` 应看到 `periodInMinutes: 5`；
6. 卸载重装 → 状态清空、无残留 `username` 键。
