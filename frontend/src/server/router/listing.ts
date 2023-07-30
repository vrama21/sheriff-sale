import { createRouter } from './context';
import { z } from 'zod';
import { prisma } from '../db/client';

export const listingRouter = createRouter().query('getListings', {
  input: z.object({
    county: z.string(),
    city: z.string().nullish(),
  }),
  async resolve({ input }) {
    console.log({ input });
    try {
      const listings = await prisma.listing.findMany({
        where: {
          county: input.county,
          // city: input.city,
        },
      });

      console.log(listings);

      return listings;
    } catch (error) {
      console.error('Failed to get listings', error);
    }
  },
});
