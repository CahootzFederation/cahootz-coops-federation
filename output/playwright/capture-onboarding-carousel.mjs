import { mkdir, writeFile } from 'node:fs/promises';

const targetUrl = 'http://localhost:8082/profile-onboarding';
const user = {
  id: 'qa-carousel-user',
  email: 'qa-carousel@example.com',
  handle: 'qacarousel',
  name: 'QA User',
  roles: ['user'],
  status: 'ACTIVE',
  walletAddress: null,
  phone: null,
  createdAt: new Date().toISOString(),
  selfDescription: null,
  shortTermGoals: null,
  longTermGoals: null,
  skills: [],
  interests: [],
  resourcesOffered: [],
  resourcesNeeded: [],
  businessSummary: null,
  locationSummary: null,
  profileSignals: null,
  profileOnboardingCompletedAt: null,
  sessionToken: 'qa-token',
};

const targets = await fetch('http://localhost:9224/json').then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);

if (!page) {
  throw new Error('No Chrome page target found.');
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Page.navigate', { url: 'http://localhost:8082' });
await new Promise((resolve) => setTimeout(resolve, 1000));
await send('Runtime.evaluate', {
  expression: `
    localStorage.setItem('soulaan.user', ${JSON.stringify(JSON.stringify(user))});
    localStorage.setItem('soulaan.sessionToken', 'qa-token');
    localStorage.removeItem('soulaan.profileOnboardingDeferredUser');
  `,
});
await send('Page.navigate', { url: targetUrl });
await new Promise((resolve) => setTimeout(resolve, 3500));

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});

await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/profile-onboarding-carousel.png', Buffer.from(screenshot.data, 'base64'));
ws.close();
