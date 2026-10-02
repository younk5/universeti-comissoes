import { Router } from 'express';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createAdministratorService } from '../services/admin-service.js';

export function createAdministratorRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const administrators = services.administrators ?? (services.adminClient
    ? createAdministratorService({ adminClient: services.adminClient, now: services.now })
    : null);

  router.get('/admins', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await administrators.listAdministrators(request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admins', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.status(201).json(await administrators.createAdministrator(request.body, request.actor));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/admins/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      await administrators.archiveAdministrator(request.params.id, request.actor);
      response.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
