# Fudan Login Monitor

这是一个 Edge Manifest V3 插件，用于后台检查 `icourse.fudan.edu.cn` 的登录状态。

## 当前行为

- 每 20 分钟探活一次（安装、浏览器启动、点击工具栏图标时也会立即探测一次）；
- 探活请求 `id.fudan.edu.cn/authserver/login?service=https://icourse.fudan.edu.cn/`：
  已登录会跳到 `/idp/authCenter/authenticate`；未登录停在 `/ac/#/index?...lck=`；
- **UIS 会话仍在时后台静默续期**：同一请求会直接签发新的 `ST` ticket，
  插件据此判定会话有效并被动延长 SSO 有效期，不需要密码；
- 只有连 UIS 会话都过期（拿不到 ticket）时才通知一次，点击通知打开认证页面；
- 仅续期 `id.fudan.edu.cn` 的 SSO 会话；`icourse` 自身的登录令牌仍由 yjlogin 前端 JS 交换，
  插件不会代为完成，因此网页端仍可能单独掉线；
- 不自动填写账号密码，不自动提交表单；
- 插件不保存账号密码；设置页的账号仅作本地备注，不被读取。

## 安装

1. 打开 Edge 的 `edge://extensions`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `edge-extension`。
5. 点击插件详情中的“扩展选项”可填写账号备注（可选，插件不使用该值）。

浏览器的登录 Cookie 仍由 Edge 自己管理；插件不会读取或导出 Cookie。
