const QUESTION_IDS = ['air', 'water', 'food', 'climate', 'health', 'war', 'inequality', 'ai'];
const REGION_IDS = ['eu', 'as', 'na', 'sa', 'af', 'oc'];
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);

  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || undefined;
}

function isValidFingerprint(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 160;
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: false, status: 500, code: 'turnstile_not_configured' };
  }

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    return { ok: false, status: 502, code: 'turnstile_unavailable' };
  }

  const result = await response.json();
  if (!result.success) {
    return {
      ok: false,
      status: 403,
      code: 'turnstile_failed',
      errorCodes: result['error-codes'] || [],
    };
  }

  if (result.action && result.action !== 'vote') {
    return { ok: false, status: 403, code: 'turnstile_action_mismatch' };
  }

  const allowedHostnames = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (
    allowedHostnames.length > 0 &&
    !allowedHostnames.includes(String(result.hostname || '').toLowerCase())
  ) {
    return { ok: false, status: 403, code: 'turnstile_hostname_mismatch' };
  }

  return { ok: true };
}

function getSupabaseAdminConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) return null;

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseSecretKey,
  };
}

async function insertVote(questionId, regionId, fingerprint) {
  const config = getSupabaseAdminConfig();
  if (!config) {
    return { ok: false, status: 500, code: 'supabase_not_configured' };
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/votes`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: `Bearer ${config.supabaseSecretKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      question_id: questionId,
      region_id: regionId,
      fingerprint,
    }),
  });

  if (response.ok) return { ok: true };

  let error = null;
  try {
    error = await response.json();
  } catch {
    // Supabase normally returns JSON errors, but keep a stable fallback.
  }

  if (response.status === 409 || error?.code === '23505') {
    return { ok: false, status: 409, code: 'duplicate_vote' };
  }

  return { ok: false, status: 500, code: 'vote_insert_failed' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, code: 'method_not_allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const questionId = body.question_id;
    const regionId = body.region_id;
    const fingerprint = body.fingerprint;
    const turnstileToken = body.turnstileToken;

    if (!QUESTION_IDS.includes(questionId) || !REGION_IDS.includes(regionId)) {
      return sendJson(res, 400, { ok: false, code: 'invalid_vote_payload' });
    }

    if (!isValidFingerprint(fingerprint)) {
      return sendJson(res, 400, { ok: false, code: 'invalid_fingerprint' });
    }

    if (typeof turnstileToken !== 'string' || turnstileToken.length < 10) {
      return sendJson(res, 400, { ok: false, code: 'turnstile_token_missing' });
    }

    const turnstile = await verifyTurnstile(turnstileToken, getClientIp(req));
    if (!turnstile.ok) {
      return sendJson(res, turnstile.status, {
        ok: false,
        code: turnstile.code,
        errorCodes: turnstile.errorCodes,
      });
    }

    const insert = await insertVote(questionId, regionId, fingerprint);
    if (!insert.ok) {
      return sendJson(res, insert.status, { ok: false, code: insert.code });
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('Secure vote failed:', error);
    return sendJson(res, 500, { ok: false, code: 'unexpected_error' });
  }
}
