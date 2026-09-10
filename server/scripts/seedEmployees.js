// Populates the "employee_list" collection with the staff roster.
//
// Usage:
//   npm run seed:employees              -- writes to the database
//   npm run seed:employees -- --dry-run -- prints what it WOULD do, no connection
//
// The script is ADDITIVE and IDEMPOTENT: each name is upserted by name, so
// running it twice does not duplicate anyone, and it never deletes a name that
// is already there. Re-run it freely after editing the list below.
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

// Must run before mongoose tries to resolve the mongodb+srv:// SRV record.
require('../config/dns').applyDnsServers();

// ---------------------------------------------------------------------------
// The roster. Add or remove names here and re-run.
// ---------------------------------------------------------------------------
const NAMES = [
  'Gary Villame',
  'Mark Gil Manalangsang',
  'Diet Flores',
  'Wilbert Guliman',
  'Bryan Brett Belandres',
  'Jordan Reyes',
  'Charmeine Joy Lopez',
  'Ryan Jalandoni',
  'Joshua Estrella',
  'Danica Mantilla',
  'Jerald Reyes',
  'Paul Decierdo',
  'Ma. Angelica Talabucon',
  'Gregg Marionn Icay',
  'Ma. Monica Barles',
  'Charles Patrick Agsaway',
  'Vyette Charisse Bacaoco',
  'Jessa Mae Magsanay',
  'Aimae Florentino',
  'Rina Joyce De La Rosa',
  'Marie Mar Nonifara',
  'May Kyrielle Durana',
  'Ana Marie Bonto',
  'Preximer Cajipe',
  'Ariane Adecir',
  'Justine Mae Remollena',
  'Patricia Mae Maturan',
  'Arsel Ibrahim',
  'Julie Ann Repani',
  'Vher Jason Secretaria',
  'Angelo Adajar',
  'Christine Maclang',
  'Korina Allare',
  'Janelle Gaven',
  'Mark Luiz Bobis',
  'Khyle Monares',
  'Reeva Esperas',
  'Ana Marie Ensenas',
  'Dexter Valenzuela',
  'Adrian Stephen De Los Reyes',
  'Arianne Faith Mirasol',
  'Jerviz Mico Jimenez',
  'Myls Denise Rosel',
  'Joshua Maligsay',
  'Maria Keziah Locsin',
  'Nivani Andrea Lasala',
  'Josie Mae Abrecinos',
  'Deither Mantilla',
  'Jairelle Copreros',
];

const DRY_RUN = process.argv.includes('--dry-run');

/** Trims and collapses runs of internal whitespace to a single space. */
function normalize(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

/**
 * Cleans the list and reports anything worth knowing before it is written:
 * names whose whitespace was fixed, exact duplicates, and case-only
 * duplicates (which a plain unique index would happily let through).
 */
function prepare(rawNames) {
  const cleaned = [];
  const changed = [];
  const duplicates = [];
  const caseClashes = [];
  const seen = new Map(); // lowercased -> the spelling already kept

  rawNames.forEach((raw) => {
    const name = normalize(raw);
    if (!name) return;
    if (name !== raw) changed.push({ from: raw, to: name });

    const key = name.toLowerCase();
    if (seen.has(key)) {
      const kept = seen.get(key);
      if (kept === name) duplicates.push(name);
      else caseClashes.push({ kept, dropped: name });
      return;
    }
    seen.set(key, name);
    cleaned.push(name);
  });

  return { cleaned, changed, duplicates, caseClashes };
}

async function main() {
  const { cleaned, changed, duplicates, caseClashes } = prepare(NAMES);

  console.log(`Roster: ${NAMES.length} entries supplied, ${cleaned.length} unique names to write.`);

  if (changed.length) {
    console.log('\nWhitespace normalised:');
    changed.forEach((c) => console.log(`  "${c.from}" -> "${c.to}"`));
  }
  if (duplicates.length) {
    console.log('\nExact duplicates skipped:');
    duplicates.forEach((d) => console.log(`  ${d}`));
  }
  if (caseClashes.length) {
    console.log('\nSame name in different case -- kept the first spelling:');
    caseClashes.forEach((c) => console.log(`  kept "${c.kept}", skipped "${c.dropped}"`));
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing was written. Names that would be upserted:');
    cleaned.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n}`));
    return;
  }

  const dbName = process.env.MONGO_DB_NAME || 'lineup';
  await mongoose.connect(process.env.MONGO_URI, { dbName });
  console.log(`\nConnected to MongoDB database "${dbName}".`);

  // Upsert by name: existing rows are left exactly as they are, missing ones
  // are created. `$setOnInsert` means a re-run never rewrites createdAt.
  const result = await Employee.bulkWrite(
    cleaned.map((name) => ({
      updateOne: {
        filter: { name },
        update: { $setOnInsert: { name } },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  const inserted = result.upsertedCount || 0;
  console.log(`Inserted ${inserted} new name(s); ${cleaned.length - inserted} were already present.`);

  // A unique index keeps the roster clean if anyone inserts by hand later.
  // Built after the data so it cannot block the seed itself.
  try {
    await Employee.collection.createIndex({ name: 1 }, { unique: true, name: 'name_unique' });
    console.log('Unique index on "name" is in place.');
  } catch (err) {
    console.log(`Could not create the unique index (${err.code || err.name}). ` +
      'This usually means duplicate names already exist in the collection -- ' +
      'the names above were still written.');
  }

  const total = await Employee.countDocuments();
  console.log(`\n"employee_list" now holds ${total} document(s).`);

  const sample = await Employee.find()
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .limit(5)
    .lean();
  console.log('First five alphabetically:');
  sample.forEach((e) => console.log(`  ${e.name}`));

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed employees failed:', err.message);
    if (/querySrv|ECONNREFUSED|ETIMEOUT|ServerSelection/i.test(err.message || '')) {
      console.error('That looks like a network or DNS problem reaching Atlas rather than a data ' +
        'problem. DNS_SERVERS in .env can override the resolver (see server/config/dns.js).');
    }
    process.exit(1);
  });
