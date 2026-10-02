import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './errors.js';
import { createAuthenticateRequest } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth-routes.js';
import { createUserRouter } from './routes/user-routes.js';
import { createAdministratorRouter } from './routes/administrator-routes.js';
import { createCommissionRouter } from './routes/commission-routes.js';
import { createAdminOperationsRouter } from './routes/admin-operations-routes.js';
import { createProductRouter } from './routes/product-routes.js';
import { createDefaultCommissionRuleRouter } from './routes/default-commission-rule-routes.js';
import { createSessionService } from './services/session-service.js';

function composeServices(services) {
  const { authClient, adminClient } = services;
  if (!authClient || !adminClient) return services;

  return {
    ...services,
    session: services.session ?? createSessionService({
      authClient,
      adminClient,
      now: services.now,
    }),
    authenticateRequest: services.authenticateRequest ?? createAuthenticateRequest({
      authClient,
      adminClient,
      now: services.now,
    }),
  };
}

export function createApp({ services, config }) {
  const app = express();
  const runtimeServices = composeServices(services);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        defaultSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/api', createAuthRouter({ services: runtimeServices, config }));
  app.use('/api', createUserRouter({ services: runtimeServices }));
  app.use('/api', createAdministratorRouter({ services: runtimeServices }));
  app.use('/api', createCommissionRouter({ services: runtimeServices }));
  app.use('/api', createAdminOperationsRouter({ services: runtimeServices }));
  app.use('/api', createProductRouter({ services: runtimeServices }));
  app.use('/api', createDefaultCommissionRuleRouter({ services: runtimeServices }));
  app.use(errorHandler);

  return app;
}
