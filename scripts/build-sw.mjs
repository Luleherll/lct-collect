import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const root = process.env.LCT_SW_ROOT ?? 'dist',
  files = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) await walk(p);
    else if (
      /\.(html|js|css|svg|webmanifest)$/.test(item.name) &&
      item.name !== 'sw.js'
    )
      files.push(p);
  }
}
await walk(root);
files.sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const cache = `lct-shell-${hash.digest('hex').slice(0, 12)}`;
const urls = files
  .map((file) => '/' + relative(root, file).replaceAll('\\', '/'))
  .map((url) => (url.endsWith('/index.html') ? url.slice(0, -10) : url));
await writeFile(
  join(root, 'sw.js'),
  `const CACHE=${JSON.stringify(cache)};const SHELL=${JSON.stringify(urls)};const PRECACHE=SHELL.filter(url=>!url.startsWith('/_astro/MemberAdmin.'));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lct-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(url.pathname);if(saved)return saved;const response=await fetch(event.request);if(response.ok)await cache.put(url.pathname,response.clone());return response;}));});
`,
);
console.log(
  `Cached ${urls.length} static app-shell resources; Firestore traffic is excluded.`,
);
