import { UnauthorizedError } from '../errors.js';

const profileColumns = 'id, username, display_name, role, active, session_not_before';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actorFromProfile(profile) {
  if (!profile?.id || profile.active !== true || !profile.role || !profile.display_name || !profile.username) {
    throw new UnauthorizedError();
  }

  return {
    id: profile.id,
    role: profile.role,
    name: profile.display_name,
    username: profile.username,
    active: profile.active,
  };
}

function decodeVerifiedToken(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new UnauthorizedError();

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(claims.iat) || typeof claims.session_id !== 'string' || !uuidPattern.test(claims.session_id)) {
      throw new UnauthorizedError();
    }
    return claims;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError();
  }
}

export function createAuthenticateRequest({ authClient, adminClient, now = () => new Date() }) {
  void now;

  return async function authenticateRequest({ token }) {
    if (!token) throw new UnauthorizedError('Sessão necessária.');
    const { data, error } = await authClient.auth.getUser(token);
    const id = data?.user?.id;
    if (error || !id) throw new UnauthorizedError();

    const claims = decodeVerifiedToken(token);
    if (claims.sub && claims.sub !== id) throw new UnauthorizedError();

    const { data: registrySession, error: registryError } = await adminClient
      .from('app_session_registry')
      .select('session_id')
      .eq('session_id', claims.session_id)
      .eq('user_id', id)
      .is('revoked_at', null)
      .maybeSingle();
    if (registryError || !registrySession) throw new UnauthorizedError();

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select(profileColumns)
      .eq('id', id)
      .eq('active', true)
      .maybeSingle();
    if (profileError || !profile) throw new UnauthorizedError();

    const sessionNotBefore = Date.parse(profile.session_not_before);
    if (!Number.isFinite(sessionNotBefore)) throw new UnauthorizedError();
    if (claims.iat * 1000 < sessionNotBefore) throw new UnauthorizedError('Sessão expirada.');

    return actorFromProfile(profile);
  };
}

export function requireActor(services) {
  const authenticateRequest = services.authenticateRequest
    ?? (services.auth?.verifyActor
      ? async ({ token }) => services.auth.verifyActor(token)
      : createAuthenticateRequest({
        authClient: services.authClient,
        adminClient: services.adminClient,
        now: services.now,
      }));

  return async (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(request.get('authorization') ?? '');
    if (!match) {
      return response.status(401).json({ message: 'Sessão necessária.' });
    }

    try {
      request.actor = await authenticateRequest({ token: match[1] });
      return next();
    } catch (error) {
      const message = error instanceof UnauthorizedError ? error.message : 'Sessão inválida ou expirada.';
      return response.status(401).json({ message });
    }
  };
}

export function requireAdmin(request, response, next) {
  return request.actor?.role === 'admin' && request.actor.active === true
    ? next()
    : response.status(403).json({ message: 'Acesso permitido somente à administração.' });
}
