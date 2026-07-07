export const PAGE_FINDFIT = `<!-- ══ PAGE: FIND YOUR FIT (guided 2-tap intake) ═══════════════════ --> <div class="app-page" id="page-findfit" hidden> <div class="roles-hero">   <p class="roles-hero-eyebrow">Timothy Lutheran &mdash; Serving Together</p>   <h2>Let&rsquo;s find where <em>you fit.</em></h2>   <p class="roles-hero-sub">Two quick taps &mdash; no forms yet.</p> </div> <main>

  <div id="ff-step1">
    <div class="form-section-label">How much time can you give?</div>
    <div class="chip-group" id="ff-time-chips" style="margin-bottom:1.5rem;">
      <label class="chip-label checked"><input type="radio" name="ff-time" value="hour" checked>An hour on Sunday</label>
      <label class="chip-label"><input type="radio" name="ff-time" value="month">A few hours a month</label>
      <label class="chip-label"><input type="radio" name="ff-time" value="unsure">Not sure yet</label>
    </div>

    <div class="form-section-label">What draws you?</div>
    <div style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:1.5rem;" id="ff-interest-list">
      <label class="role-card" style="padding:.75rem 1rem;display:flex;align-items:center;gap:.6rem;" for="ff-i-worship"><input type="checkbox" id="ff-i-worship" name="ff-interest" value="worship" style="position:static;opacity:1;pointer-events:auto;width:18px;height:18px;"><span>Worship &amp; music</span></label>
      <label class="role-card" style="padding:.75rem 1rem;display:flex;align-items:center;gap:.6rem;" for="ff-i-education"><input type="checkbox" id="ff-i-education" name="ff-interest" value="education" style="position:static;opacity:1;pointer-events:auto;width:18px;height:18px;"><span>Kids &amp; teaching</span></label>
      <label class="role-card" style="padding:.75rem 1rem;display:flex;align-items:center;gap:.6rem;" for="ff-i-acceptance"><input type="checkbox" id="ff-i-acceptance" name="ff-interest" value="acceptance" style="position:static;opacity:1;pointer-events:auto;width:18px;height:18px;"><span>Care &amp; visiting neighbors</span></label>
      <label class="role-card" style="padding:.75rem 1rem;display:flex;align-items:center;gap:.6rem;" for="ff-i-outreach"><input type="checkbox" id="ff-i-outreach" name="ff-interest" value="outreach" style="position:static;opacity:1;pointer-events:auto;width:18px;height:18px;"><span>Outreach &amp; events</span></label>
    </div>

    <button class="btn-submit" type="button" onclick="ffShowResults()" style="width:100%;justify-content:center;">Show me roles</button>
    <div style="text-align:center;margin-top:.75rem;"><a href="javascript:void(0)" data-nav-page="landing" style="font-size:.85rem;color:var(--teal);font-weight:600;">Skip &mdash; browse all ministries</a></div>
  </div>

  <div id="ff-step2" hidden>
    <p id="ff-results-subhead" style="font-size:.85rem;color:var(--text-muted);margin-bottom:1rem;"></p>
    <div id="ff-results-list" style="display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.25rem;"></div>
    <div style="text-align:center;"><a href="javascript:void(0)" data-nav-page="landing" style="font-size:.9rem;color:var(--teal);font-weight:600;">See all ministries instead</a></div>
  </div>

</main> </div><!-- /page-findfit -->   `;
