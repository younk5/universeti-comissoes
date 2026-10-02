import { Router } from 'express';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createDefaultCommissionRuleService } from '../services/default-commission-rule-service.js';

function defaultCommissionRuleInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { commissionType, commissionInput } = body;
  return Object.fromEntries(Object.entries({ commissionType, commissionInput })
    .filter(([, value]) => value !== undefined));
}

export function createDefaultCommissionRuleRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const defaultCommissionRule = services.defaultCommissionRule ?? (services.adminClient
    ? createDefaultCommissionRuleService({ adminClient: services.adminClient })
    : null);

  router.get('/commission-default-rule', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await defaultCommissionRule.list({ actor: request.actor }));
    } catch (error) {
      next(error);
    }
  });

  router.put('/commission-default-rule', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await defaultCommissionRule.update({
        actor: request.actor,
        input: defaultCommissionRuleInput(request.body),
      }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
