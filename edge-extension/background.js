const ALARM_NAME = 'fudan-login-probe';
const INTERVAL_MINUTES = 20;
const PROBE_TIMEOUT_MS = 15000;

// 各站点独立探活：CAS 站点用统一认证入口，应用站点探测自己的业务接口。
// 探活失败只代表“该站点需要重新走一次登录跳转”，插件可自动打开认证页标签补齐。
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
    id: 'jwfw',
    name: '教务服务',
    service: 'https://jwfw.fudan.edu.cn/',
    loginUrl: 'https://jwfw.fudan.edu.cn/',
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
    const renewable = !authenticated && response.ok && issuedTicket(body, response.url);
    return { id: site.id, ok: response.ok, authenticated, renewable };
  } catch (error) {
    return { id: site.id, ok: false, authenticated: false, renewable: false, error: String(error) };
  }
}

async function openLoginTab(url) {
  try {
    const existing = await chrome.tabs.query({ url });
    if (existing.length) {
      await chrome.tabs.update(existing[0].id, { active: true });
      return false;
    }
  } catch (error) { /* tabs.query 的模式匹配失败时直接新建 */ }
  await chrome.tabs.create({ url, active: false });
  return true;
}

async function runProbe() {
  const results = await Promise.all(SITES.map(probeSite));
  const previous = (await chrome.storage.local.get('sites')).sites || {};
  const next = {};
  const opened = [];

  for (const result of results) {
    const site = SITES.find((s) => s.id === result.id);
    next[result.id] = result;
    // 只有在“上次有效、这次失效”时才补登录，避免每轮都弹标签页
    if (!result.authenticated && !result.renewable && previous[result.id]?.authenticated && site) {
      if (await openLoginTab(site.loginUrl)) {
        opened.push(site.name);
      }
    }
  }

  await chrome.storage.local.set({ sites: next, checkedAt: Date.now() });

  const failing = results.filter((r) => !r.authenticated && !r.renewable);
  if (failing.length) {
    await chrome.notifications.create('fudan-login-expired', {
      type: 'basic',
      iconUrl: 'notification.png',
      title: '复旦登录需要重新确认',
      message: opened.length
        ? `已为 ${opened.join('、')} 打开认证页。`
        : `${failing.length} 个站点登录态异常，请打开对应站点确认。`,
      priority: 2,
    });
  }
  return results;
}

// 定时器、启动、点击可能同时触发，复用同一个进行中的探活。
let inFlight = null;
function probeLogin() {
  if (!inFlight) {
    inFlight = runProbe().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: INTERVAL_MINUTES,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  probeLogin();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  probeLogin();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    probeLogin();
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'fudan-login-expired') {
    chrome.tabs.create({ url: SITES[0].loginUrl });
    chrome.notifications.clear(notificationId);
  }
});

chrome.action.onClicked.addListener(() => {
  probeLogin();
});
