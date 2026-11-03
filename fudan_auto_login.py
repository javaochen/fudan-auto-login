#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
复旦统一身份认证（id.fudan.edu.cn，新版 ID 系统）自动登录 + 会话保活脚本

适用：icourse / elearning / ehall / jwfw / my 等所有走复旦 CAS 单点登录的站点。
解决的问题：这类站点登录态约 1~2 小时失效，脚本会自动探测失效并静默重登。

快速开始
--------
1) 安装依赖：
   pip install requests pycryptodome pyotp

2) 配置账号（不要写进脚本里）：
   export FUDAN_USERNAME=你的学号
   export FUDAN_PASSWORD=你的密码
   # 若账号开启了 TOTP 二次验证（推荐，唯一可脚本化的一档）：
   export FUDAN_TOTP_SECRET=你的TOTP密钥   # 绑定时给的 otpauth:// 里的 secret

3) 用法：
   python fudan_auto_login.py --service icourse              # 登录一次并把 cookie 存盘
   python fudan_auto_login.py --service icourse --check      # 只检查当前登录态是否有效
   python fudan_auto_login.py --service icourse --daemon --interval 1200
                                                             # 每 20 分钟探活，失效自动重登
   python fudan_auto_login.py --service icourse --daemon --log-file fudan_daemon.log
                                                             # 后台/计划任务场景：日志写文件而非控制台

静默运行
--------
双击 run_daemon.vbs 可用无窗口方式在后台启动守护（日志写入 fudan_daemon.log）。
需要开机自启时，在“任务计划程序”中新建任务，操作设为
   wscript.exe "<本目录>\run_daemon.vbs"
并在任务设置的“常规”里勾选“不管用户是否登录都要运行”（凭据请放在用户环境变量中）。

