CREATE TABLE IF NOT EXISTS "Listing" (
	"id" text PRIMARY KEY NOT NULL,
	"address" varchar(256),
	"attorney" varchar(256),
	"attorneyPhone" varchar(256),
	"city" varchar(256),
	"county" varchar(256),
	"courtCase" varchar(256),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deed" varchar(256),
	"deedAddress" varchar(256),
	"defendant" varchar(256),
	"description" varchar(256),
	"judgment" varchar(256),
	"latitude" varchar(256),
	"longitude" varchar(256),
	"mapsUrl" varchar(256),
	"parcel" varchar(256),
	"plaintiff" varchar(256),
	"propertyId" integer,
	"priors" varchar(256),
	"saleDate" varchar(256),
	"secondaryUnit" varchar(256),
	"sheriffId" integer,
	"state" varchar(256),
	"street" varchar(256),
	"unit" varchar(256),
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"upsetAmount" varchar(256),
	"zipcode" varchar(256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "StatusHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"listingId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"date" varchar(12),
	"status" varchar(256)
);
