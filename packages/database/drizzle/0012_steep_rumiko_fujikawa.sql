CREATE TYPE "public"."ClerkDocCategory" AS ENUM('DEED', 'SHERIFF_DEED', 'MORTGAGE', 'MORTGAGE_ASSIGNMENT', 'MORTGAGE_DISCHARGE', 'MORTGAGE_MODIFICATION', 'LIS_PENDENS', 'LIS_PENDENS_DISCHARGE', 'FINAL_JUDGMENT', 'NOTICE_OF_SETTLEMENT', 'TAX_SALE_CERTIFICATE', 'LIEN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ClerkPartySide" AS ENUM('direct', 'indirect');--> statement-breakpoint
CREATE TYPE "public"."ClerkPlatform" AS ENUM('press');--> statement-breakpoint
CREATE TYPE "public"."ListingClerkConfidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."ListingClerkMatchedBy" AS ENUM('lis_pendens_party', 'parcel', 'cross_reference', 'mortgage_party');--> statement-breakpoint
CREATE TYPE "public"."ListingClerkOutcome" AS ENUM('matched', 'no_lis_pendens', 'unsupported', 'error', 'complete');--> statement-breakpoint
CREATE TYPE "public"."ListingClerkRole" AS ENUM('FORECLOSED_LIS_PENDENS', 'FORECLOSED_MORTGAGE', 'MORTGAGE_ASSIGNMENT', 'PRIOR_DEED', 'SHERIFF_DEED', 'RELATED');--> statement-breakpoint
CREATE TABLE "ClerkDocumentLink" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fromDocumentId" uuid NOT NULL,
	"toInstrumentNumber" text,
	"toBook" text,
	"toPage" text,
	"toDocumentId" uuid,
	CONSTRAINT "ClerkDocumentLink_from_target_key" UNIQUE NULLS NOT DISTINCT("fromDocumentId","toInstrumentNumber","toBook","toPage")
);
--> statement-breakpoint
CREATE TABLE "ClerkDocumentParty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentId" uuid NOT NULL,
	"side" "ClerkPartySide" NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ClerkDocument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county" varchar(256) NOT NULL,
	"instrumentNumber" text NOT NULL,
	"platform" "ClerkPlatform" NOT NULL,
	"docCategory" "ClerkDocCategory" NOT NULL,
	"docTypeRaw" text NOT NULL,
	"recordedDate" date NOT NULL,
	"bookType" text,
	"book" text,
	"page" text,
	"municipality" text,
	"block" text,
	"lot" text,
	"qualifier" text,
	"consideration" numeric(14, 2),
	"detail" jsonb,
	"firstSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ListingClerkDocument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listingId" text NOT NULL,
	"documentId" uuid NOT NULL,
	"role" "ListingClerkRole" NOT NULL,
	"matchedBy" "ListingClerkMatchedBy" NOT NULL,
	"confidence" "ListingClerkConfidence" NOT NULL,
	"firstMatchedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastConfirmedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ListingClerkLookup" (
	"listingId" text PRIMARY KEY NOT NULL,
	"platform" "ClerkPlatform",
	"lastCheckedAt" timestamp with time zone NOT NULL,
	"nextCheckAt" timestamp with time zone,
	"lastOutcome" "ListingClerkOutcome" NOT NULL,
	"consecutiveMisses" integer DEFAULT 0 NOT NULL,
	"consecutiveErrors" integer DEFAULT 0 NOT NULL,
	"lastError" text
);
--> statement-breakpoint
ALTER TABLE "ClerkDocumentLink" ADD CONSTRAINT "ClerkDocumentLink_fromDocumentId_ClerkDocument_id_fk" FOREIGN KEY ("fromDocumentId") REFERENCES "public"."ClerkDocument"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ClerkDocumentLink" ADD CONSTRAINT "ClerkDocumentLink_toDocumentId_ClerkDocument_id_fk" FOREIGN KEY ("toDocumentId") REFERENCES "public"."ClerkDocument"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ClerkDocumentParty" ADD CONSTRAINT "ClerkDocumentParty_documentId_ClerkDocument_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."ClerkDocument"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ListingClerkDocument" ADD CONSTRAINT "ListingClerkDocument_listingId_Listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."Listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ListingClerkDocument" ADD CONSTRAINT "ListingClerkDocument_documentId_ClerkDocument_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."ClerkDocument"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ListingClerkLookup" ADD CONSTRAINT "ListingClerkLookup_listingId_Listing_id_fk" FOREIGN KEY ("listingId") REFERENCES "public"."Listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ClerkDocumentParty_documentId_side_name_key" ON "ClerkDocumentParty" USING btree ("documentId","side","name");--> statement-breakpoint
CREATE INDEX "ClerkDocumentParty_normalizedName_idx" ON "ClerkDocumentParty" USING btree ("normalizedName");--> statement-breakpoint
CREATE UNIQUE INDEX "ClerkDocument_county_instrumentNumber_key" ON "ClerkDocument" USING btree ("county","instrumentNumber");--> statement-breakpoint
CREATE INDEX "ClerkDocument_county_block_lot_idx" ON "ClerkDocument" USING btree ("county","block","lot");--> statement-breakpoint
CREATE UNIQUE INDEX "ListingClerkDocument_listingId_documentId_key" ON "ListingClerkDocument" USING btree ("listingId","documentId");--> statement-breakpoint
CREATE INDEX "ListingClerkDocument_documentId_idx" ON "ListingClerkDocument" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "ListingClerkLookup_nextCheckAt_idx" ON "ListingClerkLookup" USING btree ("nextCheckAt");