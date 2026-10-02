import { Router } from 'express';
import { buildCsv } from '../domain/csv.js';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createCommissionService } from '../services/commission-service.js';

export function createCommissionRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const commissions = services.commissions ?? (services.adminClient
    ? createCommissionService({ adminClient: services.adminClient, now: services.now })
    : null);

  router.post('/commissions', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.status(201).json(await commissions.create({ actor: request.actor, input: request.body }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/commissions/mark-paid', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await commissions.markPaid({
        actor: request.actor,
        commissionIds: request.body?.ids,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/commissions/export.csv', requireActor(services), async (request, response, next) => {
    try {
      const { items } = await commissions.listCommissions({
        actor: request.actor,
        filters: { ...request.query },
      });
      response
        .set('Cache-Control', 'no-store')
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', 'attachment; filename="comissoes.csv"')
        .send(buildCsv(items));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/commissions/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await commissions.update({
        actor: request.actor,
        id: request.params.id,
        input: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/commissions/:id/void', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      await commissions.voidCommission({ actor: request.actor, id: request.params.id });
      response.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete('/commissions/:id', ...authorizeAdmin, async (request, response, next) => {
    try {
      await services.session.confirmPassword({
        id: request.actor.id,
        password: request.body?.password,
      });
      await commissions.deleteCommission({ actor: request.actor, id: request.params.id });
      response.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/wallet', requireActor(services), async (request, response, next) => {
    try {
      response.json(await commissions.wallet({ actor: request.actor, filters: { ...request.query } }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/commissions', requireActor(services), async (request, response, next) => {
    try {
      response.json(await commissions.listCommissions({ actor: request.actor, filters: { ...request.query } }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
