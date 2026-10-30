
const CACHE='yimai-phone-shell-v6-person-first';
const SHELL=['/','/app.js','/workspace.js','/style.css','/cloud-agent.js','/browser-store.js','/phone-backup.js','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin===location.origin&&e.request.method==='GET'&&SHELL.includes(u.pathname))e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
