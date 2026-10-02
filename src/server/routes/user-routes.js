import { Router } from 'express';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createUserService } from '../services/user-service.js';

export function createUserRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const users = services.users ?? (services.adminClient
    ? createUserService({ adminClient: services.adminClient, now: services.now })
    : null);

  router.get('/users', ...authorizeAdmin, async (_request, response, next) => {
    try {
      response.json(await users.listSellers(_request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.post('/users', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.status(201).json(await users.createSeller(request.body, request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/users/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await users.updateSeller(request.params.id, request.body, request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:id/disable', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      response.set('Cache-Control', 'no-store').json(await users.setSellerActive(request.params.id, false, request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:id/enable', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await users.setSellerActive(request.params.id, true, request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:id/reset-password', ...authorizeAdmin, async (request, response, next) => {
    try {
      const result = await users.resetSellerPassword(request.params.id, request.actor);
      response.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/users/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      await users.deleteSeller(request.params.id, request.actor);
      response.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
