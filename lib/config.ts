import { z } from 'zod';

// Central, validated server configuration. Values are read from the process
// environment on each call so tests and restarts see current settings.
// Nothing in this module is ever sent to the browser except via publicConfig().
const bool = (fallback: boolean) => z.enum(['true', 'false', '']).optional().transform(v => (v === undefined || v === '' ? fallback : v === 'true'));
const int = (fallback: number, min: number, max: number) =>
  z.string().optional().transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: `must be an integer between ${min} and ${max}` });
      return z.NEVER;
    }
    return n;
  });
const optionalNumber = z.string().optional().transform((v, ctx) => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'must be a non-negative number' });
    return z.NEVER;
  }
  return n;
});
const optionalUrl = z.string().optional().transform((v, ctx) => {
  if (!v || !v.trim()) return null;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString().replace(/\/$/, '');
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be an http(s) URL' });
    return z.NEVER;
  }
});
const text = z.string().optional().transform(v => (v && v.trim() ? v.trim() : null));

const schema = z.object({
  NODE_ENV: z.string().optional(),
  DEPLOYMENT_PROFILE: z.enum(['local', 'hosted', '']).optional().transform(v => v || 'local'),
  APP_ORIGIN: optionalUrl,
  COOKIE_SECURE: z.enum(['auto', 'true', 'false', '']).optional().transform(v => v || 'auto'),
  SESSION_HOURS: int(12, 1, 168),
  SESSION_IDLE_MINUTES: int(120, 5, 10080),
  INVITATION_HOURS: int(72, 1, 336),
  PASSWORD_RESET_MINUTES: int(30, 5, 240),
  PASSWORD_LOGIN: bool(true),
  MAIL_TRANSPORT: z.enum(['file', 'smtp', 'disabled', '']).optional().transform(v => v || 'file'),
  MAIL_OUTBOX_DIR: text,
  SMTP_URL: text,
  MAIL_FROM: text,
  OIDC_ISSUER: optionalUrl,
  OIDC_CLIENT_ID: text,
  OIDC_CLIENT_SECRET: text,
  OIDC_REDIRECT_URI: optionalUrl,
  OIDC_SCOPES: text,
  OIDC_DISPLAY_NAME: text,
  OIDC_ALLOWED_DOMAINS: text,
  OIDC_ALLOW_HTTP_ISSUER: bool(false),
  AGENT_MODE: z.enum(['demo', 'live', '']).optional().transform(v => v || 'demo'),
  OPENAI_API_KEY: text,
  OPENAI_MODEL: text,
  OPENAI_BASE_URL: optionalUrl,
  AGENT_MODEL_TIMEOUT_MS: int(8000, 1000, 30000),
  AGENT_MAX_OUTPUT_TOKENS: int(350, 64, 4000),
  MODEL_INPUT_USD_PER_MILLION: optionalNumber,
  MODEL_OUTPUT_USD_PER_MILLION: optionalNumber,
  STORAGE_DRIVER: z.enum(['local', 's3', '']).optional().transform(v => v || 'local'),
  STORAGE_LOCAL_DIR: text,
  S3_BUCKET: text,
  S3_REGION: text,
  S3_ENDPOINT: optionalUrl,
  S3_FORCE_PATH_STYLE: bool(false),
  S3_PREFIX: text,
  ATTACHMENT_MAX_BYTES: int(10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  ATTACHMENTS_PER_INCIDENT: int(50, 1, 500),
  ATTACHMENT_PURGE_DAYS: int(30, 1, 3650),
  TELEMETRY_MAX_AGE_DAYS: int(30, 1, 3650),
  TELEMETRY_MAX_FUTURE_SECONDS: int(300, 0, 3600),
  TELEMETRY_BATCH_MAX: int(500, 1, 5000),
  TELEMETRY_RETENTION_DAYS: int(0, 0, 36500),
});

export type AppConfig = z.output<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): { config: AppConfig | null; issues: string[] } {
  const parsed = schema.safeParse(env);
  if (!parsed.success) return { config: null, issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  const c = parsed.data;
  const issues: string[] = [];
  // 'hosted' = reachable by other machines. 'local' = loopback-only workstation use (the default).
  const hosted = c.DEPLOYMENT_PROFILE === 'hosted';
  if (c.AGENT_MODE === 'live') {
    if (!c.OPENAI_API_KEY) issues.push('AGENT_MODE=live requires OPENAI_API_KEY');
    if (!c.OPENAI_MODEL) issues.push('AGENT_MODE=live requires OPENAI_MODEL');
    if ((c.MODEL_INPUT_USD_PER_MILLION === null) !== (c.MODEL_OUTPUT_USD_PER_MILLION === null)) issues.push('Set both MODEL_INPUT_USD_PER_MILLION and MODEL_OUTPUT_USD_PER_MILLION, or neither');
  }
  const ssoValues = [c.OIDC_ISSUER, c.OIDC_CLIENT_ID, c.OIDC_CLIENT_SECRET];
  if (ssoValues.some(Boolean) && !ssoValues.every(Boolean)) issues.push('SSO requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together');
  if (c.OIDC_ISSUER && c.OIDC_ISSUER.startsWith('http:') && !c.OIDC_ALLOW_HTTP_ISSUER) issues.push('OIDC_ISSUER must use https (set OIDC_ALLOW_HTTP_ISSUER=true only for local test identity providers)');
  if (c.OIDC_ISSUER && !c.OIDC_REDIRECT_URI && !c.APP_ORIGIN) issues.push('SSO requires APP_ORIGIN or OIDC_REDIRECT_URI');
  if (!c.PASSWORD_LOGIN && !c.OIDC_ISSUER) issues.push('PASSWORD_LOGIN=false requires SSO to be configured');
  if (c.MAIL_TRANSPORT === 'smtp' && !c.SMTP_URL) issues.push('MAIL_TRANSPORT=smtp requires SMTP_URL');
  if (c.STORAGE_DRIVER === 's3' && (!c.S3_BUCKET || !c.S3_REGION)) issues.push('STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION');
  if (hosted) {
    if (!c.APP_ORIGIN) issues.push('DEPLOYMENT_PROFILE=hosted requires APP_ORIGIN (the public https origin)');
    else if (!c.APP_ORIGIN.startsWith('https:')) issues.push('DEPLOYMENT_PROFILE=hosted requires an https APP_ORIGIN');
    if (c.COOKIE_SECURE === 'false') issues.push('COOKIE_SECURE=false is not allowed when hosted');
    if (env.AUTH_MODE === 'demo' || env.ALLOW_DEMO_LOGIN === 'true') issues.push('Demo identity switching must be disabled when hosted');
  } else if (c.APP_ORIGIN && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(c.APP_ORIGIN) && !c.APP_ORIGIN.startsWith('https:')) {
    issues.push('A non-loopback APP_ORIGIN must use https (set DEPLOYMENT_PROFILE=hosted for shared deployments)');
  }
  return { config: c, issues };
}

export function config(): AppConfig {
  const { config: c, issues } = loadConfig();
  if (!c) throw new Error(`Invalid configuration: ${issues.join('; ')}`);
  return c;
}

export function configIssues(): string[] {
  return loadConfig().issues;
}

export function ssoEnabled(c: AppConfig = config()) {
  return !!(c.OIDC_ISSUER && c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET);
}

export function publicConfig() {
  const c = config();
  return {
    passwordLogin: c.PASSWORD_LOGIN,
    sso: ssoEnabled(c) ? { name: c.OIDC_DISPLAY_NAME ?? 'Single sign-on' } : null,
    passwordRecovery: c.PASSWORD_LOGIN && c.MAIL_TRANSPORT !== 'disabled',
    attachmentMaxBytes: c.ATTACHMENT_MAX_BYTES,
  };
}
