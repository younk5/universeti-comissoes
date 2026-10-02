import { Router } from 'express';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createProductService } from '../services/product-service.js';

function productInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { name, commissionType, commissionInput } = body;
  return Object.fromEntries(Object.entries({ name, commissionType, commissionInput })
    .filter(([, value]) => value !== undefined));
}

export function createProductRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const products = services.products ?? (services.adminClient
    ? createProductService({ adminClient: services.adminClient })
    : null);

  router.get('/products', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await products.list({
        actor: request.actor,
        includeInactive: request.query.includeInactive === 'true',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/products', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.status(201).json(await products.create({
        actor: request.actor,
        input: productInput(request.body),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/products/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await products.update({
        actor: request.actor,
        id: request.params.id,
        input: productInput(request.body),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/products/:id/deactivate', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await products.setActive({ actor: request.actor, id: request.params.id, active: false }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/products/:id/activate', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await products.setActive({ actor: request.actor, id: request.params.id, active: true }));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/products/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      await products.remove({ actor: request.actor, id: request.params.id });
      response.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
