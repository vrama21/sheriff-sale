// src/server/router/index.ts
import { createRouter } from './context';
import superjson from 'superjson';

import { constantsRouter } from './constants';
import { listingRouter } from './listing';

export const appRouter = createRouter()
  .transformer(superjson)
  .merge('constants.', constantsRouter)
  .merge('listing.', listingRouter);

// export type definition of API
export type AppRouter = typeof appRouter;
