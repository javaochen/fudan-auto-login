const DEFAULT_INTERVAL_MINUTES = 20;
const MIN_INTERVAL_MINUTES = 5;

const interval = document.querySelector('#interval');
const saveButton = document.querySelector('#save');
const status = document.querySelector('#status');

async function load() {
  document.querySelector('#version').textContent = chrome.runtime.getManifest().version;
  const { settings = {} } = await chrome.storage.local.get('settings');
  const minutes = Number(settings.intervalMinutes);
  interval.value = String(
    Number.isFinite(minutes) && minutes >= MIN_INTERVAL_MINUTES ? minutes : DEFAULT_INTERVAL_MINUTES,
  );
}

saveButton.addEventListener('click', async () => {
  const minutes = Math.max(MIN_INTERVAL_MINUTES, Number(interval.value) || DEFAULT_INTERVAL_MINUTES);
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, intervalMinutes: minutes } });
  status.textContent = '已保存，下次检查按新间隔执行';
  setTimeout(() => {
    status.textContent = '';
  }, 2500);
});

load();
