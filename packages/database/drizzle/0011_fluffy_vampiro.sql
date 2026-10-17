ALTER TABLE "StatusHistory" ALTER COLUMN "firstSeenOn" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "StatusHistory" ALTER COLUMN "lastSeenOn" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Listing_county_sheriffId_key" ON "Listing" USING btree ("county","sheriffId");--> statement-breakpoint
CREATE UNIQUE INDEX "StatusHistory_listingId_status_date_key" ON "StatusHistory" USING btree ("listingId","status","date");