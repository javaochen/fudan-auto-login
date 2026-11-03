const username = document.querySelector('#username');
const status = document.querySelector('#status');

async function load() {
  const data = await chrome.storage.local.get('username');
  username.value = data.username || '';
}

document.querySelector('#save').addEventListener('click', async () => {
  await chrome.storage.local.set({ username: username.value.trim() });
  status.textContent = '已保存';
  setTimeout(() => { status.textContent = ''; }, 1500);
});

load();
