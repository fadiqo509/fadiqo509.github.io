/**
 * عامل خدمة شهد — للتطبيق المثبَّت على الشاشة الرئيسية وحده.
 *
 * لا يُسجَّل داخل تليجرام (انظر main.tsx): قناةُ أغلب الناس، فلا تُجرَّب عليها
 * طبقةٌ جديدة بلا داعٍ. وخارجَها، التطبيق المثبَّت يقلع من المخزن فيظهر فوراً
 * بدل صفحةٍ بيضاء تنتظر الشبكة.
 *
 * القاعدة: **الصفحة من الشبكة أوّلاً**. فهرس التطبيق يحمل أسماء حِزَمه
 * المبصومة، فلو قُدِّم من المخزن لبقي الناس على نسخةٍ قديمة بعد كل نشر. أمّا
 * الحِزَم نفسها فأسماؤها تتغيّر بتغيّر محتواها، فتُخزَّن بلا خوف.
 */

const BASE = '/telegram/app-v13/';
const SHELL = 'shahd-shell';
// Renamed so every phone drops copies kept under the old rules (stale icons, pages kept as pictures).
const ASSETS = 'shahd-assets-2';
const ASSET_MAX = 140;
/**
 * الألعاب المنزّلة للعب بلا إنترنت (src/core/offline.ts): مخزنٌ لكل لعبة
 * باسم `shahd-offline-<لعبة>`، ومخزن القشرة المشتركة `shahd-offline-shell`.
 * الصفحة نفسها تملؤها وتمحوها؛ العامل يقرأ منها فقط، ولا يقصّها أبداً.
 */
const OFFLINE = 'shahd-offline-';
const OFFLINE_SHELL = `${OFFLINE}shell`;
/** طلبات GET من الواجهة البرمجية التي تحفظها لعبةٌ منزّلة (قائمة صور البازل). */
const OFFLINE_API = ['/api/puzzle/photos'];
/** حين يكون في الجهاز نسخة، لا تنتظر الصفحةُ خادماً معلّقاً أكثر من هذا. */
const NAV_WAIT = 7000;
/** صفحة «شهد خارج الاتصال» — تُحفظ عند التثبيت وتُعرض حين لا خادم ولا نسخة محفوظة. */
const OFFLINE_PAGE = `${BASE}offline.html`;

/** ما يُخزَّن: حِزَم مبصومة، وملفات الألعاب (تحمل ?v=بصمة)، وصور الواجهة */
const CACHEABLE = [
  `${BASE}assets/`,
  `${BASE}pyodide-`,
  `${BASE}pyroom/`,
  '/telegram/gameicons',
  '/g/',
  '/telegram/arena.',
  '/telegram/fonts/',
  '/telegram/quran/',
  '/telegram/shahd/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.add(new Request(BASE, { cache: 'reload' })).catch(() => {});
      await cache.add(new Request(OFFLINE_PAGE, { cache: 'reload' })).catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => (key === SHELL || key === ASSETS || key.startsWith(OFFLINE) ? undefined : caches.delete(key))));
      await self.clients.claim();
    })()
  );
});

async function trim() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  if (keys.length <= ASSET_MAX) return;
  await Promise.all(keys.slice(0, keys.length - ASSET_MAX + 20).map((key) => cache.delete(key)));
}

async function offlineNames() {
  const keys = await caches.keys();
  return keys.filter((key) => key.startsWith(OFFLINE));
}

/** نسخةٌ في مخازن الألعاب المنزّلة. `loose`: بلا اعتبارٍ لرقم النسخة في الرابط — للّحظة التي لا شبكة فيها. */
async function offlineHit(request, loose) {
  for (const name of await offlineNames()) {
    const cache = await caches.open(name);
    const hit = await cache.match(request, { ignoreVary: true, ignoreSearch: Boolean(loose) });
    if (hit) return hit;
  }
  return undefined;
}

/** الخادم موقوف خلف النفق يجيب بصفحة خطأ (٥٠٢/٥٣٠) لا بانقطاع — وهذه عندنا كالانقطاع. */
const down = (response) => !response || response.status >= 500;

