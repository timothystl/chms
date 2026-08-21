export const PAGE_MARKET = `<div class="app-page sv-page" id="page-market" hidden>
<section class="sv-hero"><div class="sv-hero-inner">
<p class="sv-eyebrow">Weihnachtsmarkt &middot; first Saturday in December &middot; 11 am &ndash; 6 pm</p>
<h1 class="sv-h1">Timothy Christmas Market</h1>
<p class="sv-hero-body">It takes about ninety of us to pull off the Weihnachtsmarkt &mdash; setup on Friday, then a full Saturday of grilling, gl&uuml;hwein, greeting, and grateful cleanup. Take one shift or several; every hour helps.</p>
<p class="sv-hero-body"><em>Selling instead of serving?</em> <a href="https://timothystl.org/christmasmarket/vendors">Apply for a vendor table &rarr;</a></p>
</div></section>
<div class="sv-wrap">
<div class="sv-shell" id="mkt-hold" hidden>
<div class="sv-section" style="text-align:center;">
<p class="sv-eyebrow" style="color:var(--sv-honey);">Registrations are on hold</p>
<h2 class="sv-h2">Sign-ups aren't open right now</h2>
<p class="sv-sub">Check back soon, or contact the church office if you have questions.</p>
</div>
</div>
<div class="sv-shell" id="sv-mkt-you">
<div class="sv-section">
<p class="sv-eyebrow" style="color:var(--sv-honey);">First &mdash; who are you?</p>
<p class="sv-sub">So the market coordinator can confirm your shifts and send the day-of details.</p>
<div class="sv-fields">
<div class="sv-field"><label for="mkt-name">Your name *</label><input type="text" id="mkt-name" placeholder="First and last" autocomplete="name"></div>
<div class="sv-field"><label for="mkt-email">Email *</label><input type="email" id="mkt-email" placeholder="you@example.com" autocomplete="email"></div>
<div class="sv-field"><label for="mkt-phone">Phone</label><input type="tel" id="mkt-phone" placeholder="Best number on market day" autocomplete="tel"></div>
<div class="sv-field"><label for="mkt-notes">Anything we should know</label><input type="text" id="mkt-notes" placeholder="Bringing a teenager, can lift, etc."></div>
</div>
<div id="mkt-who-error"></div>
</div>
</div>
<div class="sv-shell" id="sv-mkt-shifts">
<div class="sv-section">
<h2 class="sv-h2">Pick your shifts</h2>
<p class="sv-sub">Browse whichever way you think &mdash; by the job you'd like, by the hours you're free, or by the day you can come. Take as many shifts as you want, including the same job twice.</p>
<div class="sv-segtoggle" id="mkt-mode-toggle">
<button type="button" data-mode="job" class="active">By job</button>
<button type="button" data-mode="time">By time</button>
<button type="button" data-mode="day">By day</button>
</div>
<div id="mkt-mode-body"></div>
</div>
<div class="sv-summary-panel" id="mkt-summary">
<h3 class="sv-h2" style="font-size:1.3rem;" id="mkt-summary-heading">Your shifts</h3>
<div id="mkt-shift-rows"></div>
<div id="mkt-shift-error"></div>
<div class="sv-row" id="mkt-submit-row"><button type="button" class="sv-btn" id="mkt-submit-btn">Sign me up</button></div>
</div>
</div>
<div class="sv-shell sv-done" id="mkt-done" hidden>
<div class="sv-section">
<p class="sv-eyebrow">You're on the list</p>
<h2 class="sv-h2" id="mkt-done-h2">Thank you.</h2>
<p class="sv-done-body">The market coordinator will confirm by email with day-of details.</p>
<div class="sv-done-shifts" id="mkt-done-shifts"></div>
<div class="sv-done-actions">
<button type="button" class="sv-btn-ghost" data-nav-page="landing">Other ways to serve</button>
<button type="button" class="sv-btn-ghost" id="mkt-signup-another">Sign up someone else</button>
</div>
</div>
</div>
</div>
<div class="sv-stickybar" id="mkt-stickybar" hidden>
<div class="sv-stickybar-inner">
<span class="sv-stickybar-count" id="mkt-stickybar-count">0 shifts picked</span>
<button type="button" class="sv-btn-gold" id="mkt-stickybar-btn">Finish sign-up</button>
</div>
</div>
<div class="sv-toast" id="mkt-toast"><div class="sv-toast-pill"><span class="sv-toast-badge" id="mkt-toast-badge"></span><span id="mkt-toast-text"></span></div></div>
</div><!-- /page-market -->
`;
