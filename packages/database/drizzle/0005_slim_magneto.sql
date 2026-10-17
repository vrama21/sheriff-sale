ALTER TABLE "Listing" ALTER COLUMN "address" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "attorney" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "courtCase" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "deedAddress" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "defendant" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "description" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "judgment" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "parcel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "plaintiff" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "propertyId" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "priors" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "sheriffId" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "upsetAmount" SET DATA TYPE text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Listing_propertyId_key" ON "Listing" USING btree ("propertyId");