async function failPage() {
  const page = await (await caches.open(SHELL)).match(OFFLINE_PAGE, { ignoreVary: true }).catch(() => undefined);
  const html = page ? await page.text().catch(() => '') : '';
  return new Response(html || '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>شهد</title><p dir="rtl" style="font:16px system-ui;padding:2rem">شهد خارج الاتصال الآن. حاول بعد قليل.</p>', {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-shahd-offline': '1', 'cache-control': 'no-store' },
  });
}

/** صفحة التطبيق المحفوظة حين لا شبكة. */
async function savedShell() {
  // نسخة الألعاب المنزّلة أوّلاً: صفحتها وحِزَمها من نشرةٍ واحدة محفوظةٍ كاملة،
  // أمّا صفحة التصفّح الأخيرة فقد تشير إلى حِزَم لعبةٍ من نشرةٍ أحدث لم تُنزَّل.
  const kept = (await caches.has(OFFLINE_SHELL)) ? await (await caches.open(OFFLINE_SHELL)).match(BASE, { ignoreVary: true }) : undefined;
  if (kept) return kept;
  return (await caches.open(SHELL)).match(BASE, { ignoreVary: true });
}

/**
 * الفهرس: من الشبكة، ومن المخزن حين لا شبكة أو الخادم موقوف.
 * على gamesqo.com نطاق العامل هو الموقع كلّه، فلا يُحفظ إلا ما هو صفحة التطبيق فعلاً.
 */
async function shell(request) {
  const cache = await caches.open(SHELL);
  const keptAlready = (await offlineNames()).length > 0;
  let timer;
  const network = fetch(request).then(async (response) => {
    if (response && response.status === 200 && (response.headers.get('content-type') || '').includes('text/html')) {
      const text = await response.clone().text().catch(() => '');
      if (text.includes(`${BASE}assets/`)) await cache.put(BASE, response.clone());
    }
    return response;
  });
  network.catch(() => undefined);
  // من نزّل لعبةً لا ينتظر خادماً معلّقاً: بعد مهلةٍ تُفتح النسخة المحفوظة.
  const waited = keptAlready
    ? new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), NAV_WAIT); })
    : new Promise(() => {});
  try {
    const response = await Promise.race([network, waited]);
    clearTimeout(timer);
    if (!down(response)) return response;
    const saved = await savedShell();
    return saved || failPage();
  } catch (error) {
    clearTimeout(timer);
    return (await savedShell()) || failPage();
  }
}

/** الأصول: المخزن أوّلاً، ثم الشبكة؛ وحين تتعذّر الشبكة فنسخة الألعاب المنزّلة بأيّ رقم نسخة. */
const isPage = (response) => (response.headers.get('content-type') || '').includes('text/html');

/** Files whose name changes with their content: safe to keep. Anything else may be edited in place. */
function stamped(url) {
  return url.pathname.startsWith(`${BASE}assets/`) || url.pathname.startsWith(`${BASE}pyodide-`) || url.pathname.startsWith(`${BASE}pyroom/`)
    || url.pathname.startsWith('/telegram/fonts/') || /[?&]v=/.test(url.search);
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  // An icon or picture with no stamp is asked for fresh each time (the browser's own revalidation keeps it cheap);
  // the kept copy only answers when the network cannot. A kept copy answering first was the owner's old icons
  // showing on some phones long after he changed them.
  if (!stamped(new URL(request.url))) {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.status === 200 && !isPage(fresh)) {
        await cache.put(request, fresh.clone()).catch(() => undefined);
        return fresh;
      }
      if (!down(fresh)) return fresh;
    } catch (error) {
      /* offline: the kept copy below */
    }
    const kept = (await cache.match(request, { ignoreVary: true })) || (await offlineHit(request, true));
    if (kept) return kept;
    return fetch(request);
  }
  const hit = (await cache.match(request, { ignoreVary: true })) || (await offlineHit(request, false));
  if (hit) return hit;
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const kept = await offlineHit(request, true);
    if (kept) return kept;
    throw error;
  }
  // A page answering for a missing file must never be kept as that file: the picture would stay broken for good.
  if (response && response.status === 200 && !isPage(response)) {
    await cache.put(request, response.clone()).catch(() => undefined);
    void trim();
    return response;
  }
  if (down(response)) return (await offlineHit(request, true)) || response;
  return response;
}

