// src/server/router/index.ts
import { createRouter } from './context';
import superjson from 'superjson';

import { exampleRouter } from './example';
import { constantsRouter } from './constants';

export const appRouter = createRouter()
  .transformer(superjson)
  .merge('example.', exampleRouter)
  .merge('constants.', constantsRouter);

// export type definition of API
export type AppRouter = typeof appRouter;