合规提示：仅用于本人账号的正常使用，探测间隔建议 >= 20 分钟，不要高频轮询学校服务器。
"""

from __future__ import annotations

import argparse
import base64
import getpass
import html
import json
import os
import re
import signal
import sys
import time
from http.cookiejar import LWPCookieJar
from typing import Any, Dict, Optional
from urllib.parse import quote, urlparse

try:
    import requests
except ImportError:
    sys.exit("缺少依赖：请先执行 pip install requests pycryptodome pyotp")

IDP = "https://id.fudan.edu.cn"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# 常用站点，--service 可以直接用短名
SERVICES: Dict[str, str] = {
    "icourse": "https://icourse.fudan.edu.cn/",
    "elearning": "https://elearning.fudan.edu.cn/",
    "ehall": "https://ehall.fudan.edu.cn/",
    "jwfw": "https://jwfw.fudan.edu.cn/",
    "my": "https://my.fudan.edu.cn/",
}

# 判定“被踢回登录页”的特征
LOGIN_MARKERS = ("authserver/login", "/idp/authn", "统一身份认证", "Identity Service")

# 统一认证入口。已登录时 UIS 直接跳到 /idp/authCenter/authenticate（通常再凭 ticket 回到应用），
# 未登录则停在 /ac/#/index?...lck=；实测比探测各应用首页更可靠。
UIS_PROBE = f"{IDP}/authserver/login?service={{service}}"


class AuthError(RuntimeError):
    """登录流程失败。"""


def deep_get(obj: Any, key: str) -> Optional[Any]:
    """在嵌套的 dict/list 里按 key 名递归查找第一个非空值。

    学校接口各版本字段层级不一致，用这个做容错取值，避免写死路径。
    """
    if isinstance(obj, dict):
        if key in obj and obj[key] not in (None, "", [], {}):
            return obj[key]
        for value in obj.values():
            found = deep_get(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = deep_get(item, key)
            if found is not None:
                return found
    return None


class FudanAuth:
    """一个可复用、可持久化的复旦登录会话。"""

    def __init__(
        self,
        username: str,
        password: str,
        service: str,
        cookie_file: str = ".fudan_cookies",
        otp_secret: Optional[str] = None,
        probe_url: Optional[str] = None,
        timeout: int = 20,
        debug: bool = False,
    ) -> None:
        self.username = username
        self.password = password
        self.service = service
        self.entity_id = f"{urlparse(service).scheme}://{urlparse(service).netloc}"
        self.cookie_file = cookie_file
        self.otp_secret = otp_secret
        self.probe_url = probe_url or self._default_probe_url(service)
        self.timeout = timeout
        self.debug = debug

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": UA,
                "Accept-Language": "zh-CN,zh;q=0.9",
                "Referer": IDP + "/",
            }
        )
        self.session.cookies = LWPCookieJar(cookie_file)  # type: ignore[assignment]
        if os.path.exists(cookie_file):
            try:
                self.session.cookies.load(ignore_discard=True, ignore_expires=True)  # type: ignore[attr-defined]
            except Exception as exc:  # cookie 文件损坏时直接重建
                print(f"[warn] cookie 文件无法读取（{exc}），将重新登录")

    # ---------- 基础工具 ----------

    def _log(self, msg: str) -> None:
        text = f"[{time.strftime('%H:%M:%S')}] {msg}"
        try:
            print(text, flush=True)
        except UnicodeEncodeError:
            enc = sys.stdout.encoding or "utf-8"
            safe = text.encode(enc, errors="backslashreplace").decode(enc, errors="replace")
            print(safe, flush=True)

    def _dump(self, label: str, resp: requests.Response) -> None:
        if not self.debug:
            return
        body = resp.text[:600].replace("\n", " ")
        self._log(f"[debug] {label} status={resp.status_code} url={resp.url}")
        self._log(f"[debug] {label} body={body}")

    def _check_access(self, resp: requests.Response) -> None:
        """403 基本都是 WAF 按来源 IP 拦截，给出可操作的提示。"""
        if resp.status_code == 403:
            raise AuthError(
                "被网关拦截(403)。该认证服务对来源 IP 有策略限制，"
                "请在校内网络 / 校园网（或挂学校 VPN）下运行；"
                "云服务器、境外 IP 常被直接拒绝。"
            )

    def _save(self) -> None:
        try:
            self.session.cookies.save(ignore_discard=True, ignore_expires=True)  # type: ignore[attr-defined]
            os.chmod(self.cookie_file, 0o600)
        except Exception as exc:
            print(f"[warn] cookie 保存失败：{exc}")

    @staticmethod
    def _looks_like_login_page(resp: requests.Response) -> bool:
        url = resp.url or ""
        if any(m in url for m in ("authserver/login", "/idp/authn", "yjlogin")):
            return True
        text = resp.text[:4000] if resp.text else ""
        return any(m in text for m in LOGIN_MARKERS) or ("欢迎登录" in text)

    @staticmethod
    def _default_probe_url(service: str) -> str:
        """默认探测统一认证入口：能同时反映 UIS 会话与目标应用的 CAS 登录态。"""
        return UIS_PROBE.format(service=quote(service, safe=""))

    def _probe_logged_in(self, resp: requests.Response) -> bool:
        final = resp.url or ""
        if "/idp/authCenter/authenticate" in final:
            return True
        if "/ac/" in final or "/authserver/login" in final:
            return False
        # 兜底：跟随到了应用页面，再看它是否还是登录页
        return not self._looks_like_login_page(resp)

    # ---------- 登录态探测 ----------

    def is_logged_in(self) -> bool:
        """访问一次目标站点，看是否还停在登录页。"""
        attempts = [
            ("默认网络", None, "probe"),
            ("直连(禁用代理)", {"http": "", "https": ""}, "probe-direct"),
        ]
        for route, proxies, label in attempts:
            try:
                resp = self.session.get(
                    self.probe_url,
                    timeout=self.timeout,
                    allow_redirects=True,
                    proxies=proxies,
                )
            except requests.RequestException as exc:
                self._log(f"探活请求异常（{route}）：{exc}")
                continue
            self._dump(label, resp)
            if resp.status_code >= 400:
                continue
            return self._probe_logged_in(resp)
        return False

    # ---------- 登录主流程 ----------

    def login(self) -> bool:
        try:
            lck = self._step1_get_lck()
            chain = self._step2_get_chain(lck)
            pubkey = self._step3_get_pubkey()
            token = self._step4_password_auth(lck, chain, pubkey)
            ticket_url = self._step5_get_ticket(token)
            self._step6_redeem(ticket_url)
            self._save()
        except requests.RequestException as exc:
            raise AuthError(f"登录过程网络异常：{exc}") from exc

        ok = self.is_logged_in()
        self._log("登录成功" if ok else "登录流程走完，但探活仍判定为未登录（可用 --debug 看响应）")
        return ok

    def _step1_get_lck(self) -> str:
        resp = self.session.get(
            f"{IDP}/authserver/login",
            params={"service": self.service},
            timeout=self.timeout,
            allow_redirects=True,
        )
        self._dump("step1", resp)
        self._check_access(resp)
        # 多数情况下 lck 出现在 302 之后的最终 URL 上，其余情况回退到页面里找
        for pattern in (r"lck=([^&\"'#\s]+)", r'name="lck"[^>]*value="([^"]+)"', r'"lck"\s*:\s*"([^"]+)"'):
            match = re.search(pattern, resp.url) or re.search(pattern, resp.text)
            if match:
                return match.group(1)
        raise AuthError("step1 拿不到 lck：认证页结构可能又变了，加 --debug 看 step1 的 url/body")

    def _step2_get_chain(self, lck: str) -> str:
        resp = self.session.post(
            f"{IDP}/idp/authn/queryAuthMethods",
            json={"lck": lck, "entityId": self.entity_id},
            timeout=self.timeout,
        )
        self._dump("step2", resp)
        self._check_access(resp)
        data = resp.json()
        chain = deep_get(data, "chainCode") or deep_get(data, "authChainCode")
        if not chain:
            raise AuthError(f"step2 拿不到 chainCode：{json.dumps(data, ensure_ascii=False)[:300]}")
        return chain

    def _step3_get_pubkey(self) -> str:
        resp = self.session.post(f"{IDP}/idp/authn/getJsPublicKey", json={}, timeout=self.timeout)
        self._dump("step3", resp)
        self._check_access(resp)
        key = deep_get(resp.json(), "data")
        if not key:
            raise AuthError("step3 拿不到 RSA 公钥")
        return key

    def _step4_password_auth(self, lck: str, chain: str, pubkey_b64: str) -> str:
        encrypted = self._rsa_encrypt(pubkey_b64, self.password)
        payload: Dict[str, Any] = {
            "authModuleCode": "userAndPwd",
            "authChainCode": chain,
            "entityId": self.entity_id,
            "requestType": "chain_type",
            "lck": lck,
            "authPara": {
                "loginName": self.username,
                "password": encrypted,
                "verifyCode": "",
            },
        }
        resp = self.session.post(f"{IDP}/idp/authn/authExecute", json=payload, timeout=self.timeout)
        self._dump("step4", resp)
        self._check_access(resp)
        data = resp.json()

        token = deep_get(data, "loginToken")
        if token:
            return token

        # 走到这里说明还有第二因素（TOTP / 短信 / 邮箱 / 微信扫码）
        self._log("账号开启了二次验证，进入第二因素流程")
        return self._step4b_second_factor(data, payload)

    def _step4b_second_factor(self, first_resp: Dict[str, Any], base_payload: Dict[str, Any]) -> str:
        next_module = (
            deep_get(first_resp, "authModuleCode")
            or deep_get(first_resp, "nextAuthModule")
            or deep_get(first_resp, "moduleCode")
            or "totp"
        )
        request_number = deep_get(first_resp, "requestNumber")
        code = self._get_otp_code(next_module)

        payload = dict(base_payload)
        payload["authModuleCode"] = next_module
        if request_number:
            payload["requestNumber"] = request_number
        payload["authPara"] = {"loginName": self.username, "verifyCode": code}

        resp = self.session.post(f"{IDP}/idp/authn/authExecute", json=payload, timeout=self.timeout)
        self._dump("step4b", resp)
        data = resp.json()
        token = deep_get(data, "loginToken")
        if not token:
            raise AuthError(
                "二次验证后仍未拿到 loginToken。"
                f"响应：{json.dumps(data, ensure_ascii=False)[:400]}"
                "若第二因素是微信扫码/短信/邮箱，脚本无法无人值守通过，请改用 TOTP。"
            )
        return token

    def _get_otp_code(self, module: str) -> str:
        """优先用 TOTP 密钥自动生成；否则退化成交互式手输。"""
        if self.otp_secret:
            try:
                import pyotp
            except ImportError:
                raise AuthError("配置了 TOTP 密钥但缺 pyotp：pip install pyotp")
            return pyotp.TOTP(self.otp_secret).now()
        print(f"\n需要第二因素验证码（模块：{module}）")
        return getpass.getpass("请输入验证码（微信/短信/邮箱/TOTP）：").strip()

    def _step5_get_ticket(self, token: str) -> str:
        resp = self.session.post(
            f"{IDP}/idp/authCenter/authnEngine?locale=zh-CN",
            data={"loginToken": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=self.timeout,
        )
        self._dump("step5", resp)
        text = html.unescape(resp.text)
        match = re.search(r'(https?://[^"\'<>\s]+ticket=ST-[^"\'<>\s]+)', text)
        if not match:
            raise AuthError("step5 未解析到 ticket=ST- 链接，加 --debug 查看返回内容")
        return match.group(1)

    def _step6_redeem(self, ticket_url: str) -> None:
        last_exc: Optional[requests.RequestException] = None
        attempts = [
            ("直连(禁用代理)", {"http": "", "https": ""}),
            ("默认网络", None),
            ("直连(禁用代理)", {"http": "", "https": ""}),
        ]
        for attempt, (route, proxies) in enumerate(attempts, start=1):
            try:
                resp = self.session.get(
                    ticket_url,
                    timeout=self.timeout,
                    allow_redirects=True,
                    proxies=proxies,
                )
                self._dump("step6", resp)
                if resp.status_code >= 400:
                    raise AuthError(f"step6 用 ticket 兑换应用会话失败：HTTP {resp.status_code}")
                if urlparse(self.service).netloc.lower() == "icourse.fudan.edu.cn" and "ticket=" in ticket_url:
                    forward = quote(ticket_url, safe="")
                    cas_login = (
                        "https://icourse.fudan.edu.cn/casapi/index.php"
                        f"?r=auth/login&auType=front_login&tenant_code=222&forward={forward}"
                    )
                    cas_resp = self.session.get(
                        cas_login,
                        timeout=self.timeout,
                        allow_redirects=True,
                        proxies=proxies,
                    )
                    self._dump("step6-cas", cas_resp)
                return
            except requests.RequestException as exc:
                last_exc = exc
                self._log(f"step6 网络异常（第 {attempt}/3 次，{route}）：{exc}")
                if attempt < 3:
                    time.sleep(attempt)
        raise AuthError(f"step6 连续网络异常，ticket 兑换失败：{last_exc}")

    # ---------- 对外入口 ----------

    def ensure_login(self) -> bool:
        """已登录就什么都不做，失效才重登。"""
        if self.is_logged_in():
            self._log("登录态有效，无需重登")
            return True
        self._log("登录态已失效，开始自动登录")
        return self.login()

    def run_daemon(self, interval: int, max_retry: int = 3) -> None:
        self._log(f"保活守护启动：每 {interval} 秒探活一次，Ctrl+C 退出")
        backoff = interval
        while True:
            success = False
            for attempt in range(1, max_retry + 1):
                try:
                    if self.ensure_login():
                        success = True
                        break
                except AuthError as exc:
                    self._log(f"登录失败（第 {attempt}/{max_retry} 次）：{exc}")
                except requests.RequestException as exc:
                    self._log(f"网络异常（第 {attempt}/{max_retry} 次）：{exc}")
                if attempt < max_retry:
                    time.sleep(min(30 * attempt, 120))
            if success:
                backoff = interval
                wait = interval
            else:
                # 连续失败时指数退避，避免离线或校内网络断开期间持续高频请求
                wait = min(backoff * 2, 3600)
                backoff = wait
                self._log(f"连续多次失败，{wait} 秒后再试")
            time.sleep(wait)

    @staticmethod
    def _rsa_encrypt(pubkey_b64: str, password: str) -> str:
        """PKCS1_v1_5 加密后 base64 —— 与前端 JS 加密保持一致。"""
        try:
            from Crypto.Cipher import PKCS1_v1_5
            from Crypto.PublicKey import RSA
        except ImportError:
            raise AuthError("缺少 pycryptodome：pip install pycryptodome")

        raw = pubkey_b64.strip()
        try:
            key = RSA.import_key(base64.b64decode(raw))
        except Exception:
            body = "\n".join(raw[i: i + 64] for i in range(0, len(raw), 64))
            key = RSA.import_key(f"-----BEGIN PUBLIC KEY-----\n{body}\n-----END PUBLIC KEY-----")
        cipher = PKCS1_v1_5.new(key)
        return base64.b64encode(cipher.encrypt(password.encode("utf-8"))).decode()


def resolve_credentials(args: argparse.Namespace) -> tuple[str, str]:
    username = args.username or os.getenv("FUDAN_USERNAME") or os.getenv("FUDAN_USER")
    password = args.password or os.getenv("FUDAN_PASSWORD") or os.getenv("FUDAN_PASS")
    if not username:
        username = input("学号/工号：").strip()
    if not password:
        password = getpass.getpass("密码（不回显）：")
    return username, password


def main() -> int:
    parser = argparse.ArgumentParser(description="复旦统一身份认证自动登录 / 保活")
    parser.add_argument("--service", default="icourse",
                        help="站点短名（icourse/elearning/ehall/jwfw/my）或完整 service URL")
    parser.add_argument("--probe-url", default=None,
                        help="探活用的 URL，默认就是 service；可指定一个登录后才有内容的深层页面")
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None, help="不建议在命令行传，优先用环境变量")
    parser.add_argument("--otp-secret", default=None, help="TOTP 密钥，也可设 FUDAN_TOTP_SECRET")
    parser.add_argument("--cookie-file", default=".fudan_cookies")
    parser.add_argument("--check", action="store_true", help="只检查登录态，不触发登录")
    parser.add_argument("--daemon", action="store_true", help="常驻保活模式")
    parser.add_argument("--interval", type=int, default=1200, help="保活间隔秒数，默认 1200（20 分钟）")
    parser.add_argument("--debug", action="store_true", help="打印每一步的响应摘要，排错用")
    parser.add_argument("--log-file", default=None, help="把日志追加写入文件（后台/计划任务场景必需）")
    args = parser.parse_args()

    service = SERVICES.get(args.service, args.service)
    if not service.startswith("http"):
        sys.exit(f"无法识别的 service：{args.service}")

    log_handle = None
    if args.log_file:
        os.makedirs(os.path.dirname(os.path.abspath(args.log_file)), exist_ok=True)
        log_handle = open(args.log_file, "a", encoding="utf-8", buffering=1)
        sys.stdout = log_handle
        sys.stderr = log_handle

    try:
        return _run(args, service)
    finally:
        if log_handle is not None:
            log_handle.close()


def _run(args: argparse.Namespace, service: str) -> int:
    if args.check:
        auth = FudanAuth("_", "_", service, args.cookie_file, probe_url=args.probe_url, debug=args.debug)
        alive = auth.is_logged_in()
        print("登录态有效" if alive else "登录态已失效")
        return 0 if alive else 1

    username, password = resolve_credentials(args)
    auth = FudanAuth(
        username=username,
        password=password,
        service=service,
        cookie_file=args.cookie_file,
        otp_secret=args.otp_secret or os.getenv("FUDAN_TOTP_SECRET"),
        probe_url=args.probe_url,
        debug=args.debug,
    )

    signal.signal(signal.SIGINT, lambda *_: sys.exit("\n已退出"))

    try:
        if args.daemon:
            auth.run_daemon(args.interval)
        else:
            ok = auth.ensure_login()
            print(f"\ncookie 已保存到 {args.cookie_file}，其他脚本可直接复用：")
            print(f"  auth = FudanAuth(user, pwd, '{service}', cookie_file='{args.cookie_file}')")
            print(f"  auth.session.get('{service}')")
            return 0 if ok else 1
    except AuthError as exc:
        print(f"\n[失败] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
