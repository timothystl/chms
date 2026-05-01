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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  `CREATE INDEX IF NOT EXISTS idx_prayer_requests_person ON prayer_requests(person_id)`
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


// Cache the init so it only runs once per Worker isolate (not on every request).
// Resets to null on error so the next request retries.
let _initPromise = null;
export function initDb(db) {
  if (!_initPromise) _initPromise = _doInitDb(db).catch(e => { _initPromise = null; throw e; });
  return _initPromise;
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
  ];
  for (const m of migrations) {
    try { await db.prepare(m).run(); } catch(e) { /* column already exists */ }
  }
  await seedEvents(db);
  await migrateChristmasMarketRoles(db);
  await seedChmsDefaults(db);
}

