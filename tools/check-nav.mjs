/* ============================================================================
   The navigation, and the promise that every item does what it says.

   Five of their nine were removed because nothing captured supports them. The
   four that remain are asserted here against real counts from the catalogue,
   so a filter that silently matches everything would fail rather than look fine.
   ========================================================================== */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8199';
const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await b.newPage();
page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));
await page.goto(`${BASE}/?cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const tiles = () => page.evaluate(() => document.querySelectorAll('.card').length);
console.log('  all             :', await tiles(), 'tiles');

const dead = await page.evaluate(() =>
    [...document.querySelectorAll('.header-nav a')].filter(a => (a.getAttribute('href') || '') === '#all').length);
console.log('  dead #all links :', dead, dead === 0 ? '(none, correct)' : '(STILL DEAD)');

await page.click('[data-nav="outlet"]'); await page.waitForTimeout(500);
const outlet = await tiles();
const realOutlet = await page.evaluate(() => window.Catalog.all().filter(p => p.listPrice).length);
console.log('  outlet          :', outlet, 'tiles, catalogue says', realOutlet, outlet === realOutlet ? 'match' : 'MISMATCH');

await page.click('[data-nav="pickup"]'); await page.waitForTimeout(600);
const pickup = await tiles();
const realPickup = await page.evaluate(() =>
    window.Catalog.all().filter(p => window.StoreContext.availabilityOf(p.id) === 'available').length);
console.log('  pick up in store:', pickup, 'tiles, shop can supply', realPickup, pickup === realPickup ? 'match' : 'MISMATCH');

await page.click('[data-nav="departments"]'); await page.waitForTimeout(300);
const depts = await page.evaluate(() => document.querySelectorAll('#nav-departments-menu button').length);
await page.click('#nav-departments-menu button'); await page.waitForTimeout(500);
const inDept = await tiles();
const label = await page.evaluate(() => document.getElementById('nav-departments-label').textContent);
const realDept = await page.evaluate(name => window.Catalog.inDepartment(name).length, label);
console.log('  departments     :', depts, 'listed;', label, '->', inDept, 'tiles, catalogue says', realDept, inDept === realDept ? 'match' : 'MISMATCH');

await page.click('[data-nav="all"]'); await page.waitForTimeout(400);
console.log('  back to all     :', await tiles(), 'tiles');

// The product page must not link into a dead anchor.
await page.goto(`${BASE}/product.html?id=100002050&cep=01310-100`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const pdpDead = await page.evaluate(() =>
    [...document.querySelectorAll('.header-nav a')].map(a => a.getAttribute('href')).filter(h => (h || '').includes('#all')).length);
console.log('  product page    :', pdpDead === 0 ? 'no dead links' : pdpDead + ' STILL DEAD');
await page.click('[data-copy="navPickup"]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
console.log('  arrived filtered:', await tiles(), 'tiles');
await b.close();
