// ── DATABASE SCHEMA + INITIALIZATION ──────────────────────────────────────────
import { defaultFundCategories } from './api-utils.js';

export const DB_INIT = [
  `CREATE TABLE IF NOT EXISTS serve_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_time_slots INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    slots INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    role_date TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    lead TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    role_id INTEGER,
    ministry TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT '[]',
    service TEXT NOT NULL DEFAULT '',
    sundays TEXT NOT NULL DEFAULT '[]',
    shirt_wanted INTEGER NOT NULL DEFAULT 0,
    shirt_size TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    person_id INTEGER DEFAULT NULL,
    contacted_at TEXT NOT NULL DEFAULT '',
    contact_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS signup_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signup_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scheduler_data (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // ── ChMS tables ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS households (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL DEFAULT '',
    address1   TEXT    NOT NULL DEFAULT '',
    address2   TEXT    NOT NULL DEFAULT '',
    city       TEXT    NOT NULL DEFAULT '',
    state      TEXT    NOT NULL DEFAULT 'MO',
    zip        TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS people (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name        TEXT    NOT NULL DEFAULT '',
    last_name         TEXT    NOT NULL DEFAULT '',
    email             TEXT    NOT NULL DEFAULT '',
    phone             TEXT    NOT NULL DEFAULT '',
    address1          TEXT    NOT NULL DEFAULT '',
    address2          TEXT    NOT NULL DEFAULT '',
    city              TEXT    NOT NULL DEFAULT '',
    state             TEXT    NOT NULL DEFAULT 'MO',
    zip               TEXT    NOT NULL DEFAULT '',
    member_type       TEXT    NOT NULL DEFAULT 'visitor',
    dob               TEXT    NOT NULL DEFAULT '',
    baptism_date      TEXT    NOT NULL DEFAULT '',
    confirmation_date TEXT    NOT NULL DEFAULT '',
    anniversary_date  TEXT    NOT NULL DEFAULT '',
    household_id      INTEGER,
    family_role       TEXT    NOT NULL DEFAULT '',
    photo_url         TEXT    NOT NULL DEFAULT '',
    notes             TEXT    NOT NULL DEFAULT '',
    breeze_id         TEXT    NOT NULL DEFAULT '',
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#5C8FA8',
    description TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS person_tags (
    person_id INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL,
    PRIMARY KEY (person_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS funds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS giving_batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_date  TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    closed      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS giving_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id     INTEGER NOT NULL,
    person_id    INTEGER,
    fund_id      INTEGER NOT NULL,
    amount       INTEGER NOT NULL DEFAULT 0,
    method       TEXT    NOT NULL DEFAULT 'cash',
    check_number TEXT    NOT NULL DEFAULT '',
    notes        TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  // Native giving system, Phase 1: deposit-centered reconciliation (migration 0031).
  `CREATE TABLE IF NOT EXISTS giving_deposits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    deposit_date  TEXT    NOT NULL DEFAULT '',
    source        TEXT    NOT NULL DEFAULT '',
    processor     TEXT    NOT NULL DEFAULT '',
    external_ref  TEXT    NOT NULL DEFAULT '',
    bank_cents    INTEGER,
    status        TEXT    NOT NULL DEFAULT 'open',
    reconciled_at TEXT,
    reconciled_by TEXT    NOT NULL DEFAULT '',
    notes         TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deposits_status ON giving_deposits(status, deposit_date)`,
  // Batch ↔ deposit join with an amount (migration 0032). A batch can be split across several
  // deposits and a deposit can hold several batches, so the link needs its own row + amount.
  `CREATE TABLE IF NOT EXISTS giving_deposit_lines (
    deposit_id   INTEGER NOT NULL,
    batch_id     INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (deposit_id, batch_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deposit_lines_batch ON giving_deposit_lines(batch_id)`,
  // NOTE: the giving_entries ALTER COLUMN statements + idx_entries_deposit for the deposit
  // system live in the `migrations` array below (they are NOT idempotent — an ALTER ADD COLUMN
  // that has already run throws "duplicate column name", which the migrations loop catches but
  // DB_INIT does not).
  `CREATE INDEX IF NOT EXISTS idx_people_household ON people(household_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_people_breeze ON people(breeze_id) WHERE breeze_id != ''`,
  `CREATE INDEX IF NOT EXISTS idx_people_name ON people(last_name, first_name)`,
  `CREATE INDEX IF NOT EXISTS idx_person_tags_person ON person_tags(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_giving_batch ON giving_entries(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_giving_person ON giving_entries(person_id)`,
  `CREATE TABLE IF NOT EXISTS worship_services (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    service_date  TEXT    NOT NULL DEFAULT '',
    service_time  TEXT    NOT NULL DEFAULT '',
    service_name  TEXT    NOT NULL DEFAULT '',
    service_type  TEXT    NOT NULL DEFAULT 'sunday',
    attendance    INTEGER NOT NULL DEFAULT 0,
    communion     INTEGER NOT NULL DEFAULT 0,
    notes         TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ws_date ON worship_services(service_date)`,
  `CREATE TABLE IF NOT EXISTS chms_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS church_register (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT    NOT NULL DEFAULT '',
    event_date TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL DEFAULT '',
    name2      TEXT    NOT NULL DEFAULT '',
    officiant  TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    person_id  INTEGER,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_register_type ON church_register(type, event_date)`,
  // Pastoral follow-up queue
  `CREATE TABLE IF NOT EXISTS follow_up_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER,
    type            TEXT    NOT NULL DEFAULT 'general',
    notes           TEXT    NOT NULL DEFAULT '',
    due_date        TEXT    NOT NULL DEFAULT '',
    completed       INTEGER NOT NULL DEFAULT 0,
    completed_at    TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    requester_name  TEXT    NOT NULL DEFAULT '',
    requester_email TEXT    NOT NULL DEFAULT '',
    requester_phone TEXT    NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_followup_person ON follow_up_items(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_followup_open ON follow_up_items(completed, created_at)`,
  // Audit log for undo/history
  `CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL DEFAULT (datetime('now')),
    action      TEXT    NOT NULL DEFAULT '',
    entity_type TEXT    NOT NULL DEFAULT '',
    entity_id   INTEGER,
    person_name TEXT    NOT NULL DEFAULT '',
    field       TEXT    NOT NULL DEFAULT '',
    old_value   TEXT    NOT NULL DEFAULT '',
    new_value   TEXT    NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)`,
  // App users — named login accounts with roles
  `CREATE TABLE IF NOT EXISTS app_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    display_name  TEXT    NOT NULL DEFAULT '',
    role          TEXT    NOT NULL DEFAULT 'staff',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT    NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)`,
  // H1: Organizations — external bodies, businesses, nonprofits, etc.
  `CREATE TABLE IF NOT EXISTS organizations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL DEFAULT '',
    type         TEXT    NOT NULL DEFAULT '',
    contact_name TEXT    NOT NULL DEFAULT '',
    phone        TEXT    NOT NULL DEFAULT '',
    email        TEXT    NOT NULL DEFAULT '',
    website      TEXT    NOT NULL DEFAULT '',
    address1     TEXT    NOT NULL DEFAULT '',
    address2     TEXT    NOT NULL DEFAULT '',
    city         TEXT    NOT NULL DEFAULT '',
    state        TEXT    NOT NULL DEFAULT 'MO',
    zip          TEXT    NOT NULL DEFAULT '',
    notes        TEXT    NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name)`,
  // Engagement task checklist — weekly recurring items the user can check off and customize
  `CREATE TABLE IF NOT EXISTS engagement_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL DEFAULT '',
    link_url     TEXT    NOT NULL DEFAULT '',
    week_key     TEXT    NOT NULL DEFAULT '',
    completed    INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT    NOT NULL DEFAULT '',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engagement_tasks_week ON engagement_tasks(week_key)`,
  // Prayer requests (FU1) — from website form, paper card entry, or staff input
  `CREATE TABLE IF NOT EXISTS prayer_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER,
    requester_name  TEXT    NOT NULL DEFAULT '',
    requester_email TEXT    NOT NULL DEFAULT '',
    request_text    TEXT    NOT NULL DEFAULT '',
    source          TEXT    NOT NULL DEFAULT 'manual',
    status          TEXT    NOT NULL DEFAULT 'open',
    resolution_note TEXT    NOT NULL DEFAULT '',
    submitted_at    TEXT    NOT NULL DEFAULT (date('now')),
    resolved_at     TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prayer_requests_status ON prayer_requests(status, submitted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_prayer_requests_person ON prayer_requests(person_id)`,
  // Member portal: one-time invite/verification tokens
  `CREATE TABLE IF NOT EXISTS member_invite_tokens (
    token       TEXT    PRIMARY KEY,
    people_id   INTEGER NOT NULL REFERENCES people(id),
    email       TEXT    NOT NULL DEFAULT '',
    expires_at  INTEGER NOT NULL DEFAULT 0,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_tokens_people ON member_invite_tokens(people_id)`,
  // Volunteer outreach email templates
  `CREATE TABLE IF NOT EXISTS volunteer_email_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '',
    ministry   TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Ministry Roles: standing volunteer roles per ministry page
  `CREATE TABLE IF NOT EXISTS ministry_roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ministry    TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    commitment  TEXT    NOT NULL DEFAULT '',
    training    TEXT    NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`
];



// ── CHRISTMAS MARKET ROLES (shared by seed + migration) ──────────────
export const XMAS_MARKET_ROLES = [
  // ── Friday Dec 4 — Setup Day ─────────────────────────────────────────
  { name: 'Move stuff out of storage room', description: 'Bring items from basement storage room up to kitchen or over to parking lot as instructed.', slots: 4,  role_date: '2026-12-04', start_time: '9:00 AM',  end_time: '11:00 AM' },
  { name: 'Set up tents',                   description: 'Teams of 6 unload tents, spread and raise them, then attach sides and weigh down with sandbags.',         slots: 18, role_date: '2026-12-04', start_time: '9:00 AM',  end_time: '11:00 AM' },
  { name: 'Help Rick run power cords',       description: 'Run power cords down rows of tents or as otherwise directed by Rick.',                                    slots: 1,  role_date: '2026-12-04', start_time: '11:00 AM', end_time: '12:00 PM' },
  { name: 'Move Glasses',                    description: 'Bring glassware up from basement and over to parking lot using little wagons.',                            slots: 2,  role_date: '2026-12-04', start_time: '11:00 AM', end_time: '12:00 PM' },
  { name: 'Set up Tables and Chairs',        description: 'Put tables in front of all tents, stage biergarten tables and chairs out of way. Actual time depends on delivery.', slots: 6, role_date: '2026-12-04', start_time: '11:00 AM', end_time: '12:00 PM' },
  { name: 'Want free lunch?',                description: "Please let us know if you'll be joining us for lunch during setup day. Fried chicken and misc sides.",    slots: 30, role_date: '2026-12-04', start_time: '12:00 PM', end_time: '1:00 PM'  },
  { name: 'Help Rick install lights',        description: 'Attach strings of lights to tents.',                                                                        slots: 1,  role_date: '2026-12-04', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Pick up Meat',                    description: 'Go with Marla to G&W to pick up the meats.',                                                                slots: 1,  role_date: '2026-12-04', start_time: '1:00 PM',  end_time: '2:00 PM'  },
  { name: 'Potato Salad Prep',               description: 'Prep ingredients for German potato salad.',                                                                 slots: 2,  role_date: '2026-12-04', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Set up Payment System',           description: 'Configure payment terminals and cash boxes for the market.',                                                 slots: 2,  role_date: '2026-12-04', start_time: '1:00 PM',  end_time: '2:00 PM'  },
  { name: 'Signs',                           description: 'Post booth numbers and general signage around the market area.',                                             slots: 2,  role_date: '2026-12-04', start_time: '1:00 PM',  end_time: '2:00 PM'  },
  { name: 'Propane Heaters',                 description: 'Set up and test propane heaters for the tents.',                                                             slots: 1,  role_date: '2026-12-04', start_time: '3:00 PM',  end_time: '4:00 PM'  },
  // ── Saturday Dec 5 — Market Day ─────────────────────────────────────
  { name: 'Load-In Traffic Control',         description: 'Direct vendor vehicles during load-in.',                                                                    slots: 2,  role_date: '2026-12-05', start_time: '7:30 AM',  end_time: '11:00 AM' },
  { name: 'Vendor Directions',               description: 'Help vendors find their assigned booth locations.',                                                          slots: 2,  role_date: '2026-12-05', start_time: '7:30 AM',  end_time: '11:00 AM' },
  { name: 'German Potato Salad Makers',      description: 'Sauce made in advance. Heat ingredients, mix, scoop into dishes for sale, then transport to parking lot.',  slots: 2,  role_date: '2026-12-05', start_time: '9:00 AM',  end_time: '11:00 AM' },
  { name: 'Kitchen',                         description: 'Prepare gluhwein base, other food prep and cleaning.',                                                       slots: 3,  role_date: '2026-12-05', start_time: '9:00 AM',  end_time: '11:00 AM' },
  { name: 'Grill Setup',                     description: 'Set up and light grills for brats and franks.',                                                              slots: 3,  role_date: '2026-12-05', start_time: '10:00 AM', end_time: '11:00 AM' },
  { name: 'Hot Drinks Setup',                description: 'Set up hot drinks station. Must be 21+. Transport water jugs, heat hot chocolate, mix cider, handle Gluhwein.', slots: 3, role_date: '2026-12-05', start_time: '10:00 AM', end_time: '11:00 AM' },
  { name: 'Go-Fer',                          description: 'Have a vehicle and be available on-call. Must be over 21.',                                                  slots: 1,  role_date: '2026-12-05', start_time: '10:00 AM', end_time: '12:00 PM' },
  { name: 'Cashiers',                        description: 'Handle sales of food and beverage. Must be approved by committee — please talk to a committee member before signing up.', slots: 2, role_date: '2026-12-05', start_time: '10:30 AM', end_time: '12:30 PM' },
  { name: 'German Potato Salad Makers',      description: 'Heat ingredients, mix, scoop into dishes for sale, then transport to parking lot.',                          slots: 2,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Greeters',                        description: 'Welcome people to Timothy and the Markt. Explain how to buy food and beverage, tell them about the congregation.', slots: 2, role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM' },
  { name: 'Grill Brats and Franks',          description: 'Grill brats and franks for hungry market guests.',                                                           slots: 3,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Hot Drinks',                      description: 'Monitor & refill hot chocolate, cider, and Gluhwein. At least one person per shift must be 21+.',            slots: 4,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Kitchen',                         description: 'Food prep, cooking, and cleaning.',                                                                          slots: 3,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Sales Assistant',                 description: 'Replenish glassware and assist cashiers. Breakdown boxes and take to dumpster at end of shift.',             slots: 2,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Trash',                           description: 'Monitor trash cans; when full take trash to dumpster and replace bag.',                                      slots: 1,  role_date: '2026-12-05', start_time: '11:00 AM', end_time: '1:00 PM'  },
  { name: 'Go-Fer',                          description: 'Have a vehicle and be available on-call. Must be over 21.',                                                  slots: 1,  role_date: '2026-12-05', start_time: '12:00 PM', end_time: '2:00 PM'  },
  { name: 'Music',                           description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 1,  role_date: '2026-12-05', start_time: '12:00 PM', end_time: '12:15 PM' },
  { name: 'Music',                           description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 3,  role_date: '2026-12-05', start_time: '12:15 PM', end_time: '12:45 PM' },
  { name: 'Cashiers',                        description: 'Handle sales of food and beverage. Must be approved by committee.',                                          slots: 2,  role_date: '2026-12-05', start_time: '12:30 PM', end_time: '2:30 PM'  },
  { name: 'German Potato Salad Makers',      description: 'Heat ingredients, mix, scoop into dishes for sale, then transport to parking lot.',                          slots: 2,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Greeters',                        description: 'Welcome people to Timothy and the Markt.',                                                                   slots: 2,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Grill Brats and Franks',          description: 'Grill brats and franks for hungry market guests.',                                                           slots: 3,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Hot Drinks',                      description: 'Monitor & refill. At least one person per shift must be 21+.',                                               slots: 3,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Kitchen',                         description: 'Food prep, cooking, and cleaning.',                                                                          slots: 3,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Music',                           description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 1,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '2:00 PM'  },
  { name: 'Music Ensemble',                  description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 1,  role_date: '2026-12-05', start_time: '1:30 PM',  end_time: '2:00 PM'  },
  { name: 'Sales Assistant',                 description: 'Replenish glassware and assist cashiers.',                                                                   slots: 2,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Trash',                           description: 'Monitor trash cans; when full take to dumpster.',                                                            slots: 1,  role_date: '2026-12-05', start_time: '1:00 PM',  end_time: '3:00 PM'  },
  { name: 'Go-Fer',                          description: 'Have a vehicle and be available on-call. Must be over 21.',                                                  slots: 1,  role_date: '2026-12-05', start_time: '2:00 PM',  end_time: '4:00 PM'  },
  { name: 'Music Ensembles',                 description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 1,  role_date: '2026-12-05', start_time: '2:00 PM',  end_time: '3:00 PM'  },
  { name: 'Cashiers',                        description: 'Handle sales of food and beverage. Must be approved by committee.',                                          slots: 2,  role_date: '2026-12-05', start_time: '2:30 PM',  end_time: '4:30 PM'  },
  { name: 'German Potato Salad Makers',      description: 'Heat ingredients, mix, scoop into dishes for sale.',                                                         slots: 2,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Greeters',                        description: 'Welcome people to Timothy and the Markt.',                                                                   slots: 2,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Grill Brats and Franks',          description: 'Grill brats and franks.',                                                                                    slots: 3,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Hot Drinks',                      description: 'Monitor & refill. At least one person per shift must be 21+.',                                               slots: 3,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Kitchen',                         description: 'Food prep, cooking, and cleaning.',                                                                          slots: 3,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Knockdown Boxes',                 description: 'Knockdown boxes and put in recycling dumpster.',                                                             slots: 2,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: "Music \u2014 Children's Choir & Chimers", description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                    slots: 8,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '4:00 PM'  },
  { name: 'Sales Assistant',                 description: 'Replenish glassware and assist cashiers.',                                                                   slots: 2,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Trash',                           description: 'Monitor trash cans; when full take to dumpster.',                                                            slots: 1,  role_date: '2026-12-05', start_time: '3:00 PM',  end_time: '5:00 PM'  },
  { name: 'Go-Fer',                          description: 'Have a vehicle and be available on-call. Must be over 21.',                                                  slots: 1,  role_date: '2026-12-05', start_time: '4:00 PM',  end_time: '6:00 PM'  },
  { name: 'Music Ensembles',                 description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 1,  role_date: '2026-12-05', start_time: '4:00 PM',  end_time: '5:00 PM'  },
  { name: 'Cashiers',                        description: 'Handle sales of food and beverage. Must be approved by committee.',                                          slots: 2,  role_date: '2026-12-05', start_time: '4:30 PM',  end_time: '6:30 PM'  },
  { name: 'Greeters',                        description: 'Welcome people to Timothy and the Markt.',                                                                   slots: 2,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '6:00 PM'  },
  { name: 'Grill Brats and Franks',          description: 'Grilling likely wraps up soon after 5 — this is mostly a cleanup shift.',                                   slots: 3,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '7:00 PM'  },
  { name: 'Hot Drinks',                      description: 'Serving ends at 6, then cleanup. At least one person per shift must be 21+.',                                slots: 3,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '6:30 PM'  },
  { name: 'Kitchen Cleanup',                 description: 'Clean kitchen after market day.',                                                                            slots: 3,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '7:00 PM'  },
  { name: 'Knockdown Boxes',                 description: 'Knockdown boxes and put in recycling dumpster.',                                                             slots: 2,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '7:00 PM'  },
  { name: 'Music',                           description: 'Ensembles, vocal or instrumental. Contact jinah@timothystl.org.',                                            slots: 2,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '6:00 PM'  },
  { name: 'Trash',                           description: 'Monitor trash cans; when full take to dumpster.',                                                            slots: 1,  role_date: '2026-12-05', start_time: '5:00 PM',  end_time: '6:00 PM'  },
  { name: 'Debris Pickup',                   description: 'Collect trash cans and pick up debris from market area.',                                                    slots: 2,  role_date: '2026-12-05', start_time: '6:00 PM',  end_time: '7:00 PM'  },
  { name: 'Misc Labor',                      description: 'Carry stuff and do as instructed — general cleanup help.',                                                   slots: 4,  role_date: '2026-12-05', start_time: '6:00 PM',  end_time: '7:00 PM'  },
  { name: 'Power and Light Teardown',        description: 'Remove zip ties and wind up lights and cords.',                                                              slots: 2,  role_date: '2026-12-05', start_time: '6:00 PM',  end_time: '7:00 PM'  },
  { name: 'Tear Down Tables and Chairs',     description: 'Stack on rental carts and cover with tarps.',                                                                slots: 6,  role_date: '2026-12-05', start_time: '6:00 PM',  end_time: '7:00 PM'  },
  { name: 'Tent Teardown',                   description: 'Collapse tents in teams of 6 and put in shipping container.',                                                slots: 12, role_date: '2026-12-05', start_time: '6:30 PM',  end_time: '7:30 PM'  },
];

// ── MIGRATE CHRISTMAS MARKET ROLES (idempotent) ───────────────────────
// Runs on every cold start. If the Christmas Market event has fewer than
// 20 roles it means it was seeded with the old simple role list — replace
// it with the full time-slotted schedule.  Uses the same XMAS_ROLES list
// from seedEvents so sort_order indices always align.
async function migrateChristmasMarketRoles(db) {
  const ev = await db.prepare("SELECT id FROM serve_events WHERE name='Christmas Market'").first();
  if (!ev) return;
  const count = await db.prepare('SELECT COUNT(*) as n FROM serve_roles WHERE event_id=?').bind(ev.id).first();
  if (count && count.n >= 20) {
    // Roles exist — check if start_time needs populating
    const needsFix = await db.prepare('SELECT COUNT(*) as n FROM serve_roles WHERE event_id=? AND (start_time="" OR start_time IS NULL)').bind(ev.id).first();
    if (needsFix && needsFix.n > 0) {
      // UPDATE in place so existing signups are preserved.
      // Fetch actual roles ordered by sort_order,id and update positionally.
      // Only fill in roles that still have empty times to preserve user edits.
      const dbRoles = await db.prepare('SELECT id FROM serve_roles WHERE event_id=? ORDER BY sort_order,id').bind(ev.id).all();
      const rows = dbRoles.results || [];
      for (let i = 0; i < rows.length && i < XMAS_MARKET_ROLES.length; i++) {
        const r = XMAS_MARKET_ROLES[i];
        await db.prepare('UPDATE serve_roles SET role_date=?, start_time=?, end_time=?, sort_order=? WHERE id=? AND (start_time="" OR start_time IS NULL)')
          .bind(r.role_date||'', r.start_time||'', r.end_time||'', i, rows[i].id).run();
      }
    }
    return;
  }

  // Wipe old roles (no signups yet, so signup_slots is also empty for this event)
  await db.prepare('DELETE FROM signup_slots WHERE role_id IN (SELECT id FROM serve_roles WHERE event_id=?)').bind(ev.id).run();
  await db.prepare('DELETE FROM serve_roles WHERE event_id=?').bind(ev.id).run();

  for (let i = 0; i < XMAS_MARKET_ROLES.length; i++) {
    const r = XMAS_MARKET_ROLES[i];
    await db.prepare(
      'INSERT INTO serve_roles (event_id,name,description,slots,sort_order,role_date,start_time,end_time) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(ev.id, r.name, r.description, r.slots||0, i, r.role_date||'', r.start_time||'', r.end_time||'').run();
  }
}

// ── SEED DEFAULT EVENTS ───────────────────────────────────────────────
async function seedEvents(db) {
  const existing = await db.prepare('SELECT COUNT(*) as n FROM serve_events').first();
  if (existing && existing.n > 0) return;

  const SEED = [
    {
      name: 'Easter Egg Hunt',
      description: 'A neighborhood tradition — families, eggs, and a lot of happy kids. Many hands make it happen.',
      event_date: '2026-04-04', sort_order: 1,
      roles: [
        { name: 'Set-Up', description: 'Arrange the grounds, tables, and stations before families arrive. Early morning crew.' },
        { name: 'Games', description: 'Run activity games for kids while the hunt is in progress. High energy, high fun.' },
        { name: 'Check-In', description: 'Register families and hand out baskets as they arrive. The first friendly face of the morning.' },
        { name: 'Crafts', description: 'Lead or assist with craft activities for kids. Supplies provided; creativity welcome.' },
        { name: 'Easter Photo Op', description: 'Help set up and run the photo station so families can capture a fun Easter memory.' },
        { name: 'Face Painting', description: 'Bring joy to kids\' faces — literally. Experience helpful but not required.' },
        { name: 'Bubble Boss', description: 'Run the bubble station and keep the fun floating. Kids of all ages love this one.' },
        { name: 'Egg Zone', description: 'Help manage and monitor the egg hunting area — keep it fair, fun, and safe for all age groups.' },
        { name: 'Clean-Up', description: 'Help restore the grounds after the event wraps. Shouldn\'t take long with many hands.' },
        { name: 'Planning & Leadership', description: 'Help plan and coordinate the event in the weeks leading up to it. Great if you love organizing.' },
        { name: 'Easter Bunny / Carrot', description: 'Put on a costume and make the day magical for the kids. Details shared by the coordinator.' },
        { name: 'Other', description: 'Not sure where you fit? Sign up and the event coordinator will find the perfect spot for you.' },
      ]
    },
    {
      name: 'Vacation Bible School',
      description: 'Five evenings of Bible stories, crafts, music, and snacks. Kids love it — and leaders do too.',
      event_date: '2026-06-01', sort_order: 2,
      roles: [
        { name: 'Group Leader', description: 'Lead a crew of kids through the week\'s stations. Training provided.' },
        { name: 'Station Helper', description: 'Assist at a specific station — Bible story, games, crafts, or music. Great if you can only commit to part of the week.' },
        { name: 'Crafts Coordinator', description: 'Plan and prep the daily craft projects. Gather supplies and run the craft station each evening.' },
        { name: 'Snacks', description: 'Provide or prepare themed snacks each day. A small thing that makes a big impression on hungry little people.' },
        { name: 'Meal Prep', description: 'Help prepare and serve a simple evening meal for kids and volunteers each night. A great way to serve behind the scenes and keep everyone fueled.' },
        { name: 'General Help', description: 'Not sure where you fit? Sign up as general help and we\'ll put you where you\'re needed most — whether that\'s setup, teardown, running supplies, or filling in wherever hands are short.' },
      ]
    },
    {
      name: 'Christmas Market',
      description: 'A beloved community market with food, drinks, music, and holiday cheer. Two-day event — setup Friday, market Saturday.',
      event_date: '2026-12-04', sort_order: 3,
      roles: XMAS_MARKET_ROLES
    },
  ];



  for (const ev of SEED) {
    const r = await db.prepare(
      'INSERT INTO serve_events (name,description,event_date,sort_order) VALUES (?,?,?,?)'
    ).bind(ev.name, ev.description, ev.event_date, ev.sort_order).run();
    const evId = r.meta?.last_row_id;
    for (let i = 0; i < ev.roles.length; i++) {
      const role = ev.roles[i];
      await db.prepare(
        'INSERT INTO serve_roles (event_id,name,description,slots,sort_order,role_date,start_time,end_time) VALUES (?,?,?,?,?,?,?,?)'
      ).bind(evId, role.name, role.description, role.slots||0, i,
             role.role_date||'', role.start_time||'', role.end_time||'').run();
    }
  }
}


// One-time backfill for funds.category (migration 0033). Marker-gated, not idempotent-by-value:
// once an admin has sorted funds into categories in Settings → Fund categories, re-running this
// on every cold start would drag the General Fund family back out of wherever they put it.
export async function backfillFundCategories(db) {
  try {
    const marker = await db.prepare("SELECT value FROM chms_config WHERE key='fund_categories_backfilled'").first();
    if (marker) return;
    const funds = (await db.prepare('SELECT id, name FROM funds').all()).results || [];
    const defaults = defaultFundCategories(funds);
    const stmts = [];
    for (const [id, cat] of defaults) {
      stmts.push(db.prepare('UPDATE funds SET category=? WHERE id=?').bind(cat, id));
    }
    stmts.push(db.prepare(
      "INSERT INTO chms_config (key,value) VALUES ('fund_categories_backfilled','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ));
    await db.batch(stmts);
  } catch {}
}

export async function seedChmsDefaults(db) {
  try {
    const existing = await db.prepare('SELECT COUNT(*) as n FROM funds').first();
    if (existing?.n > 0) return;
    const defaults = [
      ['General Fund', 'Weekly offering and general church operations', 1, 10],
      ['Building Fund', 'Capital improvements and building maintenance', 1, 20],
      ['Missions',      'Local and international mission support', 1, 30],
    ];
    for (const [name, desc, active, sort] of defaults) {
      await db.prepare('INSERT INTO funds (name,description,active,sort_order) VALUES (?,?,?,?)').bind(name,desc,active,sort).run();
    }
  } catch {}
}

// ── SEED MINISTRY ROLES FROM STATIC PAGE CONTENT ──────────────────────
// The VUX5 redesign added the ministry_roles table + admin CRUD, but the roles that were
// already hardcoded into each public ministry page's HTML (src/public/ministries/*.js) were
// never migrated into it. This backfills them. Guarded per role (ministry+name) rather than
// a single "table is empty" check, so it still runs even after an admin has already added or
// edited unrelated roles by hand.
export const MINISTRY_ROLES_SEED = [
  { ministry: 'worship', name: 'Acolyte', description: 'Light the altar candles before the service begins and extinguish them at the close. A simple, meaningful act of service for all ages.', commitment: '1 Sunday per month', training: '15-minute walk-through' },
  { ministry: 'worship', name: 'PowerPoint Operator', description: 'Advance worship slides so the congregation can follow along with hymns, liturgy, and announcements. No tech expertise required.', commitment: '1 Sunday per month', training: '30-min practice with worship team' },
  { ministry: 'worship', name: 'Lector', description: 'Read the appointed Scripture lessons aloud from the lectern. Readings are emailed to you in advance so you can prepare.', commitment: '1 Sunday per month', training: 'Meeting with the pastor' },
  { ministry: 'worship', name: 'Altar Guild', description: 'Prepare the sanctuary — flowers, altar linens, paraments, and banners for each liturgical season. A quiet ministry of beauty and care.', commitment: 'One month per year', training: 'Walk-through with coordinator' },
  { ministry: 'worship', name: 'Adult Choir', description: "Enhance worship through choral music. Sing anthems and lead the congregation in song throughout the church year. Open to all voices, all parts.", commitment: 'Weekly rehearsals + Sundays', training: '' },
  { ministry: 'worship', name: 'Handbells', description: "Ring with the handbell choir to add joyful, resonant music to worship. No prior handbell experience needed. Open to anyone who can count!", commitment: 'Weekly rehearsals (seasonal)', training: '' },
  { ministry: 'worship', name: 'Youth Choir', description: 'Young singers who lead worship and grow in faith through music. Open to children and youth of the congregation.', commitment: 'Weekly rehearsals + Sundays', training: '' },
  { ministry: 'education', name: 'Sunday School Teacher', description: "Lead a class through Bible stories and lessons each week. Curriculum provided; your heart for teaching matters most.", commitment: 'Weekly during the school year', training: 'Curriculum orientation provided' },
  { ministry: 'education', name: 'Youth Group Leader', description: "Walk alongside middle and high school students through discussion, activities, and faith-building events. Open to adults 21+.", commitment: 'Monthly + events', training: '' },
  { ministry: 'education', name: 'Confirmation Mentor', description: "Be paired with a confirmation student to meet, pray, and talk through what it means to affirm their faith. An investment that lasts a lifetime.", commitment: '1–2 years alongside a student', training: '' },
  { ministry: 'education', name: 'Vacation Bible School', description: "Help during VBS week — leading groups, running stations, or helping behind the scenes. One of the most energizing weeks of the year.", commitment: 'One week each summer', training: '' },
  { ministry: 'acceptance', name: 'Stephen Ministry', description: "Provide one-on-one Christian care to people experiencing grief, illness, loneliness, divorce, or job loss. Walk alongside someone through a difficult season.", commitment: 'Weekly meetings with a care receiver', training: 'Comprehensive Stephen Ministry training provided' },
  { ministry: 'acceptance', name: 'Hospitality / Coffee Hour', description: "Set up and serve refreshments after Sunday worship. A warm space for conversation and connection. Open to individuals, families, or small groups.", commitment: 'Occasional Sundays', training: '' },
  { ministry: 'acceptance', name: 'Caring Ministry', description: "Reach out to members who are homebound, recovering, or grieving. A friendly visit, a card, or a phone call can make a profound difference. Open to compassionate listeners.", commitment: 'As available; flexible', training: '' },
  { ministry: 'acceptance', name: 'Advent & Lent Midweek Dinner', description: "Help prepare and serve dinner before midweek worship services during Advent and Lent. A meaningful way to nourish both body and spirit in these seasons of reflection and preparation. Open to anyone who loves to cook or serve.", commitment: 'Selected Wednesday evenings in Advent & Lent', training: '' },
  { ministry: 'outreach', name: 'Community Pantry', description: "Help sort, stock, and distribute food and essentials to neighbors in need. A hands-on way to live out our faith in the community around us. Open to all ages (youth with adult).", commitment: 'Flexible volunteer shifts', training: '' },
  { ministry: 'outreach', name: 'Service Projects', description: "Participate in organized community service days, mission trips, and collaborative events with partner organizations. Open to individuals, families, youth.", commitment: 'Occasional events', training: '' },
  { ministry: 'outreach', name: 'Prayer Ministry', description: "Commit to praying regularly for congregation members, our community, and the world. Receive prayer requests and lift them up from anywhere. Open to all who feel called to pray.", commitment: 'Daily or weekly (self-directed)', training: '' },
  { ministry: 'outreach', name: 'Bee Ministry', description: "Join our Bee Ministry and help create handmade quilts, blankets, and items for those in need — a labor of love that stitches our community together. Open to all skill levels.", commitment: 'Regular meeting times (flexible)', training: '' },
  { ministry: 'outreach', name: 'Community Concerts', description: "Help bring our three annual community concerts to life. Opportunities include spreading the word through promotion, setting up and cleaning up the venue, and preparing hors d'oeuvres and refreshments for guests. Areas: Promotion, Setup/Cleanup, Hospitality & Refreshments.", commitment: 'Three concerts per year', training: '' },
  { ministry: 'outreach', name: 'Neighboring Life Events', description: "Help plan and host fellowship gatherings that connect our congregation with neighbors and build community beyond our walls. Part of our Neighboring Life Ministry, these events are rooted in hospitality and a spirit of welcome. Open to all who love building community.", commitment: 'Occasional events throughout the year', training: '' },
  // Transportation is a sub-category of Acceptance (Care Ministry), not its own top-level ministry.
  { ministry: 'acceptance', name: 'Regular Sunday Driver', description: "Give a member or neighbor a ride to Sunday worship on an ongoing basis. We'll match you with someone along your regular route.", commitment: 'Weekly or as scheduled', training: '' },
  { ministry: 'acceptance', name: 'Special-Occasion Driver', description: "Provide a one-time or occasional ride for Christmas Eve, Easter, a funeral, or another special service or event.", commitment: 'Occasional, as needed', training: '' },
  { ministry: 'acceptance', name: 'Ride Coordinator', description: "Help match volunteer drivers with riders who request a ride and keep the driving schedule organized. A behind-the-scenes way to keep this ministry running smoothly.", commitment: 'A few hours per month', training: '' },
];

async function seedMinistryRolesFromStatic(db) {
  for (let i = 0; i < MINISTRY_ROLES_SEED.length; i++) {
    const r = MINISTRY_ROLES_SEED[i];
    await db.prepare(
      `INSERT INTO ministry_roles (ministry,name,description,commitment,training,sort_order,active)
       SELECT ?,?,?,?,?,?,1
       WHERE NOT EXISTS (SELECT 1 FROM ministry_roles WHERE ministry=? AND name=?)`
    ).bind(r.ministry, r.name, r.description, r.commitment || '', r.training || '', i, r.ministry, r.name).run().catch(() => {});
  }
}


// Cache the init so it only runs once per Worker isolate (not on every request).
// Resets to null on error so the next request retries.
let _initPromise = null;
export function initDb(db) {
  if (!_initPromise) _initPromise = _doInitDb(db).catch(e => { _initPromise = null; throw e; });
  return _initPromise;
}

/**
 * Clears the per-isolate memo. Tests only — it's how a fresh Worker isolate hitting an
 * already-migrated database is simulated, which is the exact case the fingerprint fast path
 * exists for and the one that was costing ~7s per cold start in production.
 */
export function _resetInitForTests() { _initPromise = null; }

// Tuition Aid Planner: one-time seed of 2026-27 budgeted awards (Tuition_Awards_2026.xlsx)
// so the tab isn't empty on first load. Guarded by a NOT-EXISTS check on tuition_config —
// runs once per database. Rows are seeded with person_id/household_id left NULL; staff link
// each row to a real People record via the planner's person picker at their own pace.
const TUITION_SEED_K8 = [
  // family, child, base_grade, outsideAidDollars, timothyAwardDollars, familyOwedDollars, tuitionDollars
  ["Oschwald","Perrin","PK 4",0,0,8500,8500],
  ["Elington","Teddy","PK 4",0,0,8500,8500],
  ["Smithson","Garrett","K",0,4300,4200,8500],
  ["Oschwald","Jadon","1",0,4600,3900,8500],
  ["Oschwald","Liam","1",0,4600,3900,8500],
  ["Weigand","Rebecca","1",0,4300,4200,8500],
  ["Enderle","Charlotte","2",6000,2000,500,8500],
  ["Dinger","Daniel","3",6900,1600,0,8500],
  ["Smithson","Noel","3",0,4300,4200,8500],
  ["Dinger","Jacob","5",6900,1600,0,8500],
  ["Pozas","Hannah","5",1500,5500,1500,8500],
  ["Lee","Olivia","6",1500,6150,850,8500],
  ["Roden","Penny","6",0,4300,4200,8500],
  ["Gonzalez","Alaya","7",2000,5000,1500,8500],
  ["Poppitz","Emma","7",6000,2500,0,8500],
  ["Knapp","Edmund","8",1500,6150,850,8500],
  ["Dinger","John","8",6900,1600,0,8500],
  ["Jermiya","Malidaya","8",3500,4000,1000,8500],
  ["Poppitz","Olivia","8",6000,2500,0,8500],
  ["Farrow","Axel","1",0,2000,6500,8500],
];
const TUITION_SEED_LHS = [
  ["Scarlett","9"],["Michael","9"],["Ezra","10"],
  ["Edward","11"],["Sammy","11"],["Eva","11"],["Lilly","11"],
];
const TUITION_SEED_CONFIG = {
  base_school_year: '2026',
  school_year_label: '2026–27',
  as_of_note: 'Data as of budgeted awards, 26-27 term',
  tuition_base_cents: '850000',
  tuition_growth_pct: '6',
  k8_budget_cents: '7500000',
  lhs_standard_rate_cents: '120000',
  lhs_max_award_cents: '250000',
  timothy_min_award_cents: '200000',
  family_share_cap_pct: '50',
  default_pipeline_fam_pct: '50',
};
const TUITION_SEED_HISTORY = [
  ['2019-20',6200,30.5],['2020-21',6350,19.9],['2021-22',6575,19.0],['2022-23',6825,15.3],
  ['2023-24',7200,22.8],['2024-25',7560,19.4],['2025-26',8100,44.4],['2026-27',8500,30.3],
];
async function seedTuitionAid(db) {
  const already = await db.prepare(`SELECT 1 FROM tuition_config LIMIT 1`).first();
  if (already) return;
  for (const [key, value] of Object.entries(TUITION_SEED_CONFIG)) {
    await db.prepare(`INSERT INTO tuition_config (key,value) VALUES (?,?)`).bind(key, value).run();
  }
  let sort = 0;
  for (const [family, child, baseGrade, outsideAid, timothyAward, familyOwed, tuition] of TUITION_SEED_K8) {
    const famPct = tuition > 0 ? Math.round((1 - timothyAward / tuition) * 100) : 0;
    await db.prepare(
      `INSERT INTO tuition_students (family,child,is_pipeline,base_grade,outside_aid_cents,fam_pct,fam_pct_orig,
        timothy_award_exact_cents,family_owed_exact_cents,lhs_award_cents,lhs_award_orig_cents,attends_lhs,sort_order)
       VALUES (?,?,0,?,?,?,?,?,?,?,?,1,?)`
    ).bind(family, child, baseGrade, Math.round(outsideAid*100), famPct, famPct,
      Math.round(timothyAward*100), Math.round(familyOwed*100), 120000, 120000, sort++).run();
  }
  for (const [child, baseGrade] of TUITION_SEED_LHS) {
    await db.prepare(
      `INSERT INTO tuition_students (family,child,is_pipeline,base_grade,fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,sort_order)
       VALUES ('—',?,0,?,0,0,120000,120000,1,?)`
    ).bind(child, baseGrade, sort++).run();
  }
  await db.prepare(
    `INSERT INTO tuition_students (family,child,is_pipeline,birth_year,fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,sort_order)
     VALUES ('Knapp','Lawrence',1,2023,50,50,120000,120000,1,?)`
  ).bind(sort++).run();
  let hsort = 0;
  for (const [schoolYear, tuitionDollars, familyPct] of TUITION_SEED_HISTORY) {
    await db.prepare(
      `INSERT INTO tuition_history (school_year,tuition_cents,family_pct,sort_order) VALUES (?,?,?,?)`
    ).bind(schoolYear, Math.round(tuitionDollars*100), familyPct, hsort++).run();
  }
}

// Backfill tuition_year_rates from the known tuition_history figures (both are "the tuition
// rate for a school year" — reusing the existing seed gives past-year views a correct rate
// out of the box instead of an empty "no data" state). Idempotent (INSERT OR IGNORE) so it's
// safe to call on every cold start, not just once.
async function seedTuitionYearRates(db) {
  const rows = (await db.prepare(`SELECT school_year, tuition_cents FROM tuition_history`).all()).results || [];
  for (const r of rows) {
    await db.prepare(
      `INSERT OR IGNORE INTO tuition_year_rates (school_year, tuition_cents) VALUES (?,?)`
    ).bind(r.school_year, r.tuition_cents).run();
  }
}

// Genuine per-student, per-year family-payment history from the "Student Tuition History"
// sheet (added to the source workbook after the first pass only covered 2025-26). Values are
// dollars-paid-that-year (family_owed_cents), cross-referenced by the source workbook against
// original records — not editable via formula there, so treated as historical fact. The
// 2026-27 column is intentionally excluded: that's the current year, already represented by
// the tuition_students master row (offset-0 reads bypass the pin layer — see TAP6), so a pin
// for it would just be ignored. Cells marked '?' (unreconciled — Michael Hawkins 2024-25,
// Annette/Evelyn Crim) are excluded rather than guessed at.
// ACTIVE: matched by (family, child) against the currently-enrolled TUITION_SEED_K8 rows.
const TUITION_SEED_STUDENT_HISTORY_ACTIVE = [
  ['Dinger','Daniel',[['2023-24',100000],['2024-25',0],['2025-26',0]]],
  ['Dinger','Jacob',[['2021-22',60000],['2022-23',68000],['2023-24',100000],['2024-25',118000],['2025-26',160000]]],
  ['Dinger','John',[['2019-20',155000],['2020-21',87500],['2021-22',60000],['2022-23',68000],['2023-24',100000],['2024-25',118000],['2025-26',160000]]],
  ['Elington','Teddy',[['2025-26',860000]]],
  ['Enderle','Charlotte',[['2024-25',0],['2025-26',30000]]],
  ['Gonzalez','Alaya',[['2019-20',155000],['2020-21',117500],['2021-22',120000],['2022-23',175000],['2023-24',200000],['2024-25',218000],['2025-26',290000]]],
  ['Jermiya','Malidaya',[['2019-20',125000],['2020-21',87500],['2021-22',95000],['2022-23',68000],['2023-24',90000],['2024-25',156000],['2025-26',330000]]],
  ['Knapp','Edmund',[['2022-23',68000],['2023-24',90000],['2024-25',75600],['2025-26',81000]]],
  ['Lee','Olivia',[['2025-26',300000]]],
  ['Oschwald','Perrin',[['2025-26',860000]]],
  ['Oschwald','Jadon',[['2024-25',294840],['2025-26',370000]]],
  ['Oschwald','Liam',[['2024-25',294840],['2025-26',370000]]],
  ['Poppitz','Emma',[['2019-20',0],['2022-23',0],['2023-24',0],['2024-25',0],['2025-26',0]]],
  ['Poppitz','Olivia',[['2019-20',0],['2022-23',0],['2023-24',0],['2024-25',0],['2025-26',0]]],
  ['Pozas','Hannah',[['2021-22',127500],['2022-23',175000],['2023-24',230000],['2024-25',248000],['2025-26',400000]]],
  ['Roden','Penny',[['2025-26',400000]]],
  ['Smithson','Garrett',[['2025-26',860000]]],
  ['Smithson','Noel',[['2023-24',360000],['2024-25',378000],['2025-26',400000]]],
  ['Weigand','Rebecca',[['2025-26',400000]]],
];
// INACTIVE: no longer enrolled — no tuition_students row exists yet, so one is created here
// with active=0 (never appears in the live current/future roster) purely to anchor the pins,
// same pattern as the "+ Add Family Record" UI flow.
const TUITION_SEED_STUDENT_HISTORY_INACTIVE = [
  ['Flemming','LJ',[['2025-26',860000]]],
  ['Hawkins','John',[['2021-22',320000],['2022-23',340000],['2023-24',360000],['2024-25',378000],['2025-26',400000]]],
  ['Pyne','Bridget',[['2022-23',68000],['2023-24',90000],['2024-25',108000],['2025-26',120000]]],
];
async function seedStudentTuitionHistory(db) {
  for (const [family, child, entries] of TUITION_SEED_STUDENT_HISTORY_ACTIVE) {
    const s = await db.prepare(`SELECT id FROM tuition_students WHERE family=? AND child=?`).bind(family, child).first();
    if (!s) continue;
    for (const [schoolYear, cents] of entries) {
      await db.prepare(
        `INSERT OR IGNORE INTO tuition_student_years (student_id,school_year,family_owed_cents) VALUES (?,?,?)`
      ).bind(s.id, schoolYear, cents).run();
    }
  }
  for (const [family, child, entries] of TUITION_SEED_STUDENT_HISTORY_INACTIVE) {
    let s = await db.prepare(`SELECT id FROM tuition_students WHERE family=? AND child=?`).bind(family, child).first();
    if (!s) {
      const maxSort = await db.prepare(`SELECT COALESCE(MAX(sort_order),-1) as m FROM tuition_students`).first();
      const r = await db.prepare(
        `INSERT INTO tuition_students (family,child,is_pipeline,fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,active,sort_order)
         VALUES (?,?,0,50,50,120000,120000,1,0,?)`
      ).bind(family, child, (maxSort?.m ?? -1) + 1).run();
      s = { id: r.meta?.last_row_id };
    }
    for (const [schoolYear, cents] of entries) {
      await db.prepare(
        `INSERT OR IGNORE INTO tuition_student_years (student_id,school_year,family_owed_cents) VALUES (?,?,?)`
      ).bind(s.id, schoolYear, cents).run();
    }
  }
}

// FIN — 3277 Ivanhoe commercial property data, delivered 2026-07-20 as a structured export from
// AHRA's (property manager) monthly reports Dec 2023-May 2026, cross-checked against the
// user's already-verified analysis workbook. Dollar figures converted to integer cents here (the
// export itself uses dollars) per this app's Data Integrity convention. 2024-01/2024-02 are a
// known gap (not sent by AHRA / not found in the mailbox export) — intentionally absent, not
// zero. `null` fields (total_expenses for several 2026 months, net_operating_income/
// available_for_distribution/reserve_balance before the Jan 2026 MRI-format switch) reflect real
// gaps in what a given month's report format broke out, not missing extraction.
const FINANCE_PROPERTY_IVANHOE_MONTHLY = [
  ['2023-12', 0.893, 817676, 1547322, -729646, null, null, null, '2023-12 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-03', 0.893, 847450, 351860, 495590, null, null, null, '2024-03 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-04', 0.893, 946476, 318823, 627653, null, null, null, '2024-04 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-05', 0.893, 855320, 501098, 354222, null, null, null, '2024-05 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-06', 0.893, 843679, 290198, 553481, null, null, null, '2024-06 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-07', 0.893, 835610, 510125, 325485, null, null, null, '2024-07 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-08', 0.893, 766909, 225404, 541505, null, null, null, '2024-08 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-09', 0.893, 843382, 276435, 566947, null, null, null, '2024-09 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-10', 0.893, 847942, 405657, 442285, null, null, null, '2024-10 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-11', 0.893, 787743, 298577, 489166, null, null, null, '2024-11 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2024-12', 0.893, 914212, 1604136, -689924, null, null, null, '2024-12 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-01', 0.893, 806292, 356510, 449782, null, null, null, '2025-01 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-02', 0.893, 731000, 748483, -17483, null, null, null, '2025-02 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-03', 1.0, 847450, 351860, 495590, null, null, null, '2025-03 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-04', 1.0, 1100695, 471629, 629066, null, null, null, '2025-04 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-05', 1.0, 1037544, 624793, 412751, null, null, null, '2025-05 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-06', 1.0, 1047869, 298370, 749499, null, null, null, '2025-06 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-07', 1.0, 960017, 452290, 507727, null, null, null, '2025-07 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-08', 1.0, 932142, 1246913, -314771, null, null, null, '2025-08 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-09', 1.0, 964407, 1207963, -243556, null, null, null, '2025-09 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-10', 1.0, 1057918, 407087, 650831, null, null, null, '2025-10 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-11', 1.0, 1026584, 288207, 738377, null, null, null, '2025-11 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2025-12', 1.0, 1041355, 1463143, -421788, null, null, null, '2025-12 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2026-01', 1.0, 932721, null, 509994, 610165, null, 640000, '2026-01 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2026-02', 1.0, 1049520, null, 637333, 736514, 251528, 735000, '2026-02 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2026-03', 1.0, 859000, 576665, 282335, 381027, 411482, null, '2026-03 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2026-04', 1.0, 1318497, null, 975000, 1072700, 451066, 925000, '2026-04 - 3277 Ivanhoe Property Management Report.pdf'],
  ['2026-05', 0.8892, 927063, null, 448614, 545318, null, null, '2026-05 - 3277 Ivanhoe Property Management Report.pdf'],
];
const FINANCE_PROPERTY_IVANHOE_DISTRIBUTIONS = [
  ['2024-05', 700000],
  ['2024-07', 1100000],
  ['2024-11', 800000],
  ['2024-12', 800000],
  ['2025-05', 800000],
  ['2026-04', 400000],
];
// Board-facing notes per year — hand-written context that can't be derived from the monthly
// rows (kept alongside the recomputed revenue/expenses/net income/occupancy/distributions
// totals, not duplicating them, so there's one source of truth for the numbers themselves).
const FINANCE_PROPERTY_IVANHOE_ANNUAL_NOTES = {
  2023: 'Partial year (Dec only, per this data set); FYE 2023 statements available separately.',
  2024: 'Distributions: May ($7K), Jul ($11K), Nov ($8K), Dec ($8K). Bathroom/kitchen renovation and roofing delays throughout the year.',
  2025: '1st-floor apartment leased (reached 100% occupancy from Mar 2025 on); HVAC replacement; tuckpointing; mortgage payment increased late in year.',
  2026: 'New MRI reporting system; YTD through May. Most 2026 months report net_income directly without a separate expenses line in this dataset.',
};
const FINANCE_PROPERTY_IVANHOE_META = {
  property: {
    name: '3277 Ivanhoe',
    owner: 'Timothy Lutheran Church',
    type: 'Commercial rental property (mixed apartment units)',
    property_manager: 'AHRA (contacts: Christian Andrade, Lorenzo Andrade)',
    known_data_gaps: ['2024-01', '2024-02'],
    pre_ahra_history_note: "Records before AHRA's management are essentially nonexistent. A house was originally rolled into the same loan and later sold; there is also a parking lot associated with the property. This history is captured as a note rather than structured ledger data.",
  },
  valuation: {
    as_of_date: '2025-11-20',
    method: 'Income capitalization, 8% cap rate',
    source: '3277 Ivanhoe Valuation.xlsx, attached to AHRA’s Oct 2025 report email; figure verbally confirmed by AHRA (Christian/Lorenzo Andrade) 11/20/2025',
    gross_rental_income_cents: 11905585,
    total_operating_costs_incl_mgmt_fee_cents: 6415066,
    net_operating_income_cents: 5490519,
    cap_rate: 0.08,
    capitalized_value_cents: 68631486,
    // Real per-tenant rent roll + itemized operating costs from AHRA's actual valuation
    // worksheet (3277_Ivanhoe_Valuation_2.xlsx, delivered 2026-07-20) — reconciles exactly to
    // the summary figures above. Applied via seedIvanhoePropertyValuationV3().
    rent_roll: [
      { tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 },
      { tenant: 'Apartment 2', sqft: 1450, annual_rent_cents: 1499300 },
      { tenant: 'RJBJ - Crossfit', sqft: 3066, annual_rent_cents: 2759400 },
      { tenant: 'Magnatone', sqft: 7519, annual_rent_cents: 4082817 },
    ],
    utility_reimbursement_cents: 1626068,
    vacancy_rate_pct: 0,
    operating_costs: {
      utilities_cents: 1961363,
      trash_cents: 310668,
      maintenance_repairs_cents: 828700,
      landscaping_snow_cents: 400000,
      legal_cents: 0,
      taxes_cents: 1200000,
      insurance_cents: 1000000,
    },
    management_fee_pct: 0.06,
  },
  loan: {
    lender: 'LCEF',
    balance_cents: 27969113,
    balance_as_of_date: '2026-07-20',
    interest_rate_pct: 0.06375,
    confirmed_by: 'Andrew (pastor), 2026-07-20',
    note: 'Prior confirmed balance was $297,336 as of 2025-11-20; normal paydown since then brought it to $279,691.13. A separate conflicting figure of $92,322.68 appeared on the Mar 2026 MRI-format balance sheet — confirmed to be a data artifact from AHRA’s Appfolio-to-MRI migration and should still be disregarded. Equity/LTV below mix this newer loan balance with an older (2025-11-20) valuation, which is normal since valuations don’t update monthly.',
    monthly_payment_cents: 428303,
    monthly_payment_note: 'Increased per the Dec 2025 report.',
    annual_debt_service_cents: 4539636,
    balance_history: [
      { balance_cents: 29733600, as_of_date: '2025-11-20' },
      { balance_cents: 27969113, as_of_date: '2026-07-20', interest_rate_pct: 0.06375 },
    ],
  },
  annual_notes: FINANCE_PROPERTY_IVANHOE_ANNUAL_NOTES,
  capital_improvements: {
    projects_summary: [
      { project: '1st-floor apartment renovation (bathroom, kitchen, granite countertop)', started: '2023-12', completed: '2024-12', total_capitalized_cents: 1816075, note: 'Slow-moving project across 2024; contractor delays noted repeatedly in monthly reports.' },
      { project: 'HVAC system replacement (new heater)', started: '2025-10', completed: '2025-10', total_capitalized_cents: 778700, note: 'Martin Jetco Heating & Air Conditioning installed a new heater; capitalized rather than expensed given the scope.' },
      { project: 'Washer/dryer hookup installation, 1st floor apartment', started: '2025-11', completed: '2026-02', total_capitalized_cents: 800000, note: 'New amenity add (not a replacement). Paid in two $4,000 installments (deposit Dec 2025, balance Apr 2026); completion confirmed in the Feb 2026 report.' },
      { project: 'Tuckpointing (exterior masonry)', started: '2025-07', completed: '2025-08', total_capitalized_cents: 0, note: 'Expensed as repairs & maintenance ($1,350), not capitalized — a judgment call AHRA made; worth revisiting with your accountant if it materially extended the building’s life.' },
    ],
    separate_paint_asphalt_concrete_reserve_note: 'Starting with the Jan 2026 MRI-format reports, AHRA added a second, separate reserve line labeled "Capital Improvements — Estimated Cost of (Paint, Asphalt and Concrete)". As of the May 2026 report both the estimated cost and the reserve balance are $0.00 — the mechanism exists in the report template but has not yet been funded or given a target estimate. Worth asking AHRA whether/when they intend to start funding this, since exterior paint/asphalt/concrete work is a real, foreseeable capital need not otherwise reserved for.',
  },
  insurance: {
    source: 'GuideOne Insurance Company / Lutheran Trust, Inc. (agent: Kip Starnes) — ACORD Commercial Insurance Application, policy #147414150, effective 04/12/2025-2026, plus prior-year renewal comparison. Confirmed by Andrew (2026-07-20) that both the "Apartments" and "Lessors Risk Gym" TIV line items refer to 3277 Ivanhoe (the "Gym" label appears to be a legacy/mislabeled name in the agency’s tracking spreadsheet for the office/warehouse portion; the underlying policy classification is "Lessors Risk - Commercial Rental Building").',
    policy_structure_note: 'This is a single church-wide Commercial Package Policy (GuideOne, policy #147414150) covering three locations: Location #1 = 6704 Fyler Avenue (the church + daycare), Location #3 = 3275-3283 Ivanhoe Ave (3277 Ivanhoe — split into a "Commercial Office" building value and an "Apartments" building value, both part of the same physical structure), and Locations #901/#902 = two parking lots on Fyler Avenue. There is no separate bill for 3277 Ivanhoe — any cost attributed to it here is an allocation off the master policy, not an actual separate invoice.',
    insured_building_values: {
      as_of_expiring_2025: { church_6704_fyler_cents: 718422400, ivanhoe_commercial_office_warehouse_cents: 242175300, ivanhoe_apartments_cents: 76900000, ivanhoe_total_cents: 319075300, grand_total_cents: 1037497700 },
      as_of_renewal_2025_2026: { church_6704_fyler_cents: 775900000, ivanhoe_commercial_office_warehouse_cents: 261500000, ivanhoe_apartments_cents: 83100000, ivanhoe_total_cents: 344600000, grand_total_cents: 1120500000 },
      note: 'Renewal values ran about 8% above expiring across the board — a real, recent data point for projecting insurance cost growth rather than assuming a flat rate.',
    },
    square_footage: {
      church_6704_fyler_sqft: 28480,
      ivanhoe_building_sqft: 16692,
      ivanhoe_sqft_breakdown: '13,692 sq ft ground floor / 1,500 sq ft basement / 1,500 sq ft second floor (all connected: office, warehouse, and apartments are one physical structure)',
      ivanhoe_share_of_combined_sqft_pct: 0.36952094217656956,
      note: 'Useful as a second, independent allocation basis (e.g. for utilities or other shared costs where value isn’t the right basis) — it lands close to, but not identical to, the value-based share below, which is expected.',
    },
    premiums_2025_2026_renewal: {
      commercial_package_policy_cpp_cents: 4912800,
      commercial_auto_bap_cents: 35400,
      umbrella_umb_cents: 50000,
      workers_comp_wc_cents: 0,
      total_cents: 4998200,
      note: 'CPP is the property/liability policy and is the right one to allocate by building value. BAP (auto) is excluded from the property allocation — it covers vehicles, not real estate. UMB (umbrella) is prorated the same way as CPP since it follows the whole schedule.',
    },
    ivanhoe_allocation: {
      method: 'Building value (TIV) share of the CPP + umbrella premium, using the renewal (2025-2026) values.',
      ivanhoe_share_of_total_insured_value_pct: 0.307541276215975,
      allocated_cpp_premium_cents: 1510889,
      allocated_umbrella_premium_cents: 15377,
      allocated_total_annual_cents: 1526266,
      is_estimate: true,
      estimate_note: 'This is a defensible allocation off the church’s actual insured-value schedule, not a guess — but it is still an allocation, since the church receives one bill and pays it centrally. Present as "allocated share of church insurance" rather than as an actual invoice paid by or to the property.',
    },
    correction_log: [
      'An earlier pass allocated only the "Apartments" ($831,000) TIV bucket to 3277 Ivanhoe and computed roughly $3,681/year. That undercounted the property — the "Lessors Risk Gym" bucket ($2,615,000) is also 3277 Ivanhoe (the office/warehouse portion of the same connected building), confirmed by Andrew 2026-07-20 and by an exact dollar match to the ACORD property section. Corrected allocation uses both buckets ($3,446,000 total) and comes to roughly $15,263/year.',
    ],
    open_items: [
      'Confirm with agent Kip Starnes (Lutheran Trust, Inc., 800-200-7257) that "Lessors Risk Gym" is in fact a legacy label for the Ivanhoe office/warehouse building and not a distinct property — the dollar match makes this very likely but it’s worth a one-line confirmation for the record.',
      'MDO / daycare’s own share of building use and utilities at the church (Location #1, 6704 Fyler) is a separate, parallel allocation problem — see church_building_shared_costs (not shown in the Commercial Property section since it belongs to the church building, not this rental property).',
    ],
  },
  // NOT about 3277 Ivanhoe — cost-sharing at the church's own building (6704 Fyler), where MDO
  // and an evening gym renter also use the space. Kept here only because it's the same kind of
  // shared-cost-allocation problem as the insurance split above; deliberately NOT surfaced in the
  // Commercial Property UI. See CLAUDE.md queued items for where this should eventually live.
  church_building_shared_costs: {
    scope_note: "This section is NOT about 3277 Ivanhoe. It covers cost-sharing at the church's own building (6704 Fyler Avenue), where MDO (the daycare/preschool program) and an evening gym renter also use the space.",
    mdo_utility_allocation: {
      estimated_mdo_share_pct: 0.6,
      is_estimate: true,
      basis_given_by_andrew: 'MDO is in the building 5 days a week. The church itself uses the building for Sunday programming and an occasional weeknight. There is also an evening gym renter in the fall and winter.',
      estimate_note: 'This is Andrew’s own judgment-call estimate, not a metered or invoiced split. A day-count-only calculation (5 weekday days out of 7) would suggest something closer to 71%; worth revisiting if the church ever gets real usage-hours or metered data.',
      other_building_users_considered: [
        { user: 'MDO (daycare/preschool)', schedule: '5 days/week, daytime' },
        { user: 'Church (Sunday worship/programming)', schedule: 'Weekly, Sunday' },
        { user: 'Church (occasional weeknight programming)', schedule: 'Occasional, one weeknight' },
        { user: 'Evening gym renter', schedule: 'Fall and winter only, evenings' },
      ],
      remaining_share_pct_implied: 0.4,
      remaining_share_note: 'The implied 40% remainder is not further split between the church’s own programming and the seasonal evening gym renter — worth deciding whether the gym renter should be broken out as its own line.',
    },
  },
};
async function seedIvanhoeProperty(db) {
  const existing = await db.prepare("SELECT COUNT(*) as n FROM finance_property_monthly WHERE property_key='ivanhoe'").first();
  if (!existing || existing.n > 0) return;
  const ops = [];
  for (const row of FINANCE_PROPERTY_IVANHOE_MONTHLY) {
    const [period, occ, rev, exp, net, noi, afd, reserve, source] = row;
    ops.push(db.prepare(
      `INSERT INTO finance_property_monthly
         (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,source_report)
       VALUES ('ivanhoe',?,?,?,?,?,?,?,?,?)`
    ).bind(period, occ, rev, exp, net, noi, afd, reserve, source));
  }
  for (const [period, cents] of FINANCE_PROPERTY_IVANHOE_DISTRIBUTIONS) {
    ops.push(db.prepare(
      `INSERT OR IGNORE INTO finance_property_distributions (property_key,period,amount_cents) VALUES ('ivanhoe',?,?)`
    ).bind(period, cents));
  }
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(JSON.stringify(FINANCE_PROPERTY_IVANHOE_META)));
  await db.batch(ops);
}

// FIN — 3277 Ivanhoe reserve schedules / capital ledger / repairs, delivered 2026-07-20 as a
// follow-up to the initial export above (same source: AHRA monthly reports, cross-checked
// against the general ledger detail for accounts 1640/4120/4129/4133/7510). Answers the gap the
// user flagged after the first Commercial Property build shipped: "doesn't have the places for
// reserves for property taxes, and capital expenses". Guarded by a one-time marker (not by row
// count like seedIvanhoeProperty above) since this runs as a follow-up delta against a DB that
// may already have the original property data seeded.
// [report_month, tax_year_estimated, estimated_tax_cents, reserve_before_cents, contribution_cents, reserve_after_cents, note]
const FINANCE_PROPERTY_TAX_RESERVE_SCHEDULE = [
  ['2023-12', 2024, 1160000, 0, 96667, 96667, ''],
  ['2024-03', 2024, 1160000, 290000, 96667, 386667, ''],
  ['2024-04', 2024, 1160000, 386667, 96667, 483333, ''],
  ['2024-05', 2024, 1160000, 483333, 96667, 580000, ''],
  ['2024-06', 2024, 1160000, 580000, 96667, 676667, ''],
  ['2024-07', 2024, 1160000, 676667, 96667, 773333, ''],
  ['2024-08', 2024, 1160000, 773333, 96667, 870000, ''],
  ['2024-09', 2024, 1160000, 870000, 96667, 966667, ''],
  ['2024-10', 2024, 1160000, 966667, 96667, 1063333, ''],
  ['2024-11', 2024, 0, 0, 0, 0, '2024 tax paid in November; reserve zeroed out.'],
  ['2024-12', 2025, 1200000, 0, 100000, 100000, ''],
  ['2025-01', 2025, 1200000, 100000, 100000, 200000, ''],
  ['2025-02', 2025, 1200000, 200000, 100000, 300000, ''],
  ['2025-03', 2025, 1200000, 300000, 100000, 400000, ''],
  ['2025-04', 2025, 1200000, 400000, 100000, 500000, ''],
  ['2025-05', 2025, 1200000, 500000, 100000, 600000, ''],
  ['2025-06', 2025, 1200000, 600000, 100000, 700000, ''],
  ['2025-07', 2025, 1200000, 700000, 100000, 800000, ''],
  ['2025-08', 2025, 1200000, 800000, 100000, 900000, ''],
  ['2025-09', 2025, 1200000, 900000, 100000, 1000000, ''],
  ['2025-10', 2025, 1134839, 1000000, 67420, 1067420, 'Estimate revised down to actual 2025 tax amount.'],
  ['2025-11', 2025, 0, 0, 0, 0, '2025 tax paid in November; reserve zeroed out.'],
  ['2025-12', 2026, 1140000, 0, 95000, 95000, ''],
  ['2026-01', 2026, 1140000, 95000, 95000, 190000, ''],
  ['2026-02', 2026, 1140000, 190000, 95000, 285000, ''],
  ['2026-03', 2026, 1140000, 285000, 95000, 380000, ''],
  ['2026-04', 2026, 1140000, 380000, 95000, 475000, ''],
  ['2026-05', 2026, 1140000, 380000, 95000, 475000, 'Same figures as April report; likely a report carryover rather than a missed contribution — worth confirming with AHRA.'],
];
// [tax_year, amount_paid_cents|null, paid_via_report_month|'', note]
const FINANCE_PROPERTY_TAX_PAID_BY_YEAR = [
  [2023, 1116456, '2023-12', 'Appears as a lump-sum expense line in the Dec 2023 report; predates the reserve-building mechanism seen from 2024 on.'],
  [2024, 1164731, '2024-11', 'Reserve (built up to $10,633.33 through Oct) applied against actual bill; reserve zeroed in Nov 2024 report.'],
  [2025, 1134964, '2025-11', 'Reserve (built up to $10,674.20 through Oct) applied against actual bill; reserve zeroed in Nov 2025 report.'],
  [2026, null, '', 'Not yet paid as of the May 2026 report. Reserve is accumulating at $950/month against an $11,400 estimate; balance was $4,750.00 as of the May 2026 report.'],
];
// [entry_date|'', amount_cents, payee, description, check_ref, project]
const FINANCE_PROPERTY_CAPITAL_LEDGER = [
  ['', 988700, 'Unknown (predates available reports)', "Opening balance of the Capital Improvements account as of the earliest available report (Mar 2024). Likely early apartment renovation costs, per Best Roofing and Exteriors' 'Apartment Conversion' project that began Dec 2023. Jan/Feb 2024 reports are missing, so the itemized buildup to this figure isn't available.", '', '1st-floor apartment renovation (bathroom, kitchen, granite countertop)'],
  ['2024-10-07', 540000, 'Vail Contracting LLC', '1st-floor apartment renovation - contracting work', 'Check #5088', '1st-floor apartment renovation (bathroom, kitchen, granite countertop)'],
  ['2024-10-19', 230225, 'SS Stone & Design LLC', '1st-floor apartment renovation - granite countertop installation', 'Check #5091', '1st-floor apartment renovation (bathroom, kitchen, granite countertop)'],
  ['2024-12-02', 57150, 'Vail Contracting LLC', '1st-floor apartment renovation - finishing work', 'Check #5097', '1st-floor apartment renovation (bathroom, kitchen, granite countertop)'],
  ['2025-10-26', 778700, 'Martin Jetco Heating & Air Conditioning, Inc', 'Install new heater (HVAC system replacement)', 'Check #5146', 'HVAC system replacement (new heater)'],
  ['2025-12-17', 400000, 'Vail Contracting LLC', 'Washer/dryer hookup installation, 1st floor apartment (deposit / first half)', 'eCheck 8350-13C0', 'Washer/dryer hookup installation, 1st floor apartment'],
  ['2026-04-08', 400000, 'Vail Contracting LLC (inferred; same project)', 'Washer/dryer hookup installation, 1st floor apartment (final half; project completed per Feb 2026 report note)', 'Invoice 2954 / AP 000184', 'Washer/dryer hookup installation, 1st floor apartment'],
];
// [entry_date, category, description, amount_cents|null, payee, capitalized]
const FINANCE_PROPERTY_REPAIRS = [
  ['2023-12-27', 'Roof', 'Roof leak repair', null, '', 0],
  ['2024-11', 'Roof', 'Roof leak during heavy rains; Innovative Roofing dispatched to make repairs', null, 'Innovative Roofing', 0],
  ['2024-09-11', 'Appliance', 'Appliance replacement (1st floor apartment)', 77598, 'Slyman Bros', 0],
  ['2025-01-23', 'Roof', 'Structure & roof repair', 15000, 'Innovative Construction & Roofing', 0],
  ['2025-02-12', 'HVAC', 'HVAC repair', 8900, 'Heating Cooling', 0],
  ['2025-02-18', 'HVAC', 'Replaced inducer motor and wheel on the Reznor gas heater (3283 unit)', 113500, 'Sigman Indoor Climate Solutions, LLC', 0],
  ['2025-04-03', 'HVAC', 'Diagnosed short-cycling issue', 42000, 'Sigman Indoor Climate Solutions, LLC', 0],
  ['2025-04-03', 'HVAC', 'Replaced thermostat', 31900, 'Sigman Indoor Climate Solutions, LLC', 0],
  ['2025-07', 'Exterior / Masonry', 'Tuckpointing', 135000, 'Tough Enough Construction (billed via Innovative Construction & Roofing check)', 0],
  ['2025-08', 'Roof / Ceiling', 'Ceiling leak repair (1st floor tenant reported ceiling damage)', 81107, 'Jim Taylor, Inc.', 0],
  ['2026-03', 'Roof', 'Roof-related structure repair', 61179, '', 0],
  ['2026-05', 'HVAC', 'Air-conditioning repair; cooling restored (1st floor apt)', null, '', 0],
  ['2026-05-11', 'Roof', 'Roof-leak inspection in response to tenant report', null, '', 0],
];
async function seedIvanhoePropertyReservesV2(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_reserves_v2_seeded'").first();
  if (marker) return;
  const ops = [];
  let sortOrder = 0;
  for (const [reportMonth, taxYear, est, before, contrib, after, note] of FINANCE_PROPERTY_TAX_RESERVE_SCHEDULE) {
    ops.push(db.prepare(
      `INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
       VALUES ('ivanhoe','property_tax',?,?,?,?,?,?,?)
       ON CONFLICT(property_key,reserve_key,report_month) DO NOTHING`
    ).bind(reportMonth, taxYear, est, before, contrib, after, note));
  }
  for (const [taxYear, amountCents, paidVia, note] of FINANCE_PROPERTY_TAX_PAID_BY_YEAR) {
    ops.push(db.prepare(
      `INSERT INTO finance_property_reserve_disbursements (property_key,reserve_key,period_key,amount_cents,paid_via_report_month,note)
       VALUES ('ivanhoe','property_tax',?,?,?,?)
       ON CONFLICT(property_key,reserve_key,period_key) DO NOTHING`
    ).bind(String(taxYear), amountCents, paidVia, note));
  }
  for (const [entryDate, amountCents, payee, description, checkRef, project] of FINANCE_PROPERTY_CAPITAL_LEDGER) {
    ops.push(db.prepare(
      `INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,payee,description,check_ref,project,sort_order)
       VALUES ('ivanhoe',?,?,?,?,?,?,?)`
    ).bind(entryDate, amountCents, payee, description, checkRef, project, sortOrder++));
  }
  for (const [entryDate, category, description, amountCents, payee, capitalized] of FINANCE_PROPERTY_REPAIRS) {
    ops.push(db.prepare(
      `INSERT INTO finance_property_repairs (property_key,entry_date,category,description,amount_cents,payee,capitalized)
       VALUES ('ivanhoe',?,?,?,?,?,?)`
    ).bind(entryDate, category, description, amountCents, payee, capitalized));
  }
  // Correct/refresh the loan section (mortgage paydown) and add the new meta sections
  // (capital_improvements/insurance/church_building_shared_costs) on an existing DB that already
  // seeded the original (now-stale) meta blob — a shallow merge so any admin edits to other
  // sections (property/valuation) survive.
  const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_meta'").first();
  let meta = {};
  if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
  meta.loan = FINANCE_PROPERTY_IVANHOE_META.loan;
  meta.capital_improvements = FINANCE_PROPERTY_IVANHOE_META.capital_improvements;
  meta.insurance = FINANCE_PROPERTY_IVANHOE_META.insurance;
  meta.church_building_shared_costs = FINANCE_PROPERTY_IVANHOE_META.church_building_shared_costs;
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(JSON.stringify(meta)));
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_reserves_v2_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ));
  await db.batch(ops);
}

// FIN — the actual AHRA valuation worksheet (3277_Ivanhoe_Valuation_2.xlsx) was uploaded
// 2026-07-20, after the original export had already summarized it into one lump
// gross_rental_income/total_operating_costs figure. Replaces that lump total with the real
// per-tenant rent roll + itemized operating costs it reconciles to exactly (see the
// FINANCE_PROPERTY_IVANHOE_META.valuation literal above). Its own marker, separate from the v2
// reserves marker, since it can land independently of that upgrade.
async function seedIvanhoePropertyValuationV3(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_valuation_v3_seeded'").first();
  if (marker) return;
  const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_meta'").first();
  let meta = {};
  if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
  meta.valuation = FINANCE_PROPERTY_IVANHOE_META.valuation;
  await db.batch([
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(meta)),
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_valuation_v3_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  ]);
}

// FIN — June 2026 AHRA property management report (delivered 2026-07-23 as a structured
// extract: report_summary.md, monthly_financials_row.csv, extract.json). Adds this month's
// financials + the next tax-reserve-schedule entry, and records the source's own flagged
// data-quality items as meta notes rather than resolving them by assumption — same
// "record the note, don't guess" convention as the correction_log/open_items already in
// FINANCE_PROPERTY_IVANHOE_META. Mortgage balance is untouched (already correctly $279,691.13
// per FIN9's own marker-gated fix); this report's own $100,785.68 MRI-migration figure is
// explicitly NOT used, per the source's own flag.
async function seedIvanhoePropertyJune2026(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_2026_06_seeded'").first();
  if (marker) return;
  const ops = [];
  // total_expenses_cents = operating + non-operating expenses combined (matches how every prior
  // row in FINANCE_PROPERTY_IVANHOE_MONTHLY is stored — revenue minus this equals net income
  // exactly, verified against the source's own income statement: $9,765.27 - $4,462.48 = $5,302.79).
  ops.push(db.prepare(
    `INSERT INTO finance_property_monthly
       (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,source_report)
     VALUES ('ivanhoe','2026-06',1.0,976527,446248,530279,625984,932177,1035833,'2026-06 - 3277 Ivanhoe Property Management Report.pdf')
     ON CONFLICT(property_key,period) DO UPDATE SET
       occupancy_pct=excluded.occupancy_pct, total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
       net_income_cents=excluded.net_income_cents, net_operating_income_cents=excluded.net_operating_income_cents,
       available_for_distribution_cents=excluded.available_for_distribution_cents, reserve_balance_cents=excluded.reserve_balance_cents,
       source_report=excluded.source_report`
  ));
  // Property tax reserve: this report's own reserve section frames itself as computing JULY's
  // contribution off June's activity (its own stated report_month is "2026-07"), recalculated as
  // the remaining $6,650.00 gap spread over the 6 months left before the tax is due ($1,108.33/mo)
  // rather than the flat $950/mo used earlier in the year. The "before" balance ($4,750.00) is
  // identical to April and May — no distinct June-2026 contribution appears anywhere in this
  // source, the same report-carryover pattern already flagged on the 2026-05 row.
  ops.push(db.prepare(
    `INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
     VALUES ('ivanhoe','property_tax','2026-07',2026,1140000,475000,110833,585833,?)
     ON CONFLICT(property_key,reserve_key,report_month) DO NOTHING`
  ).bind('From the June 2026 report (generated 7/23/2026); its own reserve section computes July’s contribution, recalculated as the remaining $6,650.00 gap spread over the 6 months left before the tax is due ($1,108.33/mo) rather than the flat $950/mo used earlier in the year. No distinct June-2026 contribution row appears anywhere in this source — the $4,750.00 "before" balance is identical to April and May, the same carryover pattern already flagged on the 2026-05 row.'));
  const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_meta'").first();
  let meta = {};
  if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
  meta.open_items_2026_06 = [
    'Security Deposits Ledger ending balance (-$4,925.00) does not tie to the Balance Sheet / GL security deposits liability (-$4,450.00). A $1,500 refund to a tenant named "Daniel Pica" (not otherwise appearing anywhere else in this report) plus an offsetting correction entry runs through the GL this period (ref 5178 / CA 000875). Flag to AHRA before treating either figure as authoritative.',
    'Magnatone’s rent roll lease expiration (4/30/2026) is already past as of this June report, yet the tenant is shown as occupied and current on rent — likely a holdover or an unrecorded renewal. Worth confirming with AHRA.',
    'Two open plumbing work orders for Emma Taylor (suite 3275) as of this report: a 2nd-bathroom faucet issue and a running master-bathroom toilet, both dated 6/17/2026, still open.',
  ];
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(JSON.stringify(meta)));
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_2026_06_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ));
  await db.batch(ops);
}

// FIN — follow-up after the June 2026 seed above, per Andrew's own read of the numbers: (1) the
// AHRA/MRI "Mortgage Payable One" GL account (2500-0010) genuinely does grow every month rather
// than shrink — the June report's period debit ($2,830.98) exactly equals that month's actual
// principal payment (bank rec shows a $3,783.03 LCEF loan payment 6/30/2026; the income
// statement shows $952.05 interest expense for the same month; 3783.03 - 952.05 = 2830.98,
// dollar-for-dollar). That's strong evidence this GL account tracks a CUMULATIVE total that
// grows by each month's principal paid, not the live outstanding balance (which actually
// decreases as principal is paid) — Andrew's own theory, now backed by an exact reconciliation,
// not just a vague "artifact" label. Recorded as principal-payment history for the audit trail;
// does NOT change the confirmed running balance, since this payment already posted before the
// 2026-07-20 lender confirmation date it's anchored to. (2) Daniel Pica: per Andrew, a former
// tenant who moved out — plausibly not refunded his full security deposit, which would explain
// both the $475 ledger/GL gap and why he no longer appears anywhere else in this report (rent
// roll / aged delinquencies only list current tenants). Still worth confirming the exact
// refunded amount with AHRA, but resolves the "who is this and why" question. Separate marker
// from the June financials seed above so it's safe regardless of whether that one already ran.
async function seedIvanhoePropertyJune2026Notes(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_2026_06_notes_seeded'").first();
  if (marker) return;
  const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_meta'").first();
  let meta = {};
  if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
  meta.loan = meta.loan || {};
  meta.loan.principal_payment_history = [
    { period: '2026-06', total_payment_cents: 378303, interest_cents: 95205, principal_cents: 283098,
      note: 'Bank reconciliation: $3,783.03 LCEF loan payment, 6/30/2026. Income statement: $952.05 interest expense, June 2026. Principal = 378303 − 95205 = 283098 — exactly matches the $2,830.98 period debit posted to GL account "Mortgage Payable One" (2500-0010) that same month.' },
  ];
  meta.loan.note = (meta.loan.note || '') + ' AHRA/MRI\'s "Mortgage Payable One" GL account grows every month rather than shrinking — the June 2026 period debit ($2,830.98) exactly matches that month\'s real principal payment (see principal_payment_history), strong evidence this account tracks a cumulative total paid over time, not the live outstanding balance. The confirmed running balance above ($279,691.13 as of 2026-07-20) is the one to use; it already reflects June\'s payment since it postdates it.';
  const openItems = meta.open_items_2026_06;
  if (Array.isArray(openItems)) {
    meta.open_items_2026_06 = openItems.map((item) => item.indexOf('Daniel Pica') >= 0
      ? 'Security Deposits Ledger ending balance (-$4,925.00) does not tie to the Balance Sheet / GL security deposits liability (-$4,450.00). Per Andrew: "Daniel Pica" is a former tenant who moved out and may not have been refunded his full security deposit — plausibly explaining both the $475 gap and why he doesn\'t appear anywhere else in this report (rent roll / aged delinquencies list only current tenants). Still worth confirming the exact refunded amount with AHRA.'
      : item);
  }
  await db.batch([
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(meta)),
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_2026_06_notes_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
    // Backfill the same figures onto the real loan_payment_cents/interest_expense_cents columns
    // (added by the same migration this seed ships alongside) so the automatic mortgage-balance
    // rollforward (finComputeMortgageRemainingCents) has real data for June, not just a meta note.
    db.prepare(`UPDATE finance_property_monthly SET loan_payment_cents=378303, interest_expense_cents=95205 WHERE property_key='ivanhoe' AND period='2026-06'`),
  ]);
}

// The July 2026 "Property Reserve and Distribution Report" page (same source document as the
// June 2026 report, just its reserve-calc section — AHRA computes that section looking one month
// ahead of the operating financials, dated when the report was generated) revealed a real
// discrepancy: the app's "Reserves On-Hand" figure ($5,858.33, the Property Tax Reserve's own
// running balance) didn't match AHRA's own "Total Property Reserve" line ($10,358.33). Reconciled
// exactly: $10,358.33 = $5,858.33 (property tax reserve after) + $4,500.00 (AHRA's flat "Base
// Minimum Reserve" cash cushion, a constant policy floor, not an accumulating bucket). Seeds that
// $4,500 figure into meta.reserves.base_minimum_cents so "Reserves On-Hand" reconciles to AHRA's
// own total (see finComputePropertyReservesOnHandCents in js-finance.js); admin-editable
// afterward via the new "Base Minimum Reserve" card.
async function seedIvanhoePropertyBaseMinimumReserve(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_base_minimum_seeded'").first();
  if (marker) return;
  const metaRow = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_meta'").first();
  let meta = {};
  if (metaRow) { try { meta = JSON.parse(metaRow.value) || {}; } catch { meta = {}; } }
  meta.reserves = { ...(meta.reserves || {}), base_minimum_cents: 450000 };
  await db.batch([
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(meta)),
    db.prepare(`INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_base_minimum_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  ]);
}

// The July 2026 AHRA report. total_expenses_cents = operating + non-operating combined
// (same convention as every prior row — 973857 − 235308 = 738549, matches Net Income exactly).
// loan_payment_cents/interest_expense_cents come straight off the GL entries for 7/27/2026
// (a $3,783.03 LCEF loan payment, $942.03 of it interest) — unlike June's payment, this one
// postdates the 2026-07-20 confirmed-balance anchor, so it's picked up automatically by the
// existing mortgage rollforward (finComputeMortgageRemainingCents) with no separate note needed.
// The reserve row's report_month is '2026-08': this report's own reserve section computes
// AUGUST's contribution off July's activity, same one-month-ahead convention as June's row.
async function seedIvanhoePropertyJuly2026(db) {
  const marker = await db.prepare("SELECT value FROM chms_config WHERE key='finance_property_ivanhoe_2026_07_seeded'").first();
  if (marker) return;
  const ops = [];
  ops.push(db.prepare(
    `INSERT INTO finance_property_monthly
       (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,loan_payment_cents,interest_expense_cents,source_report)
     VALUES ('ivanhoe','2026-07',1.0,973857,235308,738549,833252,658444,1146667,378303,94203,'2026-07 - 3277 Ivanhoe Property Management Report.pdf')
     ON CONFLICT(property_key,period) DO UPDATE SET
       occupancy_pct=excluded.occupancy_pct, total_revenue_cents=excluded.total_revenue_cents, total_expenses_cents=excluded.total_expenses_cents,
       net_income_cents=excluded.net_income_cents, net_operating_income_cents=excluded.net_operating_income_cents,
       available_for_distribution_cents=excluded.available_for_distribution_cents, reserve_balance_cents=excluded.reserve_balance_cents,
       loan_payment_cents=excluded.loan_payment_cents, interest_expense_cents=excluded.interest_expense_cents,
       source_report=excluded.source_report`
  ));
  ops.push(db.prepare(
    `INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
     VALUES ('ivanhoe','property_tax','2026-08',2026,1140000,585833,110833,696667,?)
     ON CONFLICT(property_key,reserve_key,report_month) DO NOTHING`
  ).bind('From the July 2026 report (generated 8/20/2026); its own reserve section computes August’s contribution off July’s activity, same one-month-ahead convention as the June report. 5 months remain until the property tax is due.'));
  ops.push(db.prepare(
    `INSERT INTO chms_config (key,value) VALUES ('finance_property_ivanhoe_2026_07_seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ));
  await db.batch(ops);
}

// ── Schema fingerprint ───────────────────────────────────────────────────────
// _doInitDb applies ~220 statements serially, each its own D1 round trip: every CREATE TABLE
// / CREATE INDEX in DB_INIT, then ~84 ALTER TABLE migrations (each of which *throws*
// "duplicate column" on an already-migrated database and is swallowed), then a dozen seed
// functions. All of it is idempotent, so on a live database essentially every statement is a
// no-op — but it is awaited before the Worker serves a single byte, and initDb's memoization
// is per-ISOLATE, so every cold isolate paid the full cost again. Measured against production
// on 2026-08-04: ~6.5–7.0s TTFB on a cold isolate versus ~0.2s on a warm one, for a 5 KB
// login page. That is the entire reason the site felt slower than any other website.
//
// The fast path below collapses that to ONE round trip when the schema is already current.
//
// The fingerprint is derived from the actual source text of _doInitDb and every seed it
// calls, so any edit to a migration, a DDL statement, or a seed body changes it automatically
// and the full init runs again on the next request. There is deliberately no constant to
// remember to bump — that would be a silent-skipped-migration footgun, which is far worse
// than the slow start this replaces.
function _schemaFingerprint() {
  const parts = [
    _doInitDb, seedChmsDefaults, seedEvents, seedIvanhoeProperty,
    seedIvanhoePropertyBaseMinimumReserve, seedIvanhoePropertyJune2026,
    seedIvanhoePropertyJune2026Notes, seedIvanhoePropertyJuly2026,
    seedIvanhoePropertyReservesV2,
    seedIvanhoePropertyValuationV3, seedMinistryRolesFromStatic,
    seedStudentTuitionHistory, seedTuitionAid, seedTuitionYearRates,
    // Not a seed, but it runs from _doInitDb and its body decides what gets removed — so an
    // edit to it has to re-trigger the full init the same way a seed edit does.
    scrubServerManagedSchedulerSecrets,
  ].map((f) => f.toString());
  parts.push(DB_INIT.join('\n'));
  const src = parts.join('\n');
  // FNV-1a. Not cryptographic — it only needs to change when the source changes.
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + '-' + src.length.toString(36);
}

// ── One-time scrub: server-managed secrets out of scheduler_data (SEC17 / P22-B) ────────────
// ws_breeze_settings historically stored the Breeze API key and WORKER_SECRET alongside real
// settings, and GET /admin/api/scheduler/data returns that table wholesale to admin OR STAFF.
// Both values live in the Worker's env and are read from there; the copies here were readable
// by every staff login, and WORKER_SECRET is the X-Worker-Secret bypass credential — a
// non-expiring, non-revocable one that outlives deactivating the account it leaked to.
//
// api-admin.js now strips these on every write, so nothing can put them back. This removes
// what is already stored. Deliberately NOT marker-gated: it is a cheap read plus a write only
// when something is actually there, and re-running it is exactly the behavior wanted if a key
// ever reappears. It runs whenever the schema fingerprint changes, which includes this deploy.
export async function scrubServerManagedSchedulerSecrets(db) {
  const row = await db.prepare(
    "SELECT value FROM scheduler_data WHERE key='ws_breeze_settings'"
  ).first().catch(() => null);
  if (!row || !row.value) return;
  let parsed;
  try { parsed = JSON.parse(row.value); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const KEYS = ['apiKey', 'workerSecret', 'resendKey', 'emailFrom'];
  if (!KEYS.some((k) => k in parsed)) return;
  for (const k of KEYS) delete parsed[k];
  await db.prepare(
    "UPDATE scheduler_data SET value=?, updated_at=datetime('now') WHERE key='ws_breeze_settings'"
  ).bind(JSON.stringify(parsed)).run().catch(() => {});
}

async function _doInitDb(db) {
  const fingerprint = _schemaFingerprint();
  // One cheap read decides whether any of the rest is needed. Throws on a brand-new database
  // (no chms_config table yet), which the catch turns into "not current" — so a first-ever
  // deploy still runs the full init and creates everything.
  const current = await db.prepare(
    `SELECT value FROM chms_config WHERE key='schema_fingerprint'`
  ).first().catch(() => null);
  if (current && current.value === fingerprint) return;

  for (const stmt of DB_INIT) {
    await db.prepare(stmt).run();
  }
  // Migrations for existing deployments
  const migrations = [
    'ALTER TABLE serve_roles ADD COLUMN role_date TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE serve_roles ADD COLUMN start_time TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE serve_roles ADD COLUMN end_time TEXT NOT NULL DEFAULT ""',
    // Who runs this job on the day. Typed by the coordinator in the Add/Edit shift
    // modal, never derived from who signed up — a lead is usually a committee member
    // running the job rather than somebody occupying one of its spots, so reading it
    // off signup_slots would leave most jobs blank and would call the first person to
    // sign up the person in charge. Blank is a real state and prints "Unassigned".
    'ALTER TABLE serve_roles ADD COLUMN lead TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE serve_roles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE serve_events ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE serve_events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE serve_events ADD COLUMN use_time_slots INTEGER NOT NULL DEFAULT 1',
    // signups table columns added over time
    'ALTER TABLE signups ADD COLUMN event_id INTEGER',
    'ALTER TABLE signups ADD COLUMN role_id INTEGER',
    'ALTER TABLE signups ADD COLUMN ministry TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN email TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN phone TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN roles TEXT NOT NULL DEFAULT "[]"',
    'ALTER TABLE signups ADD COLUMN service TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN sundays TEXT NOT NULL DEFAULT "[]"',
    'ALTER TABLE signups ADD COLUMN shirt_wanted INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE signups ADD COLUMN shirt_size TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN notes TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))',
    // ChMS giving: breeze_id for deduplication on import
    'ALTER TABLE giving_entries ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // ChMS giving: per-gift date (more accurate than batch_date for Breeze imports)
    'ALTER TABLE giving_entries ADD COLUMN contribution_date TEXT NOT NULL DEFAULT ""',
    // Covering indexes for the contribution_date range every finance and giving report filters
    // on. Without them each of those reports is a full SCAN of every year of giving ever
    // recorded in order to read one year; with them SQLite answers from the index alone. See
    // migrations/0042_giving_contribution_date_indexes.sql for the EXPLAIN QUERY PLAN evidence.
    //
    // ⚠ These belong HERE and not in DB_INIT: contribution_date is added by the ALTER directly
    // above, so DB_INIT runs before the column exists and the index creation fails with
    // "no such column: contribution_date" on a fresh database.
    'CREATE INDEX IF NOT EXISTS idx_giving_date_fund ON giving_entries(contribution_date, fund_id, amount)',
    'CREATE INDEX IF NOT EXISTS idx_giving_date_person ON giving_entries(contribution_date, person_id, amount)',
    // Materialized giving summaries. The numbered migration performs the existing-data backfill
    // once; never put that scan in this runtime initializer. These objects cover fresh databases.
    `CREATE TABLE IF NOT EXISTS giving_monthly_fund_totals (
      month       TEXT    NOT NULL,
      fund_id     INTEGER NOT NULL,
      gift_count  INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, fund_id)
    )`,
    // deploy.yml deploys the Worker but does not run `wrangler d1 migrations apply`. Production
    // therefore needs this guarded safety net for the first request after rollout. The empty-table
    // predicate is evaluated once: it permits one historical scan, then every later cold start
    // reads one summary row and skips giving_entries entirely.
    `INSERT INTO giving_monthly_fund_totals(month,fund_id,gift_count,total_cents)
     SELECT substr(contribution_date,1,7),fund_id,COUNT(*),COALESCE(SUM(amount),0)
       FROM giving_entries
      WHERE contribution_date!=''
        AND NOT EXISTS (SELECT 1 FROM giving_monthly_fund_totals LIMIT 1)
      GROUP BY substr(contribution_date,1,7),fund_id`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_insert
     AFTER INSERT ON giving_entries
     WHEN COALESCE(NULLIF(NEW.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=NEW.batch_id),'')!=''
     BEGIN
       INSERT INTO giving_monthly_fund_totals(month,fund_id,gift_count,total_cents)
       VALUES(substr(COALESCE(NULLIF(NEW.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=NEW.batch_id)),1,7),NEW.fund_id,1,NEW.amount)
       ON CONFLICT(month,fund_id) DO UPDATE SET gift_count=gift_count+1,total_cents=total_cents+excluded.total_cents;
     END`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_delete
     AFTER DELETE ON giving_entries
     WHEN COALESCE(NULLIF(OLD.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=OLD.batch_id),'')!=''
     BEGIN
       UPDATE giving_monthly_fund_totals SET gift_count=gift_count-1,total_cents=total_cents-OLD.amount
        WHERE month=substr(COALESCE(NULLIF(OLD.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=OLD.batch_id)),1,7)
          AND fund_id=OLD.fund_id;
       DELETE FROM giving_monthly_fund_totals WHERE gift_count<=0;
     END`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_monthly_totals_update
     AFTER UPDATE OF batch_id,contribution_date,fund_id,amount ON giving_entries
     BEGIN
       UPDATE giving_monthly_fund_totals SET gift_count=gift_count-1,total_cents=total_cents-OLD.amount
        WHERE COALESCE(NULLIF(OLD.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=OLD.batch_id),'')!=''
          AND month=substr(COALESCE(NULLIF(OLD.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=OLD.batch_id)),1,7)
          AND fund_id=OLD.fund_id;
       DELETE FROM giving_monthly_fund_totals WHERE gift_count<=0;
       INSERT INTO giving_monthly_fund_totals(month,fund_id,gift_count,total_cents)
       SELECT substr(COALESCE(NULLIF(NEW.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=NEW.batch_id)),1,7),NEW.fund_id,1,NEW.amount
        WHERE COALESCE(NULLIF(NEW.contribution_date,''),(SELECT batch_date FROM giving_batches WHERE id=NEW.batch_id),'')!=''
       ON CONFLICT(month,fund_id) DO UPDATE SET gift_count=gift_count+1,total_cents=total_cents+excluded.total_cents;
     END`,
    'CREATE INDEX IF NOT EXISTS idx_giving_person_date ON giving_entries(person_id, contribution_date)',
    `CREATE TABLE IF NOT EXISTS giving_year_stats (
      year INTEGER PRIMARY KEY,
      giving_households INTEGER NOT NULL DEFAULT 0,
      giver_count INTEGER NOT NULL DEFAULT 0,
      band_high INTEGER NOT NULL DEFAULT 0,
      band_mid INTEGER NOT NULL DEFAULT 0,
      band_low INTEGER NOT NULL DEFAULT 0,
      refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS giving_year_household_totals (
      year INTEGER NOT NULL,
      household_key TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      giver_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (year,household_key)
    )`,
    `CREATE TABLE IF NOT EXISTS giving_rollup_dirty (
      year INTEGER PRIMARY KEY,
      dirtied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_insert
     AFTER INSERT ON giving_entries WHEN NEW.contribution_date!=''
     BEGIN
       INSERT INTO giving_rollup_dirty(year,dirtied_at)
       VALUES(CAST(substr(NEW.contribution_date,1,4) AS INTEGER),datetime('now'))
       ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
     END`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_delete
     AFTER DELETE ON giving_entries WHEN OLD.contribution_date!=''
     BEGIN
       INSERT INTO giving_rollup_dirty(year,dirtied_at)
       VALUES(CAST(substr(OLD.contribution_date,1,4) AS INTEGER),datetime('now'))
       ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
     END`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_update
     AFTER UPDATE OF contribution_date,person_id,amount ON giving_entries
     BEGIN
       INSERT INTO giving_rollup_dirty(year,dirtied_at)
       SELECT CAST(substr(OLD.contribution_date,1,4) AS INTEGER),datetime('now') WHERE OLD.contribution_date!=''
       ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
       INSERT INTO giving_rollup_dirty(year,dirtied_at)
       SELECT CAST(substr(NEW.contribution_date,1,4) AS INTEGER),datetime('now') WHERE NEW.contribution_date!=''
       ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
     END`,
    `CREATE TRIGGER IF NOT EXISTS trg_giving_year_dirty_person_update
     AFTER UPDATE OF household_id,member_type ON people
     BEGIN
       INSERT INTO giving_rollup_dirty(year,dirtied_at)
       SELECT DISTINCT CAST(substr(contribution_date,1,4) AS INTEGER),datetime('now')
         FROM giving_entries WHERE person_id=NEW.id AND contribution_date!=''
       ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at;
     END`,
    // ChMS tags: breeze_id to match Breeze tags on re-sync
    'ALTER TABLE tags ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // ChMS households: breeze_id to match Breeze family_id on re-sync
    'ALTER TABLE households ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // worship_services: store Breeze instance_id to enable attendance count sync
    'ALTER TABLE worship_services ADD COLUMN breeze_instance_id TEXT NOT NULL DEFAULT ""',
    // funds: breeze_id to match Breeze fund IDs during giving sync
    'ALTER TABLE funds ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // funds: per-fund annual budget (cents) for the Board Report YTD-budget/variance columns
    'ALTER TABLE funds ADD COLUMN budget_annual_cents INTEGER NOT NULL DEFAULT 0',
    // funds: category backing the Reports fund lens (migration 0033) — general | earned |
    // passive | restricted. Backfilled for the General Fund family below.
    "ALTER TABLE funds ADD COLUMN category TEXT NOT NULL DEFAULT 'restricted'",
    // people: deceased flag and death date
    'ALTER TABLE people ADD COLUMN deceased INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE people ADD COLUMN death_date TEXT NOT NULL DEFAULT ""',
    // people: public directory opt-in (default visible)
    'ALTER TABLE people ADD COLUMN public_directory INTEGER NOT NULL DEFAULT 1',
    // church_register: extended historical record fields
    'ALTER TABLE church_register ADD COLUMN record_type TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN dob TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN place_of_birth TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN baptism_place TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN father TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN mother TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN sponsors TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE church_register ADD COLUMN pdf_page TEXT NOT NULL DEFAULT ""',
    // people: giving envelope number (assigned per-person or per-couple)
    'ALTER TABLE people ADD COLUMN envelope_number TEXT NOT NULL DEFAULT ""',
    // people: prior envelope numbers, JSON array (GIV-R4/B, migration 0030) — old
    // envelopes stay in circulation after a yearly reassignment.
    'ALTER TABLE people ADD COLUMN envelope_history TEXT NOT NULL DEFAULT \'[]\'',
    // people: last-seen date for pastoral tracking
    'ALTER TABLE people ADD COLUMN last_seen_date TEXT NOT NULL DEFAULT ""',
    // people: gender and marital status (imported from Breeze)
    'ALTER TABLE people ADD COLUMN gender TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE people ADD COLUMN marital_status TEXT NOT NULL DEFAULT ""',
    // households: family/household photo URL
    'ALTER TABLE households ADD COLUMN photo_url TEXT NOT NULL DEFAULT ""',
    // people: per-field directory privacy (0=show, 1=hide from printed directory)
    'ALTER TABLE people ADD COLUMN dir_hide_address INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE people ADD COLUMN dir_hide_phone INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE people ADD COLUMN dir_hide_email INTEGER NOT NULL DEFAULT 0',
    // people: baptized/confirmed boolean flags (independent of date — for cases where date is unknown)
    'ALTER TABLE people ADD COLUMN baptized INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE people ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0',
    // people: archive/deceased status ('active' | 'archived' | 'deceased')
    'ALTER TABLE people ADD COLUMN status TEXT NOT NULL DEFAULT \'active\'',
    // people: engagement workflow (DC1/DB9/FU2)
    'ALTER TABLE people ADD COLUMN last_reviewed_at TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE people ADD COLUMN first_contact_date TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE people ADD COLUMN followup_status TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE people ADD COLUMN followup_notes TEXT NOT NULL DEFAULT ""',
    // people: first_gift_noted — set to 1 when staff have seen and dismissed this person from the First-Time Givers dashboard card
    'ALTER TABLE people ADD COLUMN first_gift_noted INTEGER NOT NULL DEFAULT 0',
    // people: SMS opt-in for birthday/anniversary texts via Brevo
    'ALTER TABLE people ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0',
    // people: privacy — hide DOB and anniversary from member-role profile views
    'ALTER TABLE people ADD COLUMN dir_hide_dob INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE people ADD COLUMN dir_hide_anniversary INTEGER NOT NULL DEFAULT 0',
    // member portal: link app_users to a person record
    'ALTER TABLE app_users ADD COLUMN people_id INTEGER REFERENCES people(id)',
    // member portal: Web Push subscription JSON (stored per-user account)
    'ALTER TABLE app_users ADD COLUMN push_subscription TEXT NOT NULL DEFAULT ""',
    // people: once edited locally, bulk Breeze sync will not overwrite name/contact/address/etc.
    'ALTER TABLE people ADD COLUMN locally_edited INTEGER NOT NULL DEFAULT 0',
    // volunteer messaging: link signups to people records, track contact history
    'ALTER TABLE signups ADD COLUMN person_id INTEGER DEFAULT NULL',
    'ALTER TABLE signups ADD COLUMN contacted_at TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE signups ADD COLUMN contact_count INTEGER NOT NULL DEFAULT 0',
    // volunteer email templates for outreach form letters
    `CREATE TABLE IF NOT EXISTS volunteer_email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '',
      ministry TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Speed up giving sync dedup, orphan cleanup, and reconcile-diagnose lookups.
    'CREATE INDEX IF NOT EXISTS idx_giving_breeze ON giving_entries(breeze_id)',
    // AU1: email column on app_users for password reset flow.
    'ALTER TABLE app_users ADD COLUMN email TEXT NOT NULL DEFAULT ""',
    // Ministry Roles: standing volunteer roles per ministry category
    `CREATE TABLE IF NOT EXISTS ministry_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ministry TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      commitment TEXT NOT NULL DEFAULT '',
      training TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Signups status workflow: new -> contacted -> confirmed (or declined)
    `ALTER TABLE signups ADD COLUMN status TEXT NOT NULL DEFAULT 'new'`,
    // Public sign-up: opt-in flag for a manual staff reminder before the volunteer's shift
    'ALTER TABLE signups ADD COLUMN sms_reminder_opt_in INTEGER NOT NULL DEFAULT 0',
    // Events: optional short URL slug (e.g. "christmasmarket") so an event can be
    // linked/promoted at serve.timothystl.org/<slug> instead of a bare #event-<id>.
    'ALTER TABLE serve_events ADD COLUMN slug TEXT NOT NULL DEFAULT ""',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_events_slug ON serve_events(slug) WHERE slug != ''`,
    // Tuition Aid Planner: K-8/LHS roster (money in integer cents), budget config, historical chart data
    `CREATE TABLE IF NOT EXISTS tuition_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER REFERENCES people(id),
      household_id INTEGER REFERENCES households(id),
      family TEXT NOT NULL DEFAULT '',
      child TEXT NOT NULL DEFAULT '',
      is_pipeline INTEGER NOT NULL DEFAULT 0,
      base_grade TEXT NOT NULL DEFAULT '',
      birth_year INTEGER,
      outside_aid_cents INTEGER NOT NULL DEFAULT 0,
      fam_pct INTEGER NOT NULL DEFAULT 50,
      fam_pct_orig INTEGER NOT NULL DEFAULT 50,
      touched INTEGER NOT NULL DEFAULT 0,
      lhs_award_cents INTEGER NOT NULL DEFAULT 120000,
      lhs_award_orig_cents INTEGER NOT NULL DEFAULT 120000,
      attends_lhs INTEGER NOT NULL DEFAULT 1,
      timothy_award_exact_cents INTEGER,
      family_owed_exact_cents INTEGER,
      timothy_award_override_cents INTEGER,
      family_owed_override_cents INTEGER,
      note TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS tuition_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS tuition_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_year TEXT NOT NULL DEFAULT '',
      tuition_cents INTEGER NOT NULL DEFAULT 0,
      family_pct REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    // Tuition Aid Planner: per-year tuition rate overrides + per-student per-year pins
    // (see migrations/0015_tuition_year_history.sql for the full rationale)
    `CREATE TABLE IF NOT EXISTS tuition_year_rates (
      school_year TEXT PRIMARY KEY,
      tuition_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS tuition_student_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES tuition_students(id),
      school_year TEXT NOT NULL,
      grade TEXT NOT NULL DEFAULT '',
      outside_aid_cents INTEGER,
      fam_pct INTEGER,
      timothy_award_cents INTEGER,
      family_owed_cents INTEGER,
      lhs_award_cents INTEGER,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tsy_student_year ON tuition_student_years(student_id, school_year)`,
    `CREATE INDEX IF NOT EXISTS idx_tsy_school_year ON tuition_student_years(school_year)`,
    // Tuition Aid Planner: exact-dollar Timothy Award override for the current year, alongside
    // Outside Aid (see migrations/0017_tuition_timothy_override.sql)
    'ALTER TABLE tuition_students ADD COLUMN timothy_award_override_cents INTEGER',
    'ALTER TABLE tuition_students ADD COLUMN family_owed_override_cents INTEGER',
    // Finance Overview: QuickBooks Online OAuth connection + cached report snapshots,
    // plus manual daycare entries (see migrations/0016_finance.sql)
    `CREATE TABLE IF NOT EXISTS finance_qb_connection (
      id                       INTEGER PRIMARY KEY CHECK (id = 1),
      realm_id                 TEXT    NOT NULL DEFAULT '',
      company_name             TEXT    NOT NULL DEFAULT '',
      access_token             TEXT    NOT NULL DEFAULT '',
      refresh_token            TEXT    NOT NULL DEFAULT '',
      access_token_expires_at  TEXT    NOT NULL DEFAULT '',
      refresh_token_expires_at TEXT    NOT NULL DEFAULT '',
      environment              TEXT    NOT NULL DEFAULT 'production',
      connected_at             TEXT    NOT NULL DEFAULT '',
      last_synced_at           TEXT    NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS finance_qb_snapshot (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      synced_at  TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS finance_daycare_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      period       TEXT    NOT NULL DEFAULT '',
      category     TEXT    NOT NULL DEFAULT '',
      entry_type   TEXT    NOT NULL DEFAULT 'actual',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      notes        TEXT    NOT NULL DEFAULT '',
      source       TEXT    NOT NULL DEFAULT 'manual',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_daycare_period ON finance_daycare_entries(period)`,
    // Daycare API sync (finance/daycare/sync) writes source='daycare_api' rows wholesale;
    // this column lets manual entries coexist without being clobbered. Added after the table
    // itself for databases that cold-started between the two.
    `ALTER TABLE finance_daycare_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    // Persisted Church financial data (see migrations/0018_finance_church_entries.sql for the
    // full design rationale — never stores QuickBooks' own subtotal rows, only each account's
    // own non-cumulative amount, keyed by a colon-joined category_path).
    `CREATE TABLE IF NOT EXISTS finance_church_entries (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year       INTEGER NOT NULL,
      period_month      INTEGER NOT NULL DEFAULT 0,
      classification    TEXT    NOT NULL,
      category_path     TEXT    NOT NULL,
      account_name      TEXT    NOT NULL,
      depth             INTEGER NOT NULL DEFAULT 0,
      has_children      INTEGER NOT NULL DEFAULT 0,
      own_actual_cents  INTEGER NOT NULL DEFAULT 0,
      own_budget_cents  INTEGER,
      account_qbo_id    TEXT    NOT NULL DEFAULT '',
      source            TEXT    NOT NULL DEFAULT 'qbo_sync',
      notes             TEXT    NOT NULL DEFAULT '',
      synced_at         TEXT    NOT NULL DEFAULT '',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(fiscal_year, period_month, category_path, source)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_church_entries_year       ON finance_church_entries(fiscal_year)`,
    `CREATE INDEX IF NOT EXISTS idx_church_entries_year_class ON finance_church_entries(fiscal_year, classification)`,
    `CREATE INDEX IF NOT EXISTS idx_church_entries_path        ON finance_church_entries(category_path)`,
    // The Data & Imports legacy fallback asks for MAX(synced_at) within one source. This covering
    // index changes that from a scan of every imported account/year row into an index lookup.
    // See migrations/0043_finance_import_status_index.sql for the production measurement.
    `CREATE INDEX IF NOT EXISTS idx_church_entries_source_synced ON finance_church_entries(source, synced_at)`,
    // Point-in-time Balance Sheet snapshots (see migrations/0019_finance_church_balances.sql).
    `CREATE TABLE IF NOT EXISTS finance_church_balances (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      fiscal_year       INTEGER NOT NULL,
      as_of_date        TEXT    NOT NULL DEFAULT '',
      classification    TEXT    NOT NULL,
      category_path     TEXT    NOT NULL,
      account_name      TEXT    NOT NULL,
      depth             INTEGER NOT NULL DEFAULT 0,
      has_children      INTEGER NOT NULL DEFAULT 0,
      own_balance_cents INTEGER NOT NULL DEFAULT 0,
      source            TEXT    NOT NULL DEFAULT 'import',
      synced_at         TEXT    NOT NULL DEFAULT '',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(fiscal_year, category_path, source)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_church_balances_year ON finance_church_balances(fiscal_year)`,
    // SC6 Phase 1: relationalize Scheduler volunteers onto real people rows (see
    // migrations/0020_scheduler_volunteers.sql for the full rationale).
    `CREATE TABLE IF NOT EXISTS scheduler_volunteers (
      person_id             INTEGER PRIMARY KEY REFERENCES people(id),
      reminder_email        TEXT    NOT NULL DEFAULT '',
      roles                 TEXT    NOT NULL DEFAULT '[]',
      primary_for           TEXT    NOT NULL DEFAULT '[]',
      preferred_sundays     TEXT    NOT NULL DEFAULT '[]',
      service_preference    TEXT    NOT NULL DEFAULT 'both',
      role_sunday_overrides TEXT    NOT NULL DEFAULT '{}',
      blackout_dates        TEXT    NOT NULL DEFAULT '[]',
      absence_start         TEXT    NOT NULL DEFAULT '',
      absence_until         TEXT    NOT NULL DEFAULT '',
      active                INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduler_volunteers_active ON scheduler_volunteers(active)`,
    // people: middle name and preferred/goes-by name
    `ALTER TABLE people ADD COLUMN middle_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE people ADD COLUMN preferred_name TEXT NOT NULL DEFAULT ''`,
    // SC6 Phase 2: legacy ws_people id this row was migrated from (see
    // migrations/0021_scheduler_volunteers_legacy_id.sql).
    `ALTER TABLE scheduler_volunteers ADD COLUMN migrated_from_legacy_id TEXT NOT NULL DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS idx_scheduler_volunteers_legacy_id ON scheduler_volunteers(migrated_from_legacy_id)`,
    // Finance tab — Commercial Property section (see migrations/0022_finance_property.sql).
    `CREATE TABLE IF NOT EXISTS finance_property_monthly (
      property_key                     TEXT    NOT NULL DEFAULT 'ivanhoe',
      period                           TEXT    NOT NULL,
      occupancy_pct                    REAL,
      total_revenue_cents              INTEGER,
      total_expenses_cents             INTEGER,
      net_income_cents                 INTEGER,
      net_operating_income_cents       INTEGER,
      available_for_distribution_cents INTEGER,
      reserve_balance_cents            INTEGER,
      source_report                    TEXT    NOT NULL DEFAULT '',
      updated_at                       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (property_key, period)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_property_distributions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
      period        TEXT    NOT NULL,
      amount_cents  INTEGER NOT NULL DEFAULT 0,
      UNIQUE(property_key, period)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_property_dist_key ON finance_property_distributions(property_key)`,
    // Finance tab — Commercial Property reserves/capital/repairs (see
    // migrations/0023_finance_property_reserves.sql).
    `CREATE TABLE IF NOT EXISTS finance_property_reserves (
      property_key           TEXT    NOT NULL DEFAULT 'ivanhoe',
      reserve_key            TEXT    NOT NULL,
      report_month           TEXT    NOT NULL,
      tax_year               INTEGER,
      target_estimate_cents  INTEGER,
      reserve_before_cents   INTEGER,
      contribution_cents     INTEGER,
      reserve_after_cents    INTEGER,
      note                   TEXT    NOT NULL DEFAULT '',
      PRIMARY KEY (property_key, reserve_key, report_month)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_property_reserve_disbursements (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      property_key           TEXT    NOT NULL DEFAULT 'ivanhoe',
      reserve_key            TEXT    NOT NULL,
      period_key             TEXT    NOT NULL,
      amount_cents           INTEGER,
      paid_via_report_month  TEXT    NOT NULL DEFAULT '',
      note                   TEXT    NOT NULL DEFAULT '',
      UNIQUE(property_key, reserve_key, period_key)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_property_capital_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
      entry_date    TEXT    NOT NULL DEFAULT '',
      amount_cents  INTEGER NOT NULL DEFAULT 0,
      payee         TEXT    NOT NULL DEFAULT '',
      description   TEXT    NOT NULL DEFAULT '',
      check_ref     TEXT    NOT NULL DEFAULT '',
      project       TEXT    NOT NULL DEFAULT '',
      sort_order    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_property_capital_ledger_key ON finance_property_capital_ledger(property_key)`,
    `CREATE TABLE IF NOT EXISTS finance_property_repairs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
      entry_date    TEXT    NOT NULL DEFAULT '',
      category      TEXT    NOT NULL DEFAULT '',
      description   TEXT    NOT NULL DEFAULT '',
      amount_cents  INTEGER,
      payee         TEXT    NOT NULL DEFAULT '',
      capitalized   INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_property_repairs_key ON finance_property_repairs(property_key)`,
    // Church Budget Planning (see migrations/0024_finance_budget_plan.sql).
    `CREATE TABLE IF NOT EXISTS finance_budget_plan (
      category             TEXT    NOT NULL,
      classification        TEXT    NOT NULL DEFAULT 'Expenses',
      fiscal_year           INTEGER NOT NULL,
      planned_amount_cents  INTEGER NOT NULL DEFAULT 0,
      basis                 TEXT    NOT NULL DEFAULT 'manual',
      growth_pct            REAL,
      base_amount_cents     INTEGER,
      notes                 TEXT    NOT NULL DEFAULT '',
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (category, fiscal_year)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_budget_plan_year ON finance_budget_plan(fiscal_year)`,
    // Commercial Property monthly BUDGET (see migrations/0025_finance_property_budget.sql) —
    // parallels finance_property_monthly (actuals) but imported from a separate AHRA export.
    `CREATE TABLE IF NOT EXISTS finance_property_budget_monthly (
      property_key      TEXT    NOT NULL DEFAULT 'ivanhoe',
      period             TEXT    NOT NULL,
      revenue_cents      INTEGER NOT NULL DEFAULT 0,
      expenses_cents     INTEGER NOT NULL DEFAULT 0,
      net_income_cents   INTEGER NOT NULL DEFAULT 0,
      source             TEXT    NOT NULL DEFAULT 'ahra_import',
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (property_key, period)
    )`,
    // Finance Workspace redesign (see migrations/0034_finance_workspace_v3.sql): room-level
    // daycare aggregates and per-importer staleness timestamps.
    `CREATE TABLE IF NOT EXISTS finance_daycare_rooms (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      period             TEXT    NOT NULL,
      room_name          TEXT    NOT NULL,
      capacity_per_day   REAL,
      avg_daily_enrolled REAL,
      billed_cents       INTEGER,
      labor_cost_cents   INTEGER,
      waitlist_families  INTEGER NOT NULL DEFAULT 0,
      seasonal           INTEGER NOT NULL DEFAULT 0,
      synced_at          TEXT    NOT NULL DEFAULT '',
      UNIQUE(period, room_name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_finance_daycare_rooms_period ON finance_daycare_rooms(period)`,
    `CREATE TABLE IF NOT EXISTS finance_import_log (
      importer_key     TEXT PRIMARY KEY,
      last_imported_at TEXT NOT NULL,
      note             TEXT NOT NULL DEFAULT ''
    )`,
    // Real per-month loan payment + interest expense (see migrations/0026_...) — lets the
    // confirmed mortgage balance roll forward automatically instead of needing a fresh lender
    // confirmation every time (finComputeMortgageRemainingCents in js-finance.js).
    'ALTER TABLE finance_property_monthly ADD COLUMN loan_payment_cents INTEGER',
    'ALTER TABLE finance_property_monthly ADD COLUMN interest_expense_cents INTEGER',
    // Giving-letter batch send resume/dedup (see migrations/0027_giving_letter_sends.sql).
    `CREATE TABLE IF NOT EXISTS giving_letter_sends (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id   INTEGER NOT NULL,
      year        INTEGER NOT NULL,
      letter_type TEXT    NOT NULL,
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(person_id, year, letter_type)
    )`,
    // Letters & Statements workspace (GIV-R2, see migrations/0029_giving_letters_workspace.sql):
    // household-scoped sends, print channel, and a stable per-recipient dedup identity.
    'ALTER TABLE giving_letter_sends ADD COLUMN household_id INTEGER',
    "ALTER TABLE giving_letter_sends ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'",
    'ALTER TABLE giving_letter_sends ADD COLUMN recipient_key TEXT',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_gls_recipient
       ON giving_letter_sends(recipient_key, year, letter_type, channel)
       WHERE recipient_key IS NOT NULL`,
    // Native giving deposit/reconciliation columns (migration 0031). Kept here, not in DB_INIT,
    // because ALTER ADD COLUMN throws "duplicate column name" on re-run and only this loop catches it.
    'ALTER TABLE giving_entries ADD COLUMN deposit_id INTEGER',
    "ALTER TABLE giving_entries ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE giving_entries ADD COLUMN source TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE giving_entries ADD COLUMN processor TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE giving_entries ADD COLUMN external_txn_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE giving_entries ADD COLUMN reconcile_status TEXT NOT NULL DEFAULT 'recorded'",
    `CREATE INDEX IF NOT EXISTS idx_entries_deposit ON giving_entries(deposit_id)`,
    // P24-B (see migrations/0037_engagement_tasks_unique_week.sql): two staff opening the
    // dashboard the same Monday morning both saw an empty weekly-task list and both seeded
    // it, leaving ten rows instead of five. Dedup first — a database that already hit the
    // race has real duplicate rows, and the unique index would fail outright against them.
    `DELETE FROM engagement_tasks WHERE id NOT IN (
       SELECT MIN(id) FROM engagement_tasks GROUP BY title, week_key
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_tasks_title_week ON engagement_tasks(title, week_key)`,
    // P28-C / PL1b (see migrations/0038_pledges.sql): pledge tracking, one row per person per
    // fiscal year. No fund column deliberately -- a pledge names an annual total, not a
    // designation.
    `CREATE TABLE IF NOT EXISTS pledges (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       person_id INTEGER NOT NULL REFERENCES people(id),
       fiscal_year INTEGER NOT NULL,
       amount_cents INTEGER NOT NULL DEFAULT 0,
       note TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_person_year ON pledges(person_id, fiscal_year)`,
    // (see migrations/0039_followup_contact_fields.sql): the submitter's own contact info,
    // for a follow-up item created without a linked person record (a website contact-form
    // submission -- see /api/intake/connect-card).
    "ALTER TABLE follow_up_items ADD COLUMN requester_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE follow_up_items ADD COLUMN requester_email TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE follow_up_items ADD COLUMN requester_phone TEXT NOT NULL DEFAULT ''",
    // (see migrations/0040_register_scan_pages.sql): scanned register page images, one row
    // per (register type, page number) -- lets a register row's `pdf_page` link straight to
    // the scanned book page it was transcribed from.
    `CREATE TABLE IF NOT EXISTS register_scan_pages (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       type        TEXT    NOT NULL,
       page        TEXT    NOT NULL,
       r2_key      TEXT    NOT NULL,
       uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_register_scan_type_page ON register_scan_pages(type, page)`,
    // (see migrations/0041_register_certificate_templates.sql): one background certificate
    // image per register type, with a JSON list of positioned fields (name/date/officiant/etc,
    // each an x/y percent offset), so a printed certificate can overlay real entry data onto
    // the church's own certificate design instead of the app's generic bordered layout.
    `CREATE TABLE IF NOT EXISTS register_certificate_templates (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       type        TEXT    NOT NULL UNIQUE,
       r2_key      TEXT    NOT NULL,
       fields_json TEXT    NOT NULL DEFAULT '[]',
       updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
     )`,
  ];
  // Every statement here is either an idempotent CREATE ... IF NOT EXISTS, or an ALTER TABLE
  // ADD COLUMN — SQLite has no "ADD COLUMN IF NOT EXISTS", so a re-run always throws "duplicate
  // column name" on a column already added by a prior deploy. That specific error is expected
  // and swallowed on purpose. Anything else (a typo, a bad table/column reference, a genuine
  // storage failure) is NOT a re-run artifact — it means a column or index this session depends
  // on may be silently missing, and this runs on every request (see initDb), so it can't throw
  // without taking the whole app down on a false positive. Instead it's logged so it's visible
  // in Cloudflare's Worker logs rather than disappearing into an empty catch.
  for (const m of migrations) {
    try {
      await db.prepare(m).run();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (!/duplicate column name|already exists/i.test(msg)) {
        console.error('[migration] unexpected error, statement may not have applied:', m, msg);
      }
    }
  }
  // Normalize member_type to lowercase so frontend comparisons are consistent
  await db.prepare("UPDATE people SET member_type=LOWER(member_type) WHERE member_type != LOWER(member_type)").run().catch(() => {});

  // The `office` role was renamed to `council`. Existing accounts have to move with it —
  // `office` is no longer in the valid-role list, so a user left on it would resolve to an
  // empty permission row and lose access entirely. Idempotent: after the first run there is
  // nothing left matching. The stored role_permissions_json still keeps its `office` key
  // until an admin next saves; resolveRolePermissions() reads that key as council's.
  await db.prepare("UPDATE app_users SET role='council' WHERE role='office'").run().catch(() => {});

  // Anyone with a date on file IS baptized/confirmed — the date is the record of it, so a
  // flag still reading "not recorded" next to one is just a gap in the data (RI2: earlier
  // Breeze imports wrote the date columns and never set the flags the pipeline reads).
  //
  // `=0` and not `!=1` on purpose. 0 is "not recorded", which is what this fills in; 2 is a
  // human's explicit "No", and a contradictory date is not grounds to overwrite the answer a
  // person actually gave. Partial dates count — a baptism known only to the year is still a
  // baptism. This re-runs whenever the schema fingerprint changes, so it also catches rows
  // an import adds later.
  await db.prepare("UPDATE people SET baptized=1 WHERE baptized=0 AND baptism_date != ''").run().catch(() => {});
  await db.prepare("UPDATE people SET confirmed=1 WHERE confirmed=0 AND confirmation_date != ''").run().catch(() => {});

  await seedEvents(db);
  await migrateChristmasMarketRoles(db);
  await seedChmsDefaults(db);
  await backfillFundCategories(db);

  // Transportation folded into Acceptance (Care Ministry) as a sub-category — re-tag any
  // roles already seeded/added under the old 'transportation' ministry. This MUST run
  // before seedMinistryRolesFromStatic: MINISTRY_ROLES_SEED now tags these 3 roles
  // 'acceptance', so on a DB that still had them as 'transportation', seeding first would
  // find no existing 'acceptance'-tagged row (the dedup check only NOT-EXISTS on the exact
  // ministry+name pair) and insert a duplicate before this UPDATE reclassified the original.
  await db.prepare("UPDATE ministry_roles SET ministry='acceptance' WHERE ministry='transportation'").run().catch(() => {});

  await seedMinistryRolesFromStatic(db);

  // One-time self-heal: on any database that already cold-started between the
  // Transportation-seed deploy and this ordering fix, the race above already ran once and
  // left duplicate rows (identical ministry+name, one still carrying the pre-reclassification
  // id). ministry_roles.id is never referenced as a foreign key elsewhere (signups store the
  // role NAME as their checkbox value, not the id), so it's safe to collapse duplicates down
  // to the earliest-created row per name.
  await db.prepare(
    `DELETE FROM ministry_roles WHERE ministry='acceptance'
       AND name IN ('Regular Sunday Driver','Special-Occasion Driver','Ride Coordinator')
       AND id NOT IN (
         SELECT MIN(id) FROM ministry_roles WHERE ministry='acceptance'
           AND name IN ('Regular Sunday Driver','Special-Occasion Driver','Ride Coordinator')
         GROUP BY name
       )`
  ).run().catch(() => {});

  await seedTuitionAid(db);
  await seedTuitionYearRates(db);
  await seedStudentTuitionHistory(db);
  await seedIvanhoeProperty(db);
  await seedIvanhoePropertyReservesV2(db);
  await seedIvanhoePropertyValuationV3(db);
  await seedIvanhoePropertyJune2026(db);
  await seedIvanhoePropertyJune2026Notes(db);
  await seedIvanhoePropertyBaseMinimumReserve(db);
  await seedIvanhoePropertyJuly2026(db);
  await scrubServerManagedSchedulerSecrets(db);

  // Recorded LAST, and only on success. If anything above threw, initDb's own catch clears
  // its memoized promise so the next request retries — and because no fingerprint was
  // written, that retry does the full work again rather than assuming a half-applied schema
  // is current.
  await db.prepare(
    `INSERT INTO chms_config (key, value) VALUES ('schema_fingerprint', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(fingerprint).run().catch(() => {});
}
