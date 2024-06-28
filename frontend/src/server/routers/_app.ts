/**
 * This file contains the root router of your tRPC-backend
 */
import { createCallerFactory, router } from '../trpc';
import { constantsRouter, listingRouter } from '.';

export const appRouter = router({
  constants: constantsRouter,
  listing: listingRouter,
});

export const createCaller = createCallerFactory(appRouter);

export type AppRouter = typeof appRouter;
