import { createRouter } from './context';
import { z } from 'zod';
import { CITIES_BY_COUNTY_MAPPING } from '../data';

export const constantsRouter = createRouter().query('getCitiesByCountyMapping', {
  input: z
    .object({
      text: z.string().nullish(),
    })
    .nullish(),
  resolve({ input }) {
    return CITIES_BY_COUNTY_MAPPING;
  },
});
