// 复旦登录监测：定时探测统一认证（UIS）登录态，失效时提醒并补开认证页。
// 不读取 Cookie、不保存账号密码，全部网络请求只发往以下复旦域名。

const ALARM_NAME = 'fudan-login-probe';
const NOTIFICATION_ID = 'fudan-login-expired';
const DEFAULT_INTERVAL_MINUTES = 20;
const MIN_INTERVAL_MINUTES = 5;
const PROBE_TIMEOUT_MS = 15000;

// 各站点独立探活：CAS 站点用统一认证入口，应用站点探测自己的业务接口。
const SITES = [
  {
    id: 'icourse',
    name: '智慧教学资源平台',
    service: 'https://icourse.fudan.edu.cn/',
    loginUrl: 'https://icourse.fudan.edu.cn/yjlogin/#/prelogin?tenant_code=222&forward=https%3A%2F%2Ficourse.fudan.edu.cn%2F',
  },
  {
    id: 'ehall',
    name: 'eHall',
    service: 'https://ehall.fudan.edu.cn/',
    loginUrl: 'https://ehall.fudan.edu.cn/',
  },
  {
    id: 'elearning',
    name: 'eLearning',
    service: 'https://elearning.fudan.edu.cn/',
    loginUrl: 'https://elearning.fudan.edu.cn/',
  },
  {
    id: 'my',
    name: '个人门户',
    service: 'https://my.fudan.edu.cn/',
    loginUrl: 'https://my.fudan.edu.cn/',
  },
];

function probeUrl(service) {
  return `https://id.fudan.edu.cn/authserver/login?service=${encodeURIComponent(service)}`;
}

// 已登录时 UIS 跳到 /idp/authCenter/authenticate；未登录停在 /ac/#/index?...lck=
function isAuthenticated(url) {
  return url.includes('/idp/authCenter/authenticate');
}

// UIS 会话仍在时会直接签发新的 ST ticket，此时打开任意站点都能免密登录。
function issuedTicket(text, url) {
  return /ticket=ST-/.test(url) || /ticket=ST-/.test(text || '');
}

async function probeSite(site) {
  try {
    const response = await fetch(probeUrl(site.service), {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = response.ok ? await response.text() : '';
    const authenticated = response.ok && isAuthenticated(response.url);
    const renewable = response.ok && !authenticated && issuedTicket(body, response.url);
    return {
      id: site.id,
      ok: response.ok,
      authenticated,
      renewable,
      status: authenticated ? 'ok' : renewable ? 'renewable' : 'expired',
    };
  } catch (error) {
    return {
      id: site.id,
      ok: false,
      authenticated: false,
      renewable: false,
      status: 'error',
      error: String(error),
    };
  }
}

// 记录自己打开过的标签页 id：不依赖 tabs 权限，也不需要读取标签页 URL。
async function openLoginTab(site) {
  const { loginTabs = {} } = await chrome.storage.local.get('loginTabs');
  const existingId = loginTabs[site.id];
  if (typeof existingId === 'number') {
    try {
      await chrome.tabs.update(existingId, { active: true });
      return false;
    } catch (error) {
      delete loginTabs[site.id]; // 标签已被关闭
    }
  }
  const tab = await chrome.tabs.create({ url: site.loginUrl, active: false });
  loginTabs[site.id] = tab.id;
  await chrome.storage.local.set({ loginTabs });
  return true;
}

function updateBadge(failing) {
  const count = failing.length;
  chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  chrome.action.setBadgeText({ text: count ? String(count) : '' });
  chrome.action.setTitle({
    title: count ? `${count} 个站点登录态异常，点击查看` : '复旦登录状态：正常',
  });
}

async function notifyOnce(failing, opened) {
  const key = failing.map((item) => item.id).sort().join(',');
  const { notifiedKey = '' } = await chrome.storage.local.get('notifiedKey');
  if (key === notifiedKey) {
    return; // 同一批站点只提醒一次，避免每轮重复弹窗
  }
  await chrome.storage.local.set({ notifiedKey: key });

  const names = failing.map((item) => item.name).join('、');
  const message = opened.length
    ? `已为 ${opened.join('、')} 打开认证页。`
    : `${names} 需要重新登录，请打开对应站点确认。`;

  await chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'notification.png',
    title: '复旦登录需要重新确认',
    message,
    priority: 2,
  });
}

async function runProbe() {
  const results = await Promise.all(SITES.map(probeSite));
  const previous = (await chrome.storage.local.get('sites')).sites || {};
  const next = {};
  const opened = [];

  for (const result of results) {
    const site = SITES.find((item) => item.id === result.id);
    next[result.id] = { ...result, checkedAt: Date.now() };
    // 只有“上次有效、这次失效”时才补登录，避免每轮都弹标签页
    if (result.status === 'expired' && previous[result.id]?.authenticated && site) {
      if (await openLoginTab(site)) {
        opened.push(site.name);
      }
    }
  }

  const checkedAt = Date.now();
  await chrome.storage.local.set({ sites: next, checkedAt });

  const failing = results
    .filter((item) => item.status === 'expired' || item.status === 'error')
    .map((item) => ({ ...item, name: SITES.find((site) => site.id === item.id)?.name || item.id }));

  updateBadge(failing);
  if (failing.length) {
    await notifyOnce(failing, opened);
  } else {
    await chrome.storage.local.set({ notifiedKey: '' });
  }

  return { results, failing, checkedAt };
}

// 定时器、启动、弹窗可能同时触发，复用同一个进行中的探活。
let inFlight = null;
function probeLogin() {
  if (!inFlight) {
    inFlight = runProbe().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function getIntervalMinutes() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const value = Number(settings.intervalMinutes);
  return Number.isFinite(value) && value >= MIN_INTERVAL_MINUTES
    ? Math.round(value)
    : DEFAULT_INTERVAL_MINUTES;
}

async function ensureAlarm() {
  const periodInMinutes = await getIntervalMinutes();
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm || alarm.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // 旧版本在 storage 里留过一个从未被使用的 username 字段，顺手清掉。
  await chrome.storage.local.remove('username');
  await ensureAlarm();
  await probeLogin();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await probeLogin();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    probeLogin();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    ensureAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'probe') {
    probeLogin()
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true; // 异步响应
  }

  if (message && message.type === 'openLogin' && message.siteId) {
    const site = SITES.find((item) => item.id === message.siteId);
    if (!site) {
      sendResponse({ ok: false, error: 'unknown site' });
      return false;
    }
    openLoginTab(site)
      .then((created) => sendResponse({ ok: true, created }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId !== NOTIFICATION_ID) {
    return;
  }
  chrome.notifications.clear(notificationId);
  const { sites = {} } = await chrome.storage.local.get('sites');
  const target = SITES.find((site) => {
    const state = sites[site.id];
    return state && (state.status === 'expired' || state.status === 'error');
  });
  await openLoginTab(target || SITES[0]);
});
