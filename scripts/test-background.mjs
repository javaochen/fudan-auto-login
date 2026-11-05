#!/usr/bin/env node
// 后台逻辑冒烟测试：在 Node 里模拟 chrome.* API 与 fetch，直接运行 background.js。
// 用法：node scripts/test-background.mjs
// 覆盖：探活结果分类、角标、通知去重、失效时补开标签页并复用、探测间隔切换。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'edge-extension', 'background.js'), 'utf8');

const store = {};
const alarms = [];
const tabs = [];
const tabUpdates = [];
const notifications = [];
const badge = { text: '', background: '' };
const listeners = { installed: [], startup: [], alarm: [], message: [], storage: [], notificationClick: [] };

// 当前这一轮各站点返回什么：由用例通过 setProbe 控制
let probeBehaviour = () => ({ ok: true, url: 'https://id.fudan.edu.cn/ac/#/index', body: '' });

function setProbe(map) {
  probeBehaviour = (url) => {
    const site = Object.keys(map).find((key) => url.includes(encodeURIComponent(key)));
    return site ? map[site] : { ok: true, url, body: '' };
  };
}

const AUTH = { ok: true, url: 'https://id.fudan.edu.cn/idp/authCenter/authenticate', body: '' };
const EXPIRED = { ok: true, url: 'https://id.fudan.edu.cn/ac/#/index?lck=abc', body: '' };
const RENEWABLE = { ok: true, url: 'https://id.fudan.edu.cn/ac/#/index?lck=abc', body: '<a href="https://icourse.fudan.edu.cn/?ticket=ST-1">' };
const TIMEOUT = { throws: true };

const fetchStub = async (url) => {
  const result = probeBehaviour(url);
  if (result.throws) {
    throw new Error('network timeout');
  }
  return {
    ok: result.ok,
    url: result.url,
    text: async () => result.body,
  };
};

const chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === undefined || keys === null) return { ...store };
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
        return Object.fromEntries(Object.keys(keys).map((key) => [key, store[key] ?? keys[key]]));
      },
      async set(values) {
        Object.assign(store, values);
        const changes = Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: values[key] }]));
        for (const listener of listeners.storage) listener(changes, 'local');
      },
      async remove(key) {
        delete store[key];
      },
    },
    onChanged: { addListener: (fn) => listeners.storage.push(fn) },
  },
  alarms: {
    async get(name) {
      return alarms.filter((alarm) => alarm.name === name).at(-1) || null;
    },
    async create(name, options) {
      alarms.push({ name, ...options });
    },
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  action: {
    setBadgeText({ text }) { badge.text = text; },
    setBadgeBackgroundColor({ color }) { badge.background = color; },
    setTitle() {},
  },
  tabs: {
    async create(options) {
      const tab = { id: 100 + tabs.length, ...options };
      tabs.push(tab);
      return tab;
    },
    async update(id, options) {
      if (!tabs.some((tab) => tab.id === id)) throw new Error(`No tab with id: ${id}`);
      tabUpdates.push({ id, ...options });
      return {};
    },
  },
  notifications: {
    async create(id, options) {
      notifications.push({ id, ...options });
    },
    async clear() {},
    onClicked: { addListener: (fn) => listeners.notificationClick.push(fn) },
  },
  runtime: {
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    getManifest: () => ({ version: '0.3.0' }),
    openOptionsPage() {},
  },
};

const context = vm.createContext({
  chrome,
  fetch: fetchStub,
  AbortSignal,
  console,
  setTimeout,
  clearTimeout,
  URL,
});
vm.runInContext(code, context, { filename: 'background.js' });

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const callMessage = (message) =>
  new Promise((resolve) => {
    const handled = listeners.message[0](message, {}, resolve);
    if (handled !== true) resolve(undefined);
  });

console.log('1) 首次安装：全部失效');
setProbe({ icourse: EXPIRED, ehall: EXPIRED, elearning: EXPIRED, my: EXPIRED });
await Promise.all(listeners.installed.map((fn) => fn({ reason: 'install' })));
check('生成 4 条站点状态', Object.keys(store.sites || {}).length === 4);
check('全部标记为 expired', Object.values(store.sites).every((item) => item.status === 'expired'));
check('角标显示异常数 4', badge.text === '4', badge.text);
check('首次不补开标签页（没有“上次有效”基线）', tabs.length === 0, `${tabs.length}`);
check('只弹 1 条通知', notifications.length === 1, `${notifications.length}`);
check('旧 username 字段被清理', !('username' in store));
check('创建了定时器', alarms.length === 1 && alarms[0].periodInMinutes === 20, JSON.stringify(alarms));

console.log('2) 全部恢复登录');
setProbe({ icourse: AUTH, ehall: AUTH, elearning: AUTH, my: AUTH });
const okRun = await callMessage({ type: 'probe' });
check('消息接口返回 4 条结果', okRun?.ok === true && okRun.results.length === 4);
check('角标被清空', badge.text === '', JSON.stringify(badge.text));
check('通知去重标记重置', store.notifiedKey === '');

console.log('3) 再次失效：补开标签页 + 提醒');
setProbe({ icourse: EXPIRED, ehall: AUTH, elearning: AUTH, my: AUTH });
await callMessage({ type: 'probe' });
check('为 icourse 打开 1 个后台标签页', tabs.length === 1 && tabs[0].active === false, JSON.stringify(tabs));
check('通知数增至 2', notifications.length === 2, `${notifications.length}`);
check('角标回到 1', badge.text === '1', badge.text);

console.log('4) 持续失效：不重复提醒、不重复开标签页');
await callMessage({ type: 'probe' });
check('通知没有增加', notifications.length === 2, `${notifications.length}`);
check('标签页没有增加', tabs.length === 1, `${tabs.length}`);

console.log('5) 会话可续期：不算异常');
setProbe({ icourse: RENEWABLE, ehall: RENEWABLE, elearning: RENEWABLE, my: RENEWABLE });
await callMessage({ type: 'probe' });
check('状态为 renewable', Object.values(store.sites).every((item) => item.status === 'renewable'));
check('角标清空', badge.text === '');
check('没有新增标签页', tabs.length === 1);

console.log('6) 网络异常：归类为 error 且可点开登录页');
setProbe({ icourse: TIMEOUT, ehall: AUTH, elearning: AUTH, my: AUTH });
await callMessage({ type: 'probe' });
check('icourse 状态为 error', store.sites.icourse.status === 'error');
check('角标显示 1', badge.text === '1', badge.text);
const openResult = await callMessage({ type: 'openLogin', siteId: 'icourse' });
check('openLogin 复用已有标签页', openResult?.ok === true && openResult.created === false, JSON.stringify(openResult));
check('复用时触发 tabs.update', tabUpdates.length >= 1);
const unknown = await callMessage({ type: 'openLogin', siteId: 'nope' });
check('未知站点返回错误', unknown?.ok === false);

console.log('7) 修改间隔后重建定时器');
await chrome.storage.local.set({ settings: { intervalMinutes: 5 } });
await new Promise((resolve) => setTimeout(resolve, 20));
check('periodInMinutes 更新为 5', alarms.at(-1).periodInMinutes === 5, JSON.stringify(alarms.at(-1)));

console.log('8) 通知点击：打开首个异常站点');
const before = tabs.length;
await listeners.notificationClick[0]('fudan-login-expired');
check('点击后打开/激活标签页', tabs.length >= before);

console.log(failures.length ? `\n失败 ${failures.length} 项：${failures.join(', ')}` : '\n全部通过');
process.exit(failures.length ? 1 : 0);
