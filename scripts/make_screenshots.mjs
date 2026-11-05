#!/usr/bin/env node
// 生成 Edge 加载项商店截图（1280×800）：
// 用无头 Edge 渲染真实的 popup.html / options.html（注入 chrome API 桩与示例数据），
// 再嵌入一个 1280×800 的展示页后截图。
//
// 用法：node scripts/make_screenshots.mjs
// 输出：store/screenshots/01-popup-normal.png / 02-popup-expired.png / 03-options.png
//
// 截图中的状态是示例数据，不含任何真实账号信息。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const ext = path.join(root, 'edge-extension');
const outDir = path.join(root, 'store', 'screenshots');
const tmp = path.join(os.tmpdir(), 'opencode', 'fudan-shots');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!edge) throw new Error('找不到 msedge.exe');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

const read = (name) => fs.readFileSync(path.join(ext, name), 'utf8');

function stub(sites, checkedAt) {
  return `<script>
  window.chrome = {
    storage: { local: { get: async () => (${JSON.stringify({ sites, checkedAt })}) } },
    runtime: {
      sendMessage: async () => ({ ok: false, error: 'screenshot mode' }),
      openOptionsPage() {},
      getManifest: () => ({ version: '0.3.1' }),
    },
  };
  </script>`;
}

function pageWithStub(file, stubCode) {
  const html = read(file);
  // 页面被复制到临时目录，脚本必须改成绝对 file:// 路径才能加载
  const withAbsoluteSrc = html.replace(
    /<script src="([^"]+)"><\/script>/g,
    (match, src) => `<script src="file:///${path.join(ext, src).replace(/\\/g, '/')}"></script>`,
  );
  return withAbsoluteSrc.replace(/(<script src="[^"]+"><\/script>)/, `${stubCode}$1`);
}

const AUTH = { status: 'ok' };
const RENEW = { status: 'renewable' };
const EXPIRED = { status: 'expired' };
const now = Date.now();

const sitesNormal = { icourse: AUTH, ehall: AUTH, elearning: AUTH, my: AUTH };
const sitesExpired = { icourse: AUTH, ehall: EXPIRED, elearning: RENEW, my: EXPIRED };

fs.writeFileSync(path.join(tmp, 'popup-normal.html'), pageWithStub('popup.html', stub(sitesNormal, now)));
fs.writeFileSync(path.join(tmp, 'popup-expired.html'), pageWithStub('popup.html', stub(sitesExpired, now)));

const optionsHtml = pageWithStub('options.html', stub({}, now));
fs.writeFileSync(path.join(tmp, 'options.html'), optionsHtml);

// 展示页：左侧说明，右侧嵌入真实页面
function stage({ title, lines, frame, width, height }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 1280px; height: 800px; box-sizing: border-box; overflow: hidden;
    background: linear-gradient(135deg, #eef4fb 0%, #dfe9f5 100%);
    font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center; gap: 64px;
  }
  .side { width: 470px; }
  .side h1 { margin: 0 0 18px; font-size: 42px; color: #0b2e59; letter-spacing: 1px; }
  .side p { margin: 0 0 14px; font-size: 20px; line-height: 1.65; color: #44506b; }
  .side ul { margin: 18px 0 0; padding-left: 22px; }
  .side li { font-size: 18px; line-height: 1.8; color: #374151; }
  .card { background: #fff; border-radius: 16px; overflow: hidden;
          box-shadow: 0 24px 60px rgba(15, 23, 42, .18), 0 2px 6px rgba(15, 23, 42, .08); }
  iframe { display: block; border: 0; background: #fff; }
</style></head><body>
  <div class="side">
    <h1>${title}</h1>
    ${lines.map((line) => (line.startsWith('- ') ? '' : `<p>${line}</p>`)).join('')}
    <ul>${lines.filter((line) => line.startsWith('- ')).map((line) => `<li>${line.slice(2)}</li>`).join('')}</ul>
  </div>
  <div class="card"><iframe src="${frame}" width="${width}" height="${height}"></iframe></div>
</body></html>`;
}

const shots = [
  {
    name: '01-popup-normal.png',
    title: '复旦登录监测',
    lines: ['四个常用站点的统一认证状态，一屏可见。', '- 默认每 20 分钟自动检查一次', '- 会话有效时静默续期，不需要操作', '- 角标数字即需要重新登录的站点数'],
    frame: 'popup-normal.html',
    width: 320,
    height: 250,
  },
  {
    name: '02-popup-expired.png',
    title: '失效时才提醒',
    lines: ['登录态过期，直接在弹窗里点「去登录」。', '- 自动在后台补开认证页，不抢焦点', '- 同一批异常只提醒一次', '- 不保存账号密码，不自动填写表单'],
    frame: 'popup-expired.html',
    width: 320,
    height: 330,
  },
  {
    name: '03-options.png',
    title: '检查频率可调',
    lines: ['按自己的使用习惯设置探测间隔。', '- 5 / 10 / 20 / 30 / 60 分钟可选', '- 权限与隐私说明一目了然', '- 全部数据只保存在本机'],
    frame: 'options.html',
    width: 660,
    height: 720,
  },
];

for (const shot of shots) {
  const stagePath = path.join(tmp, `stage-${shot.name.replace('.png', '')}.html`);
  fs.writeFileSync(stagePath, stage(shot));
  const target = path.join(outDir, shot.name);
  const result = spawnSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    '--window-size=1280,800',
    `--screenshot=${target}`,
    '--virtual-time-budget=3000',
    `file:///${stagePath.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', timeout: 60000 });

  if (!fs.existsSync(target)) {
    console.error(`失败：${shot.name}`);
    console.error(result.stderr?.slice(-800));
    process.exitCode = 1;
  } else {
    console.log(`已生成 ${path.relative(root, target)}`);
  }
}
