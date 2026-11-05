const SITE_NAMES = {
  icourse: '智慧教学资源平台',
  ehall: 'eHall',
  elearning: 'eLearning',
  jwfw: '教务服务',
  my: '个人门户',
};

const STATUS_TEXT = {
  ok: '已登录',
  renewable: '会话可续期',
  expired: '需重新登录',
  error: '网络异常',
};

const list = document.querySelector('#sites');
const checked = document.querySelector('#checked');
const probeButton = document.querySelector('#probe');
const hint = document.querySelector('#hint');

function formatTime(timestamp) {
  if (!timestamp) {
    return '尚未检查';
  }
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) {
    return '刚刚检查';
  }
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / 60000)} 分钟前检查`;
  }
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function render(sites = {}, checkedAt = 0) {
  list.textContent = '';
  let needsLogin = false;

  for (const [id, name] of Object.entries(SITE_NAMES)) {
    const state = sites[id];
    const status = state ? state.status : 'unknown';
    const row = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;

    const right = document.createElement('span');
    right.className = 'right';

    const pill = document.createElement('span');
    pill.className = `pill ${status}`;
    pill.textContent = STATUS_TEXT[status] || '未检查';
    if (status === 'error' && state && state.error) {
      pill.title = state.error;
    }
    right.append(pill);

    if (status === 'expired' || status === 'error') {
      needsLogin = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '去登录';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await chrome.runtime.sendMessage({ type: 'openLogin', siteId: id });
          window.close();
        } catch (error) {
          button.disabled = false;
          pill.title = String(error);
        }
      });
      right.append(button);
    }

    row.append(label, right);
    list.append(row);
  }

  checked.textContent = formatTime(checkedAt);
  hint.hidden = !needsLogin;
}

async function refresh() {
  const data = await chrome.storage.local.get(['sites', 'checkedAt']);
  render(data.sites, data.checkedAt);
  return data;
}

async function runProbe() {
  probeButton.disabled = true;
  probeButton.textContent = '检查中…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'probe' });
    if (response && response.ok) {
      render(
        Object.fromEntries(response.results.map((item) => [item.id, item])),
        response.checkedAt,
      );
      return;
    }
    await refresh();
    checked.textContent = '检查失败，显示上次结果';
  } catch (error) {
    await refresh();
    checked.textContent = '检查失败，显示上次结果';
  } finally {
    probeButton.disabled = false;
    probeButton.textContent = '立即检查';
  }
}

probeButton.addEventListener('click', runProbe);
document.querySelector('#options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh().then((data) => {
  if (!data.checkedAt) {
    runProbe();
  }
});