/** ما تحفظه لعبةٌ منزّلة من الواجهة البرمجية: من الشبكة دائماً، ومن المحفوظ حين تتعذّر. */
async function offlineApi(request) {
  try {
    const response = await fetch(request);
    if (!down(response)) return response;
    return (await offlineHit(request, true)) || response;
  } catch (error) {
    const kept = await offlineHit(request, true);
    if (kept) return kept;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_API.includes(url.pathname)) event.respondWith(offlineApi(request));
    return;
  }

  if (request.mode === 'navigate') {
    // ملفات الموقع الثابتة على gamesqo.com (صفحات ومستندات بامتداد) ليست صفحة التطبيق.
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.endsWith('.html')) return;
    event.respondWith(shell(request));
    return;
  }

  if (!CACHEABLE.some((prefix) => url.pathname.startsWith(prefix))) return;
  // طلبٌ يسأل الخادم صراحةً (تنزيل لعبةٍ للعب بلا إنترنت يجلب الأحدث) يمرّ إلى الشبكة كما هو.
  if (request.cache === 'no-cache' || request.cache === 'reload' || request.cache === 'no-store') return;

  event.respondWith(asset(request).catch(() => fetch(request)));
});

/* ── تنبيهات الدفع: تصل وشهد مغلقة، والضغط يفتح المكان نفسه ── */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'شهد', body: event.data ? event.data.text() : '' };
  }
  const call = data.kind === 'call';
  event.waitUntil(
    (async () => {
      // من يرى شهد مفتوحة أمامه لا يحتاج تنبيه نظام فوقها — إلا الاتصال.
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const watching = open.some((c) => c.visibilityState === 'visible' && c.focused !== false);
      if (watching && !call && data.kind !== 'confirm') {
        open.forEach((c) => c.postMessage({ type: 'push', data }));
        return;
      }
      await self.registration.showNotification(data.title || 'شهد', {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        requireInteraction: call,
        vibrate: call ? [400, 200, 400, 200, 400] : [120],
        icon: '/telegram/shahd/app-icon-192.png',
        badge: '/telegram/shahd/app-icon-192.png',
        // صورة إشعار المالك تظهر كبيرة داخل التنبيه (أندرويد والحاسوب).
        image: data.image || undefined,
        lang: 'ar',
        dir: 'rtl',
        data,
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.target) || '';
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = open.find((c) => new URL(c.url).pathname.startsWith(BASE)) || open[0];
      if (mine) {
        await mine.focus().catch(() => {});
        mine.postMessage({ type: 'push-open', target });
        return;
      }
      await self.clients.openWindow(`${BASE}${target ? `?push=${encodeURIComponent(target)}` : ''}`);
    })()
  );
});

// المتصفّح جدّد الاشتراك وحده (يحدث في أندرويد أحيانًا): الواجهة تعيد تسجيله عند الفتح.
self.addEventListener('pushsubscriptionchange', () => {});

/* «رجعت شهد» لم تعد تُرسل وحدها أبدًا (أمر المالك): لا فحص في الخلفية ولا تنبيه آلي.
   من سجّل الفحص قديمًا من صفحة الانقطاع يُلغى تسجيله بصمت ولا يصله شيء. */
async function dropBackCheck() {
  try { if (self.registration.periodicSync) await self.registration.periodicSync.unregister('shahd-back'); } catch (error) { /* not supported */ }
}
self.addEventListener('sync', (event) => {
  if (event.tag === 'shahd-back') event.waitUntil(dropBackCheck());
});
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'shahd-back') event.waitUntil(dropBackCheck());
});
