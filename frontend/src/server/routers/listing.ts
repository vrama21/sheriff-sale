import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { db } from '@sheriff-sale/database';

export const listingRouter = router({
  list: publicProcedure
    .input(
      z.object({
        county: z.string(),
        city: z.string().nullish(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const listings = await db.query.listings.findMany({
          where: (listings, { eq }) => eq(listings.county, input.county),
        });

        return listings;
      } catch (error) {
        console.error('Failed to get listings', error);
      }
    }),
});
