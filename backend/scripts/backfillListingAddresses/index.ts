/**
 * Plans the listing address backfill from a read-only export of prod, and writes its migration and review report.
 * It never connects to a database.
 *
 * Usage: tsx backend/scripts/backfillListingAddresses/index.ts <export.json> <migration.sql> <report.csv>
 *
 * The export is the JSON array from
 *   .claude/skills/db-query/scripts/query.sh --env prod --json \
 *     'SELECT id, county, state, address, city, street, zipcode, unit, "secondaryUnit", "saleDate" FROM "Listing"'
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { toMigrationSql, toReportCsv, summarize } from './output';
import { assertAllInNj, ExportedListing, planRow } from './plan';

const [exportPath, migrationPath, reportPath] = process.argv.slice(2);

if (!exportPath || !migrationPath || !reportPath) {
  console.error(
    'Usage: tsx backend/scripts/backfillListingAddresses/index.ts <export.json> <migration.sql> <report.csv>',
  );
  process.exit(2);
}

const rows: ExportedListing[] = JSON.parse(readFileSync(exportPath, 'utf8'));

assertAllInNj(rows);

const plans = rows.map(planRow);

writeFileSync(reportPath, toReportCsv(plans));
writeFileSync(migrationPath, toMigrationSql(plans));

const summary = summarize(plans);

console.log(`Rows exported:         ${summary.exported} (every state is NJ)`);
console.log(`Already correct:       ${summary.alreadyCorrect}`);
console.log(`Planned updates:       ${summary.plannedUpdates}`);

for (const [outcome, count] of Object.entries(summary.plannedByOutcome)) {
  console.log(`  ${`${outcome}:`.padEnd(20)} ${count}`);
}

console.log('Rows by outcome:');

for (const [outcome, count] of Object.entries(summary.rowsByOutcome)) {
  console.log(`  ${`${outcome}:`.padEnd(20)} ${count}`);
}

console.log(
  `City: ${summary.city.filled} filled, ${summary.city.corrected} corrected, ` +
    `${summary.city.cleared} set to NULL, ${summary.city.unchanged} unchanged`,
);
console.log(`Wrote ${migrationPath} and ${reportPath}`);
