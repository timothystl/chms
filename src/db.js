// ── DATABASE SCHEMA + INITIALIZATION ──────────────────────────────────────────
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
    end_time TEXT NOT NULL DEFAULT ''
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
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id    INTEGER,
    type         TEXT    NOT NULL DEFAULT 'general',
    notes        TEXT    NOT NULL DEFAULT '',
    due_date     TEXT    NOT NULL DEFAULT '',
    completed    INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
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

async function _doInitDb(db) {
  for (const stmt of DB_INIT) {
    await db.prepare(stmt).run();
  }
  // Migrations for existing deployments
  const migrations = [
    'ALTER TABLE serve_roles ADD COLUMN role_date TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE serve_roles ADD COLUMN start_time TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE serve_roles ADD COLUMN end_time TEXT NOT NULL DEFAULT ""',
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
    // ChMS tags: breeze_id to match Breeze tags on re-sync
    'ALTER TABLE tags ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // ChMS households: breeze_id to match Breeze family_id on re-sync
    'ALTER TABLE households ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
    // worship_services: store Breeze instance_id to enable attendance count sync
    'ALTER TABLE worship_services ADD COLUMN breeze_instance_id TEXT NOT NULL DEFAULT ""',
    // funds: breeze_id to match Breeze fund IDs during giving sync
    'ALTER TABLE funds ADD COLUMN breeze_id TEXT NOT NULL DEFAULT ""',
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
    // linked/promoted at volunteer.timothystl.org/<slug> instead of a bare #event-<id>.
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
    // SC6 Phase 2: legacy ws_people id this row was migrated from (see
    // migrations/0021_scheduler_volunteers_legacy_id.sql).
    `ALTER TABLE scheduler_volunteers ADD COLUMN migrated_from_legacy_id TEXT NOT NULL DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS idx_scheduler_volunteers_legacy_id ON scheduler_volunteers(migrated_from_legacy_id)`,
  ];
  for (const m of migrations) {
    try { await db.prepare(m).run(); } catch(e) { /* column already exists */ }
  }
  // Normalize member_type to lowercase so frontend comparisons are consistent
  await db.prepare("UPDATE people SET member_type=LOWER(member_type) WHERE member_type != LOWER(member_type)").run().catch(() => {});

  // Backfill baptized/confirmed booleans from existing dates (RI2 — earlier Breeze imports
  // wrote the date columns but never set the booleans the sacramental pipeline reads).
  await db.prepare("UPDATE people SET baptized=1 WHERE baptized=0 AND baptism_date != ''").run().catch(() => {});
  await db.prepare("UPDATE people SET confirmed=1 WHERE confirmed=0 AND confirmation_date != ''").run().catch(() => {});

  await seedEvents(db);
  await migrateChristmasMarketRoles(db);
  await seedChmsDefaults(db);

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
}

