import { Router } from 'express';
import { UnauthorizedError } from '../errors.js';
import { requireActor } from '../middleware/auth.js';

const invalidLoginMessage = 'Usuário ou senha inválidos.';

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies === true,
    path: '/',
  };
}

export function setRefreshCookie(response, refreshToken, config) {
  response.cookie(config.sessionCookieName, refreshToken, cookieOptions(config));
}

export function clearRefreshCookie(response, config) {
  response.clearCookie(config.sessionCookieName, cookieOptions(config));
}

function refreshTokenFrom(request, config) {
  const cookieHeader = request.get('cookie');
  const cookie = cookieHeader?.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${config.sessionCookieName}=`));
  return cookie ? decodeURIComponent(cookie.slice(config.sessionCookieName.length + 1)) : undefined;
}

function bearerTokenFrom(request) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.get('authorization') ?? '');
  return match?.[1];
}

export function createAuthRouter({ services, config }) {
  const router = Router();
  router.use('/auth', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/auth/login', async (request, response, next) => {
    try {
      const { session, actor } = await services.session.login(request.body);
      setRefreshCookie(response, session.refresh_token, config);
      response.json({
        accessToken: session.access_token,
        expiresAt: session.expires_at,
        actor,
      });
    } catch (error) {
      if (error.code === 'INVALID_LOGIN') {
        return response.status(401).json({ message: invalidLoginMessage, code: 'INVALID_LOGIN' });
      }
      return next(error);
    }
  });

  router.post('/auth/refresh', async (request, response, next) => {
    try {
      const { session, actor } = await services.session.refresh({
        refreshToken: refreshTokenFrom(request, config),
      });
      setRefreshCookie(response, session.refresh_token, config);
      response.json({
        accessToken: session.access_token,
        expiresAt: session.expires_at,
        actor,
      });
    } catch (error) {
      clearRefreshCookie(response, config);
      next(error instanceof UnauthorizedError ? error : new UnauthorizedError());
    }
  });

  router.post('/auth/logout', async (request, response) => {
    try {
      await services.session.logout({ token: bearerTokenFrom(request) });
    } catch {
      // The browser cookie must be removed even if Supabase sign-out fails.
    }
    clearRefreshCookie(response, config);
    response.status(204).end();
  });

  router.post('/auth/password', requireActor(services), async (request, response, next) => {
    try {
      await services.session.changePassword({
        id: request.actor.id,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireActor(services), (request, response) => {
    response.json(request.actor);
  });

  return router;
}
