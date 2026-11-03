const ALARM_NAME = 'fudan-login-probe';
const SERVICE = 'https://icourse.fudan.edu.cn/';
const PROBE_URL = `https://id.fudan.edu.cn/authserver/login?service=${encodeURIComponent(SERVICE)}`;
const LOGIN_URL = 'https://icourse.fudan.edu.cn/yjlogin/#/prelogin?tenant_code=222&forward=https%3A%2F%2Ficourse.fudan.edu.cn%2F';
const INTERVAL_MINUTES = 20;
const PROBE_TIMEOUT_MS = 15000;

// 已登录时 UIS 跳到 /idp/authCenter/authenticate；未登录停在 /ac/#/index?...lck=
function isLoggedIn(url) {
  return url.includes('/idp/authCenter/authenticate');
}

// 未登录也不一定需要人工：UIS 会话仍在时，同一入口会静默签发新的 ST ticket。
// 未拿到 ticket 才说明连 UIS 会话都已过期。
function issuedTicket(text, url) {
  return /ticket=ST-/.test(url) || /ticket=ST-/.test(text || '');
}

async function runProbe() {
  try {
    const response = await fetch(PROBE_URL, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = response.ok ? await response.text() : '';
    const loggedIn = response.ok && isLoggedIn(response.url);
    const renewed = !loggedIn && response.ok && issuedTicket(body, response.url);
    const previous = await chrome.storage.local.get('loggedIn');
    await chrome.storage.local.set({
      loggedIn: loggedIn || renewed,
      renewed,
      checkedAt: Date.now(),
      lastError: '',
    });
    if (!loggedIn && !renewed) {
      if (previous.loggedIn !== false) {
        await chrome.notifications.create('fudan-login-expired', {
          type: 'basic',
          iconUrl: 'notification.png',
          title: '复旦登录已失效',
          message: '统一认证会话已过期，请打开认证页面重新登录。',
          priority: 2,
        });
      }
    }
    return loggedIn || renewed;
  } catch (error) {
    await chrome.storage.local.set({
      loggedIn: null,
      checkedAt: Date.now(),
      lastError: String(error),
    });
    return null;
  }
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
    chrome.tabs.create({ url: LOGIN_URL });
    chrome.notifications.clear(notificationId);
  }
});

chrome.action.onClicked.addListener(() => {
  probeLogin();
});
