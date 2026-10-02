import { AppError } from '../errors.js';
import { normalizeIdentifier, validatePassword } from '../domain/validation.js';

const profileColumns = 'id, email, username, display_name, role, active, session_not_before';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionClaims(accessToken) {
  const payload = accessToken?.split('.')[1];
  if (!payload) throw invalidLogin();

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.session_id !== 'string' || !uuidPattern.test(claims.session_id)) throw invalidLogin();
    if (!Number.isFinite(claims.iat)) throw invalidLogin();
    return claims;
  } catch (error) {
    if (error?.code === 'INVALID_LOGIN') throw error;
    throw invalidLogin();
  }
}

function invalidLogin() {
  return new AppError('Usuário ou senha inválidos.', {
    status: 401,
    code: 'INVALID_LOGIN',
  });
}

function actorFromProfile(profile) {
  if (!profile?.id || !profile.active || !profile.role || !profile.display_name || !profile.username) {
    throw invalidLogin();
  }

  return {
    id: profile.id,
    role: profile.role,
    name: profile.display_name,
    username: profile.username,
    active: profile.active,
  };
}

export function createSessionService({ authClient, adminClient, now = () => new Date() }) {
  async function activeProfile(filter) {
    const { data, error } = await adminClient
      .from('profiles')
      .select(profileColumns)
      .eq(...filter)
      .eq('active', true)
      .maybeSingle();

    if (error || !data) throw invalidLogin();
    return data;
  }

  async function actorForSession(session) {
    const { data, error } = await authClient.auth.getUser(session?.access_token);
    const id = data?.user?.id;
    if (error || !id) throw invalidLogin();

    const claims = sessionClaims(session.access_token);
    if (claims.sub && claims.sub !== id) throw invalidLogin();

    const profile = await activeProfile(['id', id]);
    const sessionNotBefore = Date.parse(profile.session_not_before);
    if (!Number.isFinite(sessionNotBefore)) throw invalidLogin();
    if (claims.iat * 1000 < sessionNotBefore) throw invalidLogin();

    const actor = actorFromProfile(profile);
    const { error: registryError } = await adminClient.from('app_session_registry').upsert(
      { session_id: claims.session_id, user_id: id },
      { onConflict: 'session_id', ignoreDuplicates: true },
    );
    if (registryError) throw invalidLogin();
    return actor;
  }

  async function verifyCurrentPassword({ id, password }) {
    const profile = await activeProfile(['id', id]);
    const { data, error } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (error || data?.user?.id !== id) {
      throw new AppError('Senha atual inválida.', {
        status: 400,
        code: 'INVALID_CURRENT_PASSWORD',
      });
    }
  }

  return {
    async confirmPassword({ id, password }) {
      await verifyCurrentPassword({ id, password });
    },

    async logout({ token }) {
      if (!token) return;
      try {
        const { data, error } = await authClient.auth.getUser(token);
        const id = data?.user?.id;
        if (error || !id) return;
        await adminClient.auth.admin.signOut(token, 'global');
        await adminClient.from('profiles')
          .update({ session_not_before: now().toISOString() })
          .eq('id', id);
      } catch {
        // Logout is best effort; the router always clears the refresh cookie.
      }
    },

    async changePassword({ id, currentPassword, newPassword }) {
      await verifyCurrentPassword({ id, password: currentPassword });

      let password;
      try {
        password = validatePassword(newPassword);
      } catch (error) {
        throw new AppError(error.message, { status: 400, code: 'INVALID_PASSWORD' });
      }
      const update = await adminClient.auth.admin.updateUserById(id, { password });
      if (update.error) throw update.error;
      const { error: sessionError } = await adminClient.from('profiles')
        .update({ session_not_before: now().toISOString() })
        .eq('id', id);
      if (sessionError) throw sessionError;
    },

    async refresh({ refreshToken }) {
      try {
        if (!refreshToken) throw invalidLogin();
        const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
        const session = data?.session;
        if (error || !session) throw invalidLogin();
        return { session, actor: await actorForSession(session) };
      } catch (error) {
        if (error?.code === 'INVALID_LOGIN') throw error;
        throw invalidLogin();
      }
    },

    async login({ identifier, password }) {
      try {
        const normalizedIdentifier = normalizeIdentifier(identifier);
        if (!normalizedIdentifier) throw invalidLogin();
        const email = normalizedIdentifier.includes('@')
          ? normalizedIdentifier
          : (await activeProfile(['username_normalized', normalizedIdentifier])).email;
        if (!email) throw invalidLogin();

        const { data, error } = await authClient.auth.signInWithPassword({ email, password });
        const session = data?.session;
        if (error || !session) throw invalidLogin();

        return { session, actor: await actorForSession(session) };
      } catch (error) {
        if (error?.code === 'INVALID_LOGIN') throw error;
        throw invalidLogin();
      }
    },
  };
}
