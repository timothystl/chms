// ── Privacy Policy & Terms of Service ──────────────────────────────────────
// Public, unauthenticated static pages. Written specifically to satisfy third-party
// integration requirements (e.g. QuickBooks Online's app-registration form asks for these
// URLs) for Connect, Timothy Lutheran Church's church management system. Connect has two
// tiers of authorized users — staff/volunteer accounts with administrative access, and
// member accounts with a filtered, read-only directory view — but it is still not a public
// consumer product: every user is individually authorized by the church, there's no
// self-signup. Plain-language and honest about what the system actually does; not a
// substitute for review by the church's own legal counsel if desired.
const STYLE = `<style>
:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#6B7280;--ink:#1A1A2A;}
*{box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--ink);margin:0;padding:0;line-height:1.6;}
.wrap{max-width:720px;margin:0 auto;padding:2.5rem 1.5rem 4rem;}
h1{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:2.4rem;color:var(--navy);margin:0 0 .3rem;}
.updated{font-size:.8rem;color:var(--muted);margin-bottom:2rem;}
h2{font-size:1.05rem;color:var(--navy);margin:2rem 0 .6rem;}
p,li{font-size:.95rem;color:var(--ink);}
ul{padding-left:1.3rem;}
a{color:var(--teal);}
.foot{margin-top:2.5rem;padding-top:1rem;border-top:1px solid rgba(30,45,74,.12);font-size:.8rem;color:var(--muted);}
</style>`;

const HEAD = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">` +
  `<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">` +
  `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">` +
  STYLE;

export const PRIVACY_HTML = `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>Privacy Policy — Connect</title></head><body><div class="wrap">
<h1>Privacy Policy</h1>
<div class="updated">Connect — Timothy Lutheran Church Management System &middot; Last updated 2026-07-22</div>

<p>Connect ("the system") is Timothy Lutheran Church's church management system, used by church staff to manage membership records, giving, attendance, volunteer scheduling, and financial reporting, and by church members to view a filtered church directory and their own information. It is not a public-facing product open to signup — access is limited to individuals the church has authorized and issued their own login credentials, at whichever access level (staff or member) fits their role.</p>

<h2>What information the system holds</h2>
<ul>
<li>Member, visitor, and household records: names, contact information, addresses, and dates such as birthdays, baptism, confirmation, and anniversaries.</li>
<li>Giving and financial records: contributions, funds, batches, and (for authorized finance/admin staff) a consolidated view of the church's QuickBooks Online budget and account balance data, and the affiliated daycare program's financial summary.</li>
<li>Attendance, volunteer scheduling, and pastoral care/follow-up notes entered by staff.</li>
</ul>

<h2>How information is used</h2>
<p>Solely to administer the life of the congregation: tracking membership and giving, scheduling volunteers and services, and helping church leadership see an accurate financial picture. Information is never sold, and is not shared with third parties except the specific service providers necessary to operate the features above, each used only for that purpose:</p>
<ul>
<li><strong>Breeze ChMS</strong> — the church's primary membership database, kept in sync with this system.</li>
<li><strong>QuickBooks Online (Intuit)</strong> — read-only access to budget and account balance data, connected directly by an authorized administrator.</li>
<li><strong>The daycare program's own financial system</strong> — a read-only financial summary, if and when that connection is configured.</li>
<li><strong>Brevo and Resend</strong> — sending newsletter, birthday/anniversary, and administrative email/SMS on the church's behalf.</li>
</ul>

<h2>Access control</h2>
<p>Access requires an individual login and is restricted by role. Staff roles (general staff, finance, or administrator) see the data each role needs to do its work, with financial data specifically restricted to finance and administrator roles. Member accounts see a filtered, read-only view of the church directory and can edit only their own contact information — they cannot see giving, financial, or pastoral care/follow-up data.</p>

<h2>Data retention</h2>
<p>Records are retained as needed for ongoing church administration. Some internal log records are automatically purged after a defined retention period as a matter of routine housekeeping.</p>

<h2>Questions</h2>
<p>Contact the church office at <a href="mailto:office@timothystl.org">office@timothystl.org</a> with any questions about this policy or your information.</p>

<div class="foot">This page describes Connect's actual data practices in plain language and is not a substitute for review by legal counsel.</div>
</div></body></html>`;

export const TERMS_HTML = `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>Terms of Use — Connect</title></head><body><div class="wrap">
<h1>Terms of Use</h1>
<div class="updated">Connect — Timothy Lutheran Church Management System &middot; Last updated 2026-07-22</div>

<p>Connect is provided by Timothy Lutheran Church solely for use by staff, volunteers, and members who have been granted login credentials by the church, at whichever access level (staff or member) fits their role. It is not available to, and is not intended for use by, the general public — there is no self-signup.</p>

<h2>Authorized use</h2>
<ul>
<li>Access is limited to individuals explicitly authorized by the church and issued their own login, whether staff-level or member-level.</li>
<li>Login credentials are personal and must not be shared. Each user is responsible for activity under their own account.</li>
<li>The system is to be used only for legitimate purposes — church administration for staff accounts, and viewing the directory and one's own information for member accounts — as described in the <a href="/privacy">Privacy Policy</a>.</li>
</ul>

<h2>No warranty</h2>
<p>The system is provided "as is," for internal church use, without warranty of any kind. The church may modify, suspend, or discontinue any part of it at any time.</p>

<h2>Third-party connections</h2>
<p>Where the system connects to a third-party service on the church's behalf (for example, QuickBooks Online), that connection is established and can be revoked at any time by an authorized administrator from within the system.</p>

<h2>Questions</h2>
<p>Contact the church office at <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p>

<div class="foot">This page is written in plain language for an internal tool and is not a substitute for review by legal counsel.</div>
</div></body></html>`;
