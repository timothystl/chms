export const PUBLIC_LANDING = `<div class="app-page sv-page" id="page-landing">
<section class="sv-hero"><div class="sv-hero-inner">
<p class="sv-eyebrow">Serving Together</p>
<h1 class="sv-h1">Every hand <em>makes a difference.</em></h1>
<p class="sv-hero-body">A three-step way to tell us who you are and what sounds like you. Checking a box is not a commitment.</p>
</div></section>
<div class="sv-wrap">
<div class="sv-shell" id="sv-wizard">
<div class="sv-steprail" id="sv-steprail">
<span class="active" data-step="1">1 &middot; You</span><em>&rarr;</em><span data-step="2">2 &middot; Pick a role</span><em>&rarr;</em><span data-step="3">3 &middot; Send it</span>
</div>
<div class="sv-section" id="sv-step1">
<h2 class="sv-h2">First, who are you?</h2>
<p class="sv-sub">Just enough for a ministry leader to reach you.</p>
<div class="sv-fields">
<div class="sv-field"><label for="sv-name">Your name *</label><input type="text" id="sv-name" autocomplete="name"></div>
<div class="sv-field"><label for="sv-email">Email *</label><input type="email" id="sv-email" autocomplete="email"></div>
<div class="sv-field"><label for="sv-phone">Phone <span style="font-weight:400;">(optional)</span></label><input type="tel" id="sv-phone" autocomplete="tel"></div>
</div>
<div id="sv-step1-error"></div>
<div class="sv-row">
<button type="button" class="sv-btn" id="sv-step1-next">Next &mdash; pick a role</button>
<button type="button" class="sv-link-italic" data-nav-page="market">I'm here about the Christmas Market &rarr;</button>
</div>
</div>
<div class="sv-section" id="sv-step2" hidden>
<h2 class="sv-h2" id="sv-step2-h2">What sounds like you?</h2>
<div class="sv-chips" id="sv-chips"></div>
<div id="sv-role-groups"></div>
<div class="sv-row" id="sv-step2-actions">
<button type="button" class="sv-btn-ghost" id="sv-step2-back">&larr; Back</button>
<button type="button" class="sv-btn" id="sv-step2-done" hidden>Done &mdash; review <span id="sv-step2-count">0</span> role(s)</button>
</div>
</div>
<div class="sv-section" id="sv-step3" hidden>
<h2 class="sv-h2" id="sv-step3-h2">Ready to send</h2>
<div id="sv-picked-roles"></div>
<div class="sv-field" style="margin-top:1.5rem;"><label for="sv-notes">Anything the leader should know</label><textarea id="sv-notes" rows="3" placeholder="Seasons you're free, a skill you'd like to use, a question."></textarea></div>
<div id="sv-step3-error"></div>
<div class="sv-row">
<button type="button" class="sv-btn" id="sv-step3-send">Send my interest</button>
<button type="button" class="sv-btn-gold" id="sv-step3-add">+ Add another role</button>
</div>
</div>
<div class="sv-section sv-done" id="sv-step-done" hidden>
<p class="sv-eyebrow">Thank you</p>
<h2 class="sv-h2" id="sv-done-h2">We've got it.</h2>
<p class="sv-done-body">A ministry leader will email or call within a week to help you get started. Questions before then? Call the church office at (314) 781-8673.</p>
<div id="sv-done-roles" class="sv-done-shifts" hidden></div>
<div class="sv-done-actions">
<a href="https://timothystl.org" class="sv-btn-ghost">Back to timothystl.org</a>
<button type="button" class="sv-btn-ghost" id="sv-signup-another">Sign up someone else</button>
</div>
</div>
</div>
</div>
</div><!-- /page-landing -->
`;
