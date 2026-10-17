## REMOVED Requirements

### Requirement: Recover the street and city boundary
**Reason**: The one-off address backfill has run. Its migration, `0006_backfill_listing_addresses.sql`, is applied in prod, and the script that generated it is deleted.
**Migration**: None needed. The repaired rows are in the database, and the migration SQL stays in `packages/database/drizzle/` as history. New scrapes split addresses with `shared/address`'s `parseAddress`.

### Requirement: Re-separate glued unit lines
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Normalize like a new scrape
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied. Scrapes keep normalizing addresses through `parseAddress`.

### Requirement: Unknown city is NULL
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Address whitespace
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Sale date whitespace
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Plan only real changes
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Review report
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied.

### Requirement: Guarded, re-runnable update
**Reason**: Part of the completed one-off backfill; the script is deleted.
**Migration**: None needed; migration `0006` has been applied, and the SQL file is kept so a fresh database replays it.
