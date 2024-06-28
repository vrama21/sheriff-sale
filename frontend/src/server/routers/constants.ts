import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { CITIES_BY_COUNTY_MAPPING } from '../data';

export const constantsRouter = router({
  get: publicProcedure.input(z.object({ text: z.string().nullish() })).query(({ input }) => {
    return CITIES_BY_COUNTY_MAPPING;
  }),
});
