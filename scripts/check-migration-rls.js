#!/usr/bin/env node
/**
 * Fails CI if any table created in supabase/migrations/ lacks a matching
 * `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` somewhere in the migrations
 * tree.
 *
 * Context: Supabase exposes every public-schema table through the anon API,
 * so a table without RLS is readable/writable by anyone with the anon key
 * (which ships in the browser bundle). See migration 069 for the incident
 * that motivated this check.
 *
 * An individual CREATE TABLE can be explicitly exempted by putting
 *   -- rls-check: skip — <reason>
 * on the same line as the CREATE TABLE statement.
 */
const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// Collect every CREATE TABLE across all migrations, and separately every
// ENABLE ROW LEVEL SECURITY. RLS may live in a later migration than the
// create, so we must search the whole tree before deciding.
const createdTables = [] // { name, file, line, skipped }
const rlsEnabled = new Set()

const createRe = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["]?([a-zA-Z_][a-zA-Z0-9_]*)["]?\s*\(/i
const rlsRe = /^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?["]?([a-zA-Z_][a-zA-Z0-9_]*)["]?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i
const skipRe = /--\s*rls-check:\s*skip/i

for (const file of files) {
  const full = path.join(MIGRATIONS_DIR, file)
  const lines = fs.readFileSync(full, 'utf8').split('\n')
  lines.forEach((line, idx) => {
    const createMatch = line.match(createRe)
    if (createMatch) {
      createdTables.push({
        name: createMatch[1],
        file,
        line: idx + 1,
        skipped: skipRe.test(line),
      })
    }
    const rlsMatch = line.match(rlsRe)
    if (rlsMatch) {
      rlsEnabled.add(rlsMatch[1])
    }
  })
}

const missing = createdTables.filter(
  (t) => !t.skipped && !rlsEnabled.has(t.name)
)

if (missing.length > 0) {
  console.error(
    `\nFound ${missing.length} table(s) created without ENABLE ROW LEVEL SECURITY:\n`
  )
  for (const t of missing) {
    console.error(`  - ${t.name}  (${t.file}:${t.line})`)
  }
  console.error(
    '\nAdd `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` in the same or a' +
      '\nlater migration. To intentionally leave a table without RLS, append' +
      '\n`-- rls-check: skip — <reason>` to the CREATE TABLE line.\n'
  )
  process.exit(1)
}

console.log(
  `check-migration-rls: OK — ${createdTables.length} tables checked, all have RLS enabled.`
)
