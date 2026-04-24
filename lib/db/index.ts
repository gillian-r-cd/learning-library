import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.LL_DB_PATH || path.join(DEFAULT_DB_DIR, "learning-library.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  // Ensure the parent directory for the DB file exists (supports arbitrary
  // LL_DB_PATH values, including custom e2e / viz paths).
  const parent = path.dirname(DB_PATH);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS blueprints (
      blueprint_id TEXT PRIMARY KEY,
      topic        TEXT NOT NULL,
      version      INTEGER NOT NULL DEFAULT 1,
      status       TEXT NOT NULL DEFAULT 'in_design',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      designer_id  TEXT NOT NULL,
      data_json    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blueprint_audit (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      blueprint_id  TEXT NOT NULL,
      step          INTEGER NOT NULL,
      version       INTEGER NOT NULL,
      at            TEXT NOT NULL,
      skill_output  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learner_states (
      learner_id     TEXT PRIMARY KEY,
      blueprint_id   TEXT NOT NULL,
      blueprint_ver  INTEGER NOT NULL,
      data_json      TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      learner_id   TEXT NOT NULL,
      ts           TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      action_id    TEXT NOT NULL,
      turn_idx     INTEGER NOT NULL,
      grades_json  TEXT NOT NULL,
      evidence     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_learner ON evidence_log(learner_id);

    -- Full conversational transcript: every learner-visible bubble goes here,
    -- not just the grades. This is what the learner sees when they come back.
    CREATE TABLE IF NOT EXISTS conversation_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      learner_id    TEXT NOT NULL,
      ts            TEXT NOT NULL,
      turn_idx      INTEGER NOT NULL,
      chapter_id    TEXT,
      challenge_id  TEXT,
      role          TEXT NOT NULL,         -- learner | narrator | companion | system
      who           TEXT,                  -- companion display_name or system event name
      text          TEXT NOT NULL,
      trace_id      TEXT,
      meta_json     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conv_learner_ts ON conversation_log(learner_id, id);

    CREATE TABLE IF NOT EXISTS ledger (
      call_id           TEXT PRIMARY KEY,
      trace_id          TEXT NOT NULL,
      parent_span_id    TEXT,
      ts_start          TEXT NOT NULL,
      ts_end            TEXT NOT NULL,
      stage             TEXT NOT NULL,
      caller            TEXT NOT NULL,
      model             TEXT NOT NULL,
      raw_input_json    TEXT NOT NULL,
      raw_output_json   TEXT NOT NULL,
      tokens_json       TEXT NOT NULL,
      cache_json        TEXT NOT NULL,
      latency_json      TEXT NOT NULL,
      cost_usd          REAL NOT NULL,
      context_json      TEXT NOT NULL,
      lifecycle_json    TEXT NOT NULL,
      user_visible      INTEGER NOT NULL,
      content_safety_json TEXT NOT NULL,
      learner_id        TEXT,
      blueprint_id      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts_start);
    CREATE INDEX IF NOT EXISTS idx_ledger_trace ON ledger(trace_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_caller ON ledger(caller);
    CREATE INDEX IF NOT EXISTS idx_ledger_learner ON ledger(learner_id);

    CREATE TABLE IF NOT EXISTS prompt_store (
      key           TEXT NOT NULL,           -- e.g. skill_1_gamecore.template
      scope         TEXT NOT NULL,           -- 'system' or 'course:<blueprint_id>'
      version       INTEGER NOT NULL,
      status        TEXT NOT NULL,           -- draft | approved | published | rolled_back
      body_json     TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      created_by    TEXT NOT NULL,
      note          TEXT,
      PRIMARY KEY (key, scope, version)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_lookup ON prompt_store(key, scope, status);

    CREATE TABLE IF NOT EXISTS admin_audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL,
      actor      TEXT NOT NULL,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL,
      diff_json  TEXT
    );
  `);

  // Additive migrations — each addColumnIfMissing is a no-op on already-migrated DBs.
  addColumnIfMissing(d, "evidence_log", "points_earned", "REAL");
  addColumnIfMissing(d, "evidence_log", "complexity", "TEXT");
  // Scaffolding audit columns (P1/P2) — lets us measure which cognitive
  // strategy was used per turn and whether the learner needed scaffolding.
  addColumnIfMissing(d, "evidence_log", "scaffold_strategy", "TEXT");
  addColumnIfMissing(d, "evidence_log", "scaffold_assisted", "INTEGER"); // 0/1
  // Manifesto pipeline — Judge flags learner first-person synthesis moments.
  // Aggregated by manifesto_generator at chapter close.
  addColumnIfMissing(d, "evidence_log", "quotable", "INTEGER"); // 0/1
}

/** SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Probe pragma then
 *  add. Safe to re-run each boot. */
function addColumnIfMissing(
  d: Database.Database,
  table: string,
  column: string,
  sqlType: string
) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
