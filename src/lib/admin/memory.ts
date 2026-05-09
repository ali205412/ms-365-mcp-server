import { Router } from 'express';
import type { AdminRouterDeps } from './router.js';
import { createMemoryBookmarkRoutes } from './memory-bookmarks.js';
import { createMemoryFactRoutes } from './memory-facts.js';
import { createMemoryRecipeRoutes } from './memory-recipes.js';

export function createMemoryRoutes(deps: Pick<AdminRouterDeps, 'redis'>): Router {
  const r = Router();

  r.use(createMemoryBookmarkRoutes(deps));
  r.use(createMemoryRecipeRoutes(deps));
  r.use(createMemoryFactRoutes(deps));

  return r;
}
