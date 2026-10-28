/**
 * Durable email/password storage via Firebase Identity Toolkit.
 * Survives Render filesystem wipes (JSON on ephemeral disk does not).
 */

function apiKey() {
  return (
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    'AIzaSyBcP319FVEOh66xsbNLmNNh4kBFBR1vGCo'
  );
}

async function call(path, body) {
  const key = apiKey();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return { ok: false, status: 504, data: { error: { message: 'TIMEOUT' } } };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function disabled(code) {
  return (
    code.includes('OPERATION_NOT_ALLOWED') ||
    code.includes('PASSWORD_LOGIN_DISABLED') ||
    code.includes('ADMIN_ONLY_OPERATION')
  );
}

export async function firebaseSignUp(email, password) {
  const { ok, data } = await call('accounts:signUp', {
    email,
    password,
    returnSecureToken: true,
  });
  if (ok) {
    return {
      localId: String(data.localId || ''),
      email: String(data.email || email).toLowerCase(),
      idToken: data.idToken,
    };
  }
  const code = String(data.error?.message || '');
  if (code.includes('EMAIL_EXISTS')) {
    throw Object.assign(new Error('Email already registered.'), { status: 409 });
  }
  if (code.includes('INVALID_EMAIL')) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  }
  if (code.includes('WEAK_PASSWORD')) {
    throw Object.assign(new Error('Password must be at least 8 characters.'), { status: 400 });
  }
  // Email/password provider off in Firebase console — caller should use local bcrypt store.
  if (disabled(code) || code.includes('TIMEOUT')) return null;
  throw Object.assign(new Error(data.error?.message || 'Could not create account.'), { status: 400 });
}

export async function firebaseSendPasswordReset(email) {
  const { ok, data } = await call('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email,
  });
  if (ok) return true;
  const code = String(data.error?.message || '');
  if (code.includes('EMAIL_NOT_FOUND')) return true;
  if (disabled(code) || code.includes('TIMEOUT')) return false;
  throw Object.assign(new Error('Could not send a reset email. Try again.'), { status: 400 });
}

export async function firebaseSignIn(email, password) {
  const { ok, data } = await call('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
  if (ok) {
    return {
      localId: String(data.localId || ''),
      email: String(data.email || email).toLowerCase(),
      displayName: data.displayName || null,
      idToken: data.idToken,
    };
  }
  const code = String(data.error?.message || '');
  if (code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
    return null;
  }
  if (disabled(code) || code.includes('TIMEOUT')) return null;
  throw Object.assign(new Error(data.error?.message || 'Could not sign in.'), { status: 400 });
}
