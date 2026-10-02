import { Router } from 'express';
import { buildBackupWorkbook } from '../domain/backup.js';
import { requireActor, requireAdmin } from '../middleware/auth.js';
import { createCommissionService } from '../services/commission-service.js';
import { createUserService } from '../services/user-service.js';

export function createAdminOperationsRouter({ services }) {
  const router = Router();
  const authorizeAdmin = [requireActor(services), requireAdmin];
  const commissions = services.commissions ?? (services.adminClient
    ? createCommissionService({ adminClient: services.adminClient, now: services.now })
    : null);
  const users = services.users ?? (services.adminClient
    ? createUserService({ adminClient: services.adminClient, now: services.now })
    : null);

  router.get('/audit-events', ...authorizeAdmin, async (request, response, next) => {
    try {
      response.json(await commissions.listAuditEvents({
        actor: request.actor,
        filters: { ...request.query },
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/backup.xlsx', ...authorizeAdmin, async (request, response, next) => {
    try {
      const [sellers, commissionResult, auditResult] = await Promise.all([
        users.listSellers(request.actor, { includeArchived: true }),
        commissions.listCommissions({ actor: request.actor, filters: {}, includeArchived: true }),
        commissions.listAuditEvents({ actor: request.actor, filters: {} }),
      ]);
      const workbook = buildBackupWorkbook({
        generatedAt: new Date().toISOString(),
        sellers,
        commissions: commissionResult.items,
        auditEvents: auditResult.items,
      });
      response
        .set('Cache-Control', 'no-store')
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .set('Content-Disposition', 'attachment; filename="galaxy-smart-backup.xlsx"')
        .send(workbook);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
