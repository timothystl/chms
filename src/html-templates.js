// ── HTML templates: Login, Public signup page, Admin scheduler page ────────────
import { DEPLOY_VERSION } from './frontend/js-core.js';
import { PUBLIC_HEAD, PUBLIC_APP_CSS } from './public/head.js';
import { PUBLIC_LANDING } from './public/landing.js';
import { PAGE_MARKET } from './public/market.js';
import { PAGE_MINISTRIES } from './public/ministries.js';
import { PAGE_FINDFIT } from './public/findfit.js';
import { PUBLIC_FOOTER } from './public/footer.js';
import { PUBLIC_SCRIPTS, PUBLIC_APP_JS } from './public/scripts.js';
import { PAGE_WORSHIP } from './public/ministries/worship.js';
import { PAGE_EVENTS } from './public/ministries/events.js';
import { PAGE_EDUCATION } from './public/ministries/education.js';
import { PAGE_ACCEPTANCE } from './public/ministries/acceptance.js';
import { PAGE_OUTREACH } from './public/ministries/outreach.js';
import { PAGE_GENERAL } from './public/ministries/general.js';
import { PAGE_LASM } from './public/ministries/lasm.js';
import { PAGE_WOL } from './public/ministries/wol.js';
import { PAGE_CFNA } from './public/ministries/cfna.js';

export const LOGIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Sign In \u2014 Connect</title><link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=${DEPLOY_VERSION}"><link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png?v=${DEPLOY_VERSION}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'"><noscript><link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet"></noscript><style>:root{--primary:#386781;--primary-hover:#2B5065;--page:#F3F7FA;--text:#293D49;--muted:#536B79;--border:#D7E2E9;--control-border:#718694;}*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Source Sans 3',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;color:var(--text);background:var(--page);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:32px;max-width:400px;width:100%;}.wm{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:24px;}.wm-lockup{width:100%;max-width:300px;height:auto;display:block;}.field{margin-bottom:16px;}label{display:block;font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;}input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--control-border);border-radius:8px;font-size:16px;font-family:inherit;color:var(--text);background:#fff;}input:focus{border-color:var(--primary);}:focus-visible{outline:3px solid var(--primary);outline-offset:3px;}input:focus-visible{outline-offset:1px;}.btn{width:100%;min-height:44px;background:var(--primary);color:#fff;border:none;padding:10px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px;transition:background-color .15s ease;font-family:inherit;}.btn:hover{background:var(--primary-hover);}.btn:disabled{opacity:.6;cursor:wait;}.hint{font-size:14px;color:var(--muted);margin-top:16px;text-align:center;border-top:1px solid var(--border);padding-top:16px;}a{color:var(--primary);text-underline-offset:3px;}</style></head><body><div class="card"><div class="wm"><img class="wm-lockup" src="/icons/connect-lockup.png?v=${DEPLOY_VERSION}" alt="Connect — Timothy Lutheran Church — From our Neighborhood to the Nations" width="900" height="335"></div><!--ERROR--><form method="POST" action="/admin/login" onsubmit="var b=this.querySelector('.btn');b.disabled=true;b.textContent='Signing in\u2026';"><div class="field"><label for="un">Username</label><input type="text" id="un" name="username" placeholder="Enter username" autocomplete="username" autofocus required></div><div class="field"><label for="pw">Password</label><input type="password" id="pw" name="password" placeholder="Enter password" autocomplete="current-password" required></div><button class="btn" type="submit">Sign in</button></form><div style="margin-top:.9rem;text-align:center;"><a href="#" id="fp-link" style="font-size:14px;">Forgot password?</a></div><div id="fp-panel" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);"><p style="font-size:14px;color:var(--muted);margin-bottom:12px;">Enter your username or email. If an account exists, we'll send a reset link.</p><form id="fp-form" onsubmit="event.preventDefault();var f=this,b=f.querySelector('.btn');b.disabled=true;b.textContent='Sending…';fetch('/admin/forgot-password',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'username='+encodeURIComponent(f.username.value)}).then(function(){document.getElementById('fp-panel').innerHTML='<div style=\\'padding:.7rem;background:#EAF5EF;color:#1A5C3E;border-radius:8px;font-size:.85rem;text-align:center;\\'>If an account exists, a reset email has been sent.</div>';});"><div class="field"><label for="fp-un">Username or email</label><input type="text" id="fp-un" name="username" required></div><button class="btn" type="submit">Send reset link</button></form></div><script>document.getElementById('fp-link').addEventListener('click',function(e){e.preventDefault();var p=document.getElementById('fp-panel');p.style.display=p.style.display==='none'?'block':'none';});</script></div></body></html>`;

// ── PUBLIC HTML ─────────────────────────────────────────────────────
// Assembled from per-section modules under ./public/. Order matters: header/CSS,
// landing card grid, then one detail page per ministry, footer, scripts.
export const PUBLIC_HTML =
  PUBLIC_HEAD +
  PUBLIC_LANDING +
  PAGE_MARKET +
  PAGE_MINISTRIES +
  PAGE_FINDFIT +
  PAGE_WORSHIP +
  PAGE_EVENTS +
  PAGE_EDUCATION +
  PAGE_ACCEPTANCE +
  PAGE_OUTREACH +
  PAGE_GENERAL +
  PAGE_LASM +
  PAGE_WOL +
  PAGE_CFNA +
  PUBLIC_FOOTER +
  PUBLIC_SCRIPTS;

// P25-G (LOAD6): the public site's ~57 KB of CSS and ~80 KB of JS were inlined into
// PUBLIC_HTML itself, which is served with no Cache-Control at all — re-downloaded in
// full on every single page view, on the church's public front door. Both are pulled
// out here and served as their own ?v=DEPLOY_VERSION immutable routes (same pattern as
// /admin/app.css and /admin/app-*.js), re-exported for the worker to route.
export { PUBLIC_APP_CSS, PUBLIC_APP_JS };

