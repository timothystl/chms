export const PAGE_EVENTS = `<!-- ══ PAGE: COMMUNITY EVENTS ════════════════════════════════════ --> <div class="app-page" id="page-events" hidden> <div class="roles-hero"> <div style="text-align:left;margin-bottom:1rem;"><a href="javascript:void(0)" data-nav-page="landing" class="back-link" style="margin-bottom:0;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg> Back</a></div>      <p class="roles-hero-eyebrow">Timothy Lutheran &mdash; Community Events</p>   <h2>Events that bring us <em>together.</em></h2>   <p class="roles-hero-sub">Each of these events runs on the energy of volunteers. Click an event to see the roles and sign up.</p> </div> <main>
  <div id="dynamic-events-container">
    <p style="color:var(--text-muted);text-align:center;padding:2rem;">Loading events...</p>
  </div>

</main> </div><!-- /page-events -->

<!-- ══ PAGE: SIMPLE EVENT (dedicated sign-up page for non-shift events) ══ -->
<div class="app-page" id="page-event-simple" hidden>
  <div class="simple-event-hero" id="event-simple-hero">
    <a href="javascript:void(0)" data-nav-page="events" class="back-link-plain"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg> Community Events</a>
    <p class="simple-event-eyebrow" id="event-simple-eyebrow"></p>
    <h2 class="simple-event-title" id="event-simple-title"></h2>
    <p class="simple-event-desc" id="event-simple-desc"></p>
  </div>
  <div class="simple-event-body" id="event-simple-body"></div>
</div><!-- /page-event-simple -->
   `;
