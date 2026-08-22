// ── HTML templates: Login, Public signup page, Admin scheduler page ────────────
import { DEPLOY_VERSION } from './frontend/js-core.js';
import { PUBLIC_HEAD } from './public/head.js';
import { PUBLIC_LANDING } from './public/landing.js';
import { PAGE_MARKET } from './public/market.js';
import { PAGE_MINISTRIES } from './public/ministries.js';
import { PAGE_FINDFIT } from './public/findfit.js';
import { PUBLIC_FOOTER } from './public/footer.js';
import { PUBLIC_SCRIPTS } from './public/scripts.js';
import { PAGE_WORSHIP } from './public/ministries/worship.js';
import { PAGE_EVENTS } from './public/ministries/events.js';
import { PAGE_EDUCATION } from './public/ministries/education.js';
import { PAGE_ACCEPTANCE } from './public/ministries/acceptance.js';
import { PAGE_OUTREACH } from './public/ministries/outreach.js';
import { PAGE_GENERAL } from './public/ministries/general.js';
import { PAGE_LASM } from './public/ministries/lasm.js';
import { PAGE_WOL } from './public/ministries/wol.js';
import { PAGE_CFNA } from './public/ministries/cfna.js';

export const LOGIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Sign In \u2014 Connect</title><link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=${DEPLOY_VERSION}"><link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png?v=${DEPLOY_VERSION}"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'DM Sans',sans-serif;font-weight:400;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:16px;padding:2.5rem;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(30,45,74,.12);}.wm{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:1.75rem;}.wm-lockup{width:100%;max-width:300px;height:auto;display:block;}.field{margin-bottom:1rem;}label{display:block;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.2em;color:var(--navy);margin-bottom:.4rem;}input{width:100%;padding:.7rem 1rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.95rem;font-family:inherit;outline:none;}input:focus{border-color:var(--teal);}.btn{width:100%;background:var(--navy);color:#fff;border:none;padding:.85rem;border-radius:8px;font-size:1rem;font-weight:500;cursor:pointer;margin-top:.5rem;transition:background .15s;font-family:inherit;}.btn:hover{background:var(--teal);}.btn:disabled{opacity:.6;cursor:wait;}.hint{font-size:.78rem;color:#aaa;margin-top:1.2rem;text-align:center;border-top:1px solid #eee;padding-top:.9rem;}</style></head><body><div class="card"><div class="wm"><img class="wm-lockup" src="/icons/connect-lockup.png?v=${DEPLOY_VERSION}" alt="Connect — Timothy Lutheran Church — From our Neighborhood to the Nations" width="900" height="335"></div><!--ERROR--><form method="POST" action="/admin/login" onsubmit="var b=this.querySelector('.btn');b.disabled=true;b.textContent='Signing in\u2026';"><div class="field"><label for="un">Username</label><input type="text" id="un" name="username" placeholder="Enter username" autocomplete="username" autofocus required></div><div class="field"><label for="pw">Password</label><input type="password" id="pw" name="password" placeholder="Enter password" autocomplete="current-password" required></div><button class="btn" type="submit">Sign In</button></form><div style="margin-top:.9rem;text-align:center;"><a href="#" id="fp-link" style="color:#2E7EA6;font-size:.82rem;text-decoration:none;">Forgot password?</a></div><div id="fp-panel" style="display:none;margin-top:.9rem;padding-top:.9rem;border-top:1px solid #eee;"><p style="font-size:.82rem;color:#3D3530;margin-bottom:.6rem;">Enter your username or email. If an account exists, we'll send a reset link.</p><form id="fp-form" onsubmit="event.preventDefault();var f=this,b=f.querySelector('.btn');b.disabled=true;b.textContent='Sending…';fetch('/admin/forgot-password',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'username='+encodeURIComponent(f.username.value)}).then(function(){document.getElementById('fp-panel').innerHTML='<div style=\\'padding:.7rem;background:#e8f6ed;color:#1d6b3a;border-radius:8px;font-size:.85rem;text-align:center;\\'>If an account exists, a reset email has been sent.</div>';});"><div class="field"><label for="fp-un">Username or email</label><input type="text" id="fp-un" name="username" required></div><button class="btn" type="submit">Send reset link</button></form></div><script>document.getElementById('fp-link').addEventListener('click',function(e){e.preventDefault();var p=document.getElementById('fp-panel');p.style.display=p.style.display==='none'?'block':'none';});</script></div></body></html>`;

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

