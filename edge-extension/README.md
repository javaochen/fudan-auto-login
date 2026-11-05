# Fudan Login Monitor

这是一个 Edge Manifest V3 插件，后台检查多个复旦站点的登录状态，并在失效时自动补齐登录标签页。

## 当前行为

- 默认每 20 分钟探活一次，间隔可在设置页调整（5–60 分钟）；安装、浏览器启动时也会立即探测一次；
- 点击工具栏图标打开状态弹窗：逐站点显示登录态，可“立即检查”或直接去登录；
- 工具栏角标显示当前需要重新登录的站点数量，全部正常时不显示；
- 覆盖站点：`icourse`、`ehall`、`elearning`、`jwfw`、`my`；
- 探活请求 `id.fudan.edu.cn/authserver/login?service=<站点>`：
  已登录会跳到 `/idp/authCenter/authenticate`；未登录停在 `/ac/#/index?...lck=`；
- **UIS 会话仍在时后台静默续期**：同一请求会直接签发新的 `ST` ticket，
  插件据此判定会话有效并被动延长 SSO 有效期，不需要密码；
- **失效时自动打开认证页标签**：仅在该站点“上次有效、本次失效”时补登录，
  标签在后台打开且不抢焦点；已存在同 URL 标签则直接复用；
- 不自动填写账号密码，不自动提交表单；
- 插件不保存账号密码；设置页的账号仅作本地备注，不被读取。

## 已知限制

- 插件后台请求**无法携带 UIS 会话 Cookie**（`PHPSESSID`/`usk` 为 HttpOnly，且跨站策略限制）。
  因此插件只能判定状态，无法代替浏览器完成票据交换，必须由真实标签页完成登录跳转。
- `icourse` 自身令牌由站点前端 JS 交换，插件不代为完成。

## 安装

1. 打开 Edge 的 `edge://extensions`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `edge-extension`。
5. 点击工具栏图标可查看各站点状态；点击弹窗右下角“设置”可调整检查间隔。

## 权限

只申请 `alarms`（定时检查）、`notifications`（失效提醒）、`storage`（本地状态），
外加 6 个 `*.fudan.edu.cn` 域名的访问权限。不申请 `tabs`：复用认证页标签靠本地记录的标签页 ID。

## 隐私

不收集、不上传任何数据：不保存账号密码，不读取或导出 Cookie，无统计与远程代码。
完整说明见 [`../docs/privacy.html`](../docs/privacy.html)。

## 发布

商店文案、权限理由、审核备注见 [`../STORE.md`](../STORE.md)；
打包用 `powershell -File scripts/pack-extension.ps1`，产物在 `dist/`；
后台逻辑回归测试用 `node scripts/test-background.mjs`。

浏览器的登录 Cookie 仍由 Edge 自己管理；插件不会读取或导出 Cookie。
