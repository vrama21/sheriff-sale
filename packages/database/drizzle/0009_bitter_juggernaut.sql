DROP INDEX "Listing_propertyId_key";--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "county" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "StatusHistory" ALTER COLUMN "date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "StatusHistory" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "StatusHistory" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "Listing" ADD COLUMN "contentHash" text;--> statement-breakpoint
ALTER TABLE "Listing" ADD COLUMN "snapshotDate" date;--> statement-breakpoint
ALTER TABLE "StatusHistory" ADD COLUMN "firstSeenOn" date;--> statement-breakpoint
ALTER TABLE "StatusHistory" ADD COLUMN "lastSeenOn" date;