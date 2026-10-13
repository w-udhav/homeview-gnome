// Sends the active tab's domain (never the full URL) to the local Homeview
// daemon through the native-messaging host `hv native-host`.
const api = typeof browser !== 'undefined' ? browser : chrome;
const HOST = 'dev.homeview.host';

let port = null;
let last = '';

function connect() {
  try {
    port = api.runtime.connectNative(HOST);
    port.onDisconnect.addListener(() => { port = null; });
  } catch (e) {
    port = null;
  }
}

function domainOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function send(domain) {
  if (!domain || domain === last) return;
  if (!port) connect();
  if (!port) return;
  try {
    port.postMessage({ t: 'site', domain });
    last = domain;
  } catch (e) {
    port = null;
  }
}

async function report() {
  try {
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url) send(domainOf(tab.url));
  } catch (e) { /* ignore */ }
}

api.tabs.onActivated.addListener(report);
api.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.status === 'complete')) report();
});
api.windows.onFocusChanged.addListener(report);
report();
