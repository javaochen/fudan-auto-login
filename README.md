# 复旦登录保活

复旦统一身份认证（`id.fudan.edu.cn`）的自动登录与会话保活工具，包含两部分：

| 部分 | 说明 |
|---|---|
| `fudan_auto_login.py` | Python 脚本，用账号密码走完整 SSO 流程，可静默后台保活 |
| `edge-extension/` | Edge 扩展，后台监测并静默续期已登录的 UIS 会话 |

两者相互独立，可单独使用。

## 1. Python 脚本

### 依赖

```bash
pip install requests pycryptodome pyotp
```

### 配置

凭据通过环境变量提供，不会写入代码：

```powershell
setx FUDAN_USERNAME "你的学号"
setx FUDAN_PASSWORD "你的密码"
# 若账号启用了 TOTP 二次验证（唯一可脚本化的一档）
setx FUDAN_TOTP_SECRET "你的TOTP密钥"
```

### 用法

```bash
python fudan_auto_login.py --service icourse              # 登录一次并保存 cookie
python fudan_auto_login.py --service icourse --check      # 只检查登录态
python fudan_auto_login.py --service icourse --daemon --interval 3600
python fudan_auto_login.py --service icourse --daemon --log-file fudan_daemon.log
```

可用 `--service` 短名：`icourse` / `elearning` / `ehall` / `my`，也可传完整 URL。

### 静默后台运行

双击 `run_daemon.vbs` 以无窗口方式启动守护进程，日志写入 `fudan_daemon.log`。

默认 **每 60 分钟**探活一次，且**只在检测到失效时才会登录**，平时不会产生任何登录请求。

开机自启：任务计划程序 → 新建任务 → 操作设为
`wscript.exe "<目录>\run_daemon.vbs"`，并勾选“不管用户是否登录都要运行”。

失败时采用指数退避（最长 1 小时），避免离线期间高频请求学校服务器。

### 二级认证（Level 2）

学校现已在密码校验后追加二级认证，接口返回 `pageLevelNo: 2`、`second: true`，
可选模块为 `qr` / `userAndMail` / `userAndSms` / `userAndOtp`。

脚本的处理优先级：

| 模块 | 自动化程度 |
|---|---|
| `userAndOtp`（动态口令） | ✅ 配好 `FUDAN_TOTP_SECRET` 可全自动 |
| `userAndSms` / `userAndMail` | ⚠️ 需交互式输入验证码 |
| `qr`（微信扫码） | ❌ 无法无人值守，请改用 OTP |

配置了 `FUDAN_TOTP_SECRET` 时脚本只走 OTP；未配置时会退化为提示输入短信/邮箱验证码。
若二级认证无法自动完成，守护进程会跳过本次重试，等下一轮再试，避免反复触发风控。


### 登录态判定

实测规则：

- UIS 会话有效 → `authserver/login` 跳到 `/idp/authCenter/authenticate`；
- 未登录 → 停在 `/ac/#/index?...lck=`。

## 2. Edge 扩展

后台每 20 分钟检查一次，并在 UIS 会话仍有效时**静默续期**（请求会直接签发新的 `ST` ticket）。

- 只在连 UIS 会话都过期时通知一次；
- 不保存账号密码，不自动填充或提交表单；
- 仅续期 `id.fudan.edu.cn` 的 SSO 会话；`icourse` 自身令牌由站点前端 JS 交换，扩展不代为完成。

安装：`edge://extensions` → 开启开发人员模式 → 加载解压缩的扩展 → 选择 `edge-extension`。

## 安全说明

- 仓库不含任何账号密码；
- `.fudan_cookies`、日志、`__pycache__` 已在 `.gitignore` 中排除；
- 建议用 `setx` 设置环境变量后删除命令历史；环境变量在注册表中为明文，如需更强保护可改用 Windows 凭据管理器。

## 合规提示

仅用于本人账号的正常使用。探测间隔建议 ≥ 60 分钟，不要高频轮询学校服务器。

## 许可

[MIT](LICENSE)
