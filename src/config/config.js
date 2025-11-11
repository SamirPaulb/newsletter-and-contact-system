/**
 * Centralized configuration module for the Cloudflare Workers Newsletter & Contact Management System
 */

function withColon(p) {
  const s = String(p || '');
  return s.endsWith(':') ? s : s + ':';
}

export function buildConfig(env) {
  // Email Provider Configuration
  let EMAIL_PROVIDER = '';
  if (env && env.EMAIL_PROVIDER) EMAIL_PROVIDER = String(env.EMAIL_PROVIDER).toLowerCase();

  // Gmail Configuration (for worker-mailer)
  let GMAIL_USER = '';
  if (env && env.GMAIL_USER) GMAIL_USER = String(env.GMAIL_USER);

  let GMAIL_PASSWORD = '';
  if (env && env.GMAIL_PASSWORD) GMAIL_PASSWORD = String(env.GMAIL_PASSWORD);

  let GMAIL_HOST = '';
  if (env && env.GMAIL_HOST) GMAIL_HOST = String(env.GMAIL_HOST);

  let GMAIL_PORT = 0;
  if (env && env.GMAIL_PORT) GMAIL_PORT = parseInt(String(env.GMAIL_PORT), 10);

  // Worker Email Configuration
  let WORKER_EMAIL_FROM = '';
  if (env && env.WORKER_EMAIL_FROM) WORKER_EMAIL_FROM = String(env.WORKER_EMAIL_FROM);

  let WORKER_EMAIL_DOMAIN = '';
  if (env && env.WORKER_EMAIL_DOMAIN) WORKER_EMAIL_DOMAIN = String(env.WORKER_EMAIL_DOMAIN);

  // MailerLite Configuration
  let MAILERLITE_API_TOKEN = '';
  if (env && env.MAILERLITE_API_TOKEN) MAILERLITE_API_TOKEN = String(env.MAILERLITE_API_TOKEN);

  let MAILERLITE_API_URL = '';
  if (env && env.MAILERLITE_API_URL) MAILERLITE_API_URL = String(env.MAILERLITE_API_URL);

  let MAILERLITE_FROM_EMAIL = '';
  if (env && env.MAILERLITE_FROM_EMAIL) MAILERLITE_FROM_EMAIL = String(env.MAILERLITE_FROM_EMAIL);

  let MAILERLITE_GROUP_ID = '';
  if (env && env.MAILERLITE_GROUP_ID) MAILERLITE_GROUP_ID = String(env.MAILERLITE_GROUP_ID);

  let MAILERLITE_BATCH_SIZE = 50;
  if (env && env.MAILERLITE_BATCH_SIZE) MAILERLITE_BATCH_SIZE = parseInt(String(env.MAILERLITE_BATCH_SIZE), 10) || 50;

  let MAILERLITE_BATCH_DELAY = 1000;
  if (env && env.MAILERLITE_BATCH_DELAY) MAILERLITE_BATCH_DELAY = parseInt(String(env.MAILERLITE_BATCH_DELAY), 10) || 1000;

  let MAILERLITE_RATE_LIMIT = 120;
  if (env && env.MAILERLITE_RATE_LIMIT) MAILERLITE_RATE_LIMIT = parseInt(String(env.MAILERLITE_RATE_LIMIT), 10) || 120;

  // Common Email Configuration
  let EMAIL_FROM_NAME = '';
  if (env && env.EMAIL_FROM_NAME) EMAIL_FROM_NAME = String(env.EMAIL_FROM_NAME);

  let EMAIL_FROM_ADDRESS = '';
  if (env && env.EMAIL_FROM_ADDRESS) EMAIL_FROM_ADDRESS = String(env.EMAIL_FROM_ADDRESS);

  let EMAIL_REPLY_TO = '';
  if (env && env.EMAIL_REPLY_TO) EMAIL_REPLY_TO = String(env.EMAIL_REPLY_TO);

  // RSS Feed Configuration
  let RSS_FEED_URL = '';
  if (env && env.RSS_FEED_URL) RSS_FEED_URL = String(env.RSS_FEED_URL);

  let USER_AGENT = '';
  if (env && env.USER_AGENT) USER_AGENT = String(env.USER_AGENT);

  let FETCH_TIMEOUT_MS = 60000;
  if (env && env.FETCH_TIMEOUT_MS) FETCH_TIMEOUT_MS = parseInt(String(env.FETCH_TIMEOUT_MS), 10) || 60000;

  // Batching and Pacing
  let BATCH_SIZE = 100; // Reduced for direct SMTP sending
  if (env && env.BATCH_SIZE) BATCH_SIZE = parseInt(String(env.BATCH_SIZE), 10) || 100;

  let BATCH_WAIT_MINUTES = 5; // Reduced wait time between batches
  if (env && env.BATCH_WAIT_MINUTES) BATCH_WAIT_MINUTES = parseInt(String(env.BATCH_WAIT_MINUTES), 10) || 5;

  let MAX_POSTS_PER_RUN = 1;
  if (env && env.MAX_POSTS_PER_RUN) MAX_POSTS_PER_RUN = parseInt(String(env.MAX_POSTS_PER_RUN), 10) || 1;

  // GitHub backup removed - Data is permanently stored in D1 database

  // Cron Configuration
  let WEEKLY_CRON = '0 0 * * sat';
  if (env && env.WEEKLY_CRON) WEEKLY_CRON = String(env.WEEKLY_CRON);

  // KV Storage Prefixes
  let PREFIX_SUBSCRIBER = 'subscriber';
  if (env && env.PREFIX_SUBSCRIBER) PREFIX_SUBSCRIBER = String(env.PREFIX_SUBSCRIBER);
  PREFIX_SUBSCRIBER = withColon(PREFIX_SUBSCRIBER);

  let PREFIX_EMAIL_QUEUE = 'email-queue';
  if (env && env.PREFIX_EMAIL_QUEUE) PREFIX_EMAIL_QUEUE = String(env.PREFIX_EMAIL_QUEUE);
  PREFIX_EMAIL_QUEUE = withColon(PREFIX_EMAIL_QUEUE);

  let PREFIX_NEWSLETTER_SENT = 'newsletter-sent';
  if (env && env.PREFIX_NEWSLETTER_SENT) PREFIX_NEWSLETTER_SENT = String(env.PREFIX_NEWSLETTER_SENT);
  PREFIX_NEWSLETTER_SENT = withColon(PREFIX_NEWSLETTER_SENT);

  let PREFIX_NEWSLETTER_SENT_URL = 'newsletter-sent-url';
  if (env && env.PREFIX_NEWSLETTER_SENT_URL) PREFIX_NEWSLETTER_SENT_URL = String(env.PREFIX_NEWSLETTER_SENT_URL);
  PREFIX_NEWSLETTER_SENT_URL = withColon(PREFIX_NEWSLETTER_SENT_URL);

  let PREFIX_CONTACT = 'contact';
  if (env && env.PREFIX_CONTACT) PREFIX_CONTACT = String(env.PREFIX_CONTACT);
  PREFIX_CONTACT = withColon(PREFIX_CONTACT);

  let PREFIX_RATELIMIT = 'ratelimit';
  if (env && env.PREFIX_RATELIMIT) PREFIX_RATELIMIT = String(env.PREFIX_RATELIMIT);
  PREFIX_RATELIMIT = withColon(PREFIX_RATELIMIT);

  let PREFIX_CAPTCHA = 'captcha';
  if (env && env.PREFIX_CAPTCHA) PREFIX_CAPTCHA = String(env.PREFIX_CAPTCHA);
  PREFIX_CAPTCHA = withColon(PREFIX_CAPTCHA);

  let PREFIX_BOT = 'bot';
  if (env && env.PREFIX_BOT) PREFIX_BOT = String(env.PREFIX_BOT);
  PREFIX_BOT = withColon(PREFIX_BOT);

  let PREFIX_BOT_DETECT = 'bot-detect';
  if (env && env.PREFIX_BOT_DETECT) PREFIX_BOT_DETECT = String(env.PREFIX_BOT_DETECT);
  PREFIX_BOT_DETECT = withColon(PREFIX_BOT_DETECT);

  let PREFIX_BACKUP_CHUNK = 'backup-chunk';
  if (env && env.PREFIX_BACKUP_CHUNK) PREFIX_BACKUP_CHUNK = String(env.PREFIX_BACKUP_CHUNK);
  PREFIX_BACKUP_CHUNK = withColon(PREFIX_BACKUP_CHUNK);

  // Cleanup Configuration - Additional prefixes to keep
  let KEEP_PREFIX_MAINTENANCE = 'maintenance:last-';
  if (env && env.KEEP_PREFIX_MAINTENANCE) KEEP_PREFIX_MAINTENANCE = String(env.KEEP_PREFIX_MAINTENANCE);

  let KEEP_PREFIX_DAILY = 'daily:last-';
  if (env && env.KEEP_PREFIX_DAILY) KEEP_PREFIX_DAILY = String(env.KEEP_PREFIX_DAILY);

  let KEEP_PREFIX_DEPLOYMENT = 'deployment:';
  if (env && env.KEEP_PREFIX_DEPLOYMENT) KEEP_PREFIX_DEPLOYMENT = String(env.KEEP_PREFIX_DEPLOYMENT);

  let KEEP_PREFIX_STATS = 'stats:';
  if (env && env.KEEP_PREFIX_STATS) KEEP_PREFIX_STATS = String(env.KEEP_PREFIX_STATS);

  // Turnstile Configuration
  let TURNSTILE_SITE_KEY = '';
  if (env && env.TURNSTILE_SITE_KEY) TURNSTILE_SITE_KEY = String(env.TURNSTILE_SITE_KEY);

  let TURNSTILE_SECRET_KEY = '';
  if (env && env.TURNSTILE_SECRET_KEY) TURNSTILE_SECRET_KEY = String(env.TURNSTILE_SECRET_KEY);

  // Admin authentication token - Required for admin endpoints
  let ADMIN_TOKEN = '';
  if (env && env.ADMIN_TOKEN) ADMIN_TOKEN = String(env.ADMIN_TOKEN);

  // Rate Limiting and Protection
  let RATE_LIMIT_MAX = 5;
  if (env && env.RATE_LIMIT_MAX) RATE_LIMIT_MAX = parseInt(String(env.RATE_LIMIT_MAX), 10) || 5;

  let RATE_LIMIT_WINDOW_HOURS = 24;
  if (env && env.RATE_LIMIT_WINDOW_HOURS) RATE_LIMIT_WINDOW_HOURS = parseInt(String(env.RATE_LIMIT_WINDOW_HOURS), 10) || 24;

  // Admin API rate limiting (separate from form rate limiting)
  let ADMIN_API_RATE_LIMIT_MAX = 5; // Max admin API calls per IP per day
  if (env && env.ADMIN_API_RATE_LIMIT_MAX) ADMIN_API_RATE_LIMIT_MAX = parseInt(String(env.ADMIN_API_RATE_LIMIT_MAX), 10) || 5;

  let ADMIN_API_RATE_LIMIT_WINDOW_HOURS = 24; // 24 hour window for admin API
  if (env && env.ADMIN_API_RATE_LIMIT_WINDOW_HOURS) ADMIN_API_RATE_LIMIT_WINDOW_HOURS = parseInt(String(env.ADMIN_API_RATE_LIMIT_WINDOW_HOURS), 10) || 24;

  let GLOBAL_RATE_LIMIT_PER_MINUTE = 30;
  if (env && env.GLOBAL_RATE_LIMIT_PER_MINUTE) GLOBAL_RATE_LIMIT_PER_MINUTE = parseInt(String(env.GLOBAL_RATE_LIMIT_PER_MINUTE), 10) || 30;

  let GLOBAL_RATE_LIMIT_WINDOW_MS = 60000;
  if (env && env.GLOBAL_RATE_LIMIT_WINDOW_MS) GLOBAL_RATE_LIMIT_WINDOW_MS = parseInt(String(env.GLOBAL_RATE_LIMIT_WINDOW_MS), 10) || 60000;

  let ABUSE_THRESHOLD = 3;
  if (env && env.ABUSE_THRESHOLD) ABUSE_THRESHOLD = parseInt(String(env.ABUSE_THRESHOLD), 10) || 3;

  let SUSPICIOUS_ACTIVITY_THRESHOLD = 5;
  if (env && env.SUSPICIOUS_ACTIVITY_THRESHOLD) SUSPICIOUS_ACTIVITY_THRESHOLD = parseInt(String(env.SUSPICIOUS_ACTIVITY_THRESHOLD), 10) || 5;

  let STATUS_PAGE_PROTECTION = true;
  if (env && env.STATUS_PAGE_PROTECTION !== undefined) STATUS_PAGE_PROTECTION = String(env.STATUS_PAGE_PROTECTION) === 'true';

  // TTL (Time To Live) Configuration in seconds
  let TTL_RATE_LIMIT = 120; // 2 minutes
  if (env && env.TTL_RATE_LIMIT) TTL_RATE_LIMIT = parseInt(String(env.TTL_RATE_LIMIT), 10) || 120;

  let TTL_BOT_DETECT = 86400; // 24 hours
  if (env && env.TTL_BOT_DETECT) TTL_BOT_DETECT = parseInt(String(env.TTL_BOT_DETECT), 10) || 86400;

  let TTL_SUSPICIOUS_ACTIVITY = 3600; // 1 hour
  if (env && env.TTL_SUSPICIOUS_ACTIVITY) TTL_SUSPICIOUS_ACTIVITY = parseInt(String(env.TTL_SUSPICIOUS_ACTIVITY), 10) || 3600;

  let TTL_ABUSE_COUNTER = 3600; // 1 hour
  if (env && env.TTL_ABUSE_COUNTER) TTL_ABUSE_COUNTER = parseInt(String(env.TTL_ABUSE_COUNTER), 10) || 3600;

  let TTL_DAILY_STATS = 172800; // 2 days
  if (env && env.TTL_DAILY_STATS) TTL_DAILY_STATS = parseInt(String(env.TTL_DAILY_STATS), 10) || 172800;

  let TTL_ERROR_LOGS = 604800; // 7 days
  if (env && env.TTL_ERROR_LOGS) TTL_ERROR_LOGS = parseInt(String(env.TTL_ERROR_LOGS), 10) || 604800;

  let TTL_FEED_ERROR = 86400; // 24 hours
  if (env && env.TTL_FEED_ERROR) TTL_FEED_ERROR = parseInt(String(env.TTL_FEED_ERROR), 10) || 86400;

  let TTL_BACKUP_CHUNK = 604800; // 7 days
  if (env && env.TTL_BACKUP_CHUNK) TTL_BACKUP_CHUNK = parseInt(String(env.TTL_BACKUP_CHUNK), 10) || 604800;

  // Backup chunk processing configuration
  let BACKUP_CHUNK_SIZE = 20; // Records to process at a time
  if (env && env.BACKUP_CHUNK_SIZE) BACKUP_CHUNK_SIZE = parseInt(String(env.BACKUP_CHUNK_SIZE), 10) || 20;

  let BACKUP_CHUNK_LIST_LIMIT = 1000; // Max chunks to list when merging
  if (env && env.BACKUP_CHUNK_LIST_LIMIT) BACKUP_CHUNK_LIST_LIMIT = parseInt(String(env.BACKUP_CHUNK_LIST_LIMIT), 10) || 1000;

  let CLEANUP_BATCH_SIZE = 100; // Keys to delete per batch in cleanup
  if (env && env.CLEANUP_BATCH_SIZE) CLEANUP_BATCH_SIZE = parseInt(String(env.CLEANUP_BATCH_SIZE), 10) || 100;

  // URL Paths
  let SUBSCRIBE_WEB_PATH = '/subscribe';
  if (env && env.SUBSCRIBE_WEB_PATH) SUBSCRIBE_WEB_PATH = String(env.SUBSCRIBE_WEB_PATH);

  let SUBSCRIBE_API_PATH = '/api/subscribe';
  if (env && env.SUBSCRIBE_API_PATH) SUBSCRIBE_API_PATH = String(env.SUBSCRIBE_API_PATH);

  let UNSUBSCRIBE_WEB_PATH = '/unsubscribe';
  if (env && env.UNSUBSCRIBE_WEB_PATH) UNSUBSCRIBE_WEB_PATH = String(env.UNSUBSCRIBE_WEB_PATH);

  let UNSUBSCRIBE_API_PATH = '/api/unsubscribe';
  if (env && env.UNSUBSCRIBE_API_PATH) UNSUBSCRIBE_API_PATH = String(env.UNSUBSCRIBE_API_PATH);

  let CONTACT_WEB_PATH = '/contact';
  if (env && env.CONTACT_WEB_PATH) CONTACT_WEB_PATH = String(env.CONTACT_WEB_PATH);

  let CONTACT_API_PATH = '/api/contact';
  if (env && env.CONTACT_API_PATH) CONTACT_API_PATH = String(env.CONTACT_API_PATH);

  // Site Configuration
  let SITE_URL = '';
  if (env && env.SITE_URL) SITE_URL = String(env.SITE_URL);

  let UNSUBSCRIBE_URL = '';
  if (env && env.UNSUBSCRIBE_URL) UNSUBSCRIBE_URL = String(env.UNSUBSCRIBE_URL);

  let SITE_OWNER = '';
  if (env && env.SITE_OWNER) SITE_OWNER = String(env.SITE_OWNER);

  // GitHub Repo URL
  let GITHUB_REPO_URL = '';
  if (env && env.GITHUB_REPO_URL) GITHUB_REPO_URL = String(env.GITHUB_REPO_URL);

  // Turnstile URLs
  let TURNSTILE_API_URL = '';
  if (env && env.TURNSTILE_API_URL) TURNSTILE_API_URL = String(env.TURNSTILE_API_URL);

  let TURNSTILE_VERIFY_URL = '';
  if (env && env.TURNSTILE_VERIFY_URL) TURNSTILE_VERIFY_URL = String(env.TURNSTILE_VERIFY_URL);

  // Retry Configuration
  let RETRY_INITIAL_DELAY = 1000;
  if (env && env.RETRY_INITIAL_DELAY) RETRY_INITIAL_DELAY = parseInt(String(env.RETRY_INITIAL_DELAY), 10) || 1000;

  let RETRY_MAX_DELAY = 30000;
  if (env && env.RETRY_MAX_DELAY) RETRY_MAX_DELAY = parseInt(String(env.RETRY_MAX_DELAY), 10) || 30000;

  let RETRY_BACKOFF_MULTIPLIER = 2;
  if (env && env.RETRY_BACKOFF_MULTIPLIER) RETRY_BACKOFF_MULTIPLIER = parseInt(String(env.RETRY_BACKOFF_MULTIPLIER), 10) || 2;

  let RETRY_MAX_ATTEMPTS = 3;
  if (env && env.RETRY_MAX_ATTEMPTS) RETRY_MAX_ATTEMPTS = parseInt(String(env.RETRY_MAX_ATTEMPTS), 10) || 3;

  let CIRCUIT_BREAKER_RESET_TIMEOUT = 60000;
  if (env && env.CIRCUIT_BREAKER_RESET_TIMEOUT) CIRCUIT_BREAKER_RESET_TIMEOUT = parseInt(String(env.CIRCUIT_BREAKER_RESET_TIMEOUT), 10) || 60000;

  // Timeout Configuration
  let GMAIL_TIMEOUT_MS = 30000;
  if (env && env.GMAIL_TIMEOUT_MS) GMAIL_TIMEOUT_MS = parseInt(String(env.GMAIL_TIMEOUT_MS), 10) || 30000;

  let CACHE_CONTROL_MAX_AGE = 3600;
  if (env && env.CACHE_CONTROL_MAX_AGE) CACHE_CONTROL_MAX_AGE = parseInt(String(env.CACHE_CONTROL_MAX_AGE), 10) || 3600;

  let CORS_MAX_AGE = 86400;
  if (env && env.CORS_MAX_AGE) CORS_MAX_AGE = parseInt(String(env.CORS_MAX_AGE), 10) || 86400;

  let COOKIE_TTL = 3600;
  if (env && env.COOKIE_TTL) COOKIE_TTL = parseInt(String(env.COOKIE_TTL), 10) || 3600;

  return {
    // Email Provider
    EMAIL_PROVIDER,

    // Gmail Config
    GMAIL_USER,
    GMAIL_PASSWORD,
    GMAIL_HOST,
    GMAIL_PORT,

    // Worker Email Config
    WORKER_EMAIL_FROM,
    WORKER_EMAIL_DOMAIN,

    // MailerLite Config
    MAILERLITE_API_TOKEN,
    MAILERLITE_API_URL,
    MAILERLITE_FROM_EMAIL,
    MAILERLITE_GROUP_ID,
    MAILERLITE_BATCH_SIZE,
    MAILERLITE_BATCH_DELAY,
    MAILERLITE_RATE_LIMIT,

    // Common Email Config
    EMAIL_FROM_NAME,
    EMAIL_FROM_ADDRESS,
    EMAIL_REPLY_TO,

    // RSS Feed
    RSS_FEED_URL,
    USER_AGENT,
    FETCH_TIMEOUT_MS,

    // Batching
    BATCH_SIZE,
    BATCH_WAIT_MINUTES,
    MAX_POSTS_PER_RUN,

    // GitHub backup removed - Data stored in D1

    // Cron
    WEEKLY_CRON,

    // KV Prefixes
    PREFIX_SUBSCRIBER,
    PREFIX_EMAIL_QUEUE,
    PREFIX_NEWSLETTER_SENT,
    PREFIX_NEWSLETTER_SENT_URL,
    PREFIX_CONTACT,
    PREFIX_RATELIMIT,
    PREFIX_CAPTCHA,
    PREFIX_BOT,
    PREFIX_BOT_DETECT,
    PREFIX_BACKUP_CHUNK,

    // Cleanup Keep Prefixes
    KEEP_PREFIX_MAINTENANCE,
    KEEP_PREFIX_DAILY,
    KEEP_PREFIX_DEPLOYMENT,
    KEEP_PREFIX_STATS,

    // Turnstile
    TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY,

    // Admin authentication
    ADMIN_TOKEN,

    // Rate Limiting and Protection
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_HOURS,
    ADMIN_API_RATE_LIMIT_MAX,
    ADMIN_API_RATE_LIMIT_WINDOW_HOURS,
    GLOBAL_RATE_LIMIT_PER_MINUTE,
    GLOBAL_RATE_LIMIT_WINDOW_MS,
    ABUSE_THRESHOLD,
    SUSPICIOUS_ACTIVITY_THRESHOLD,
    STATUS_PAGE_PROTECTION,

    // TTL Configuration
    TTL_RATE_LIMIT,
    TTL_BOT_DETECT,
    TTL_SUSPICIOUS_ACTIVITY,
    TTL_ABUSE_COUNTER,
    TTL_DAILY_STATS,
    TTL_ERROR_LOGS,
    TTL_FEED_ERROR,
    TTL_BACKUP_CHUNK,
    BACKUP_CHUNK_SIZE,
    BACKUP_CHUNK_LIST_LIMIT,
    CLEANUP_BATCH_SIZE,

    // URL Paths
    SUBSCRIBE_WEB_PATH,
    SUBSCRIBE_API_PATH,
    UNSUBSCRIBE_WEB_PATH,
    UNSUBSCRIBE_API_PATH,
    CONTACT_WEB_PATH,
    CONTACT_API_PATH,

    // Site Config
    SITE_URL,
    UNSUBSCRIBE_URL,
    SITE_OWNER,
    GITHUB_REPO_URL,

    // Turnstile URLs
    TURNSTILE_API_URL,
    TURNSTILE_VERIFY_URL,

    // Retry Configuration
    RETRY_INITIAL_DELAY,
    RETRY_MAX_DELAY,
    RETRY_BACKOFF_MULTIPLIER,
    RETRY_MAX_ATTEMPTS,
    CIRCUIT_BREAKER_RESET_TIMEOUT,

    // Timeout Configuration
    GMAIL_TIMEOUT_MS,
    CACHE_CONTROL_MAX_AGE,
    CORS_MAX_AGE,
    COOKIE_TTL
  };
}

export function isConfigValid(config) {
  const errors = [];

  // Check email provider configuration
  if (config.EMAIL_PROVIDER === 'gmail') {
    if (!config.GMAIL_USER) errors.push('GMAIL_USER is required for Gmail provider');
    if (!config.GMAIL_PASSWORD) errors.push('GMAIL_PASSWORD is required for Gmail provider');
    if (!config.EMAIL_FROM_ADDRESS) config.EMAIL_FROM_ADDRESS = config.GMAIL_USER;
  } else if (config.EMAIL_PROVIDER === 'worker-email') {
    if (!config.WORKER_EMAIL_FROM) errors.push('WORKER_EMAIL_FROM is required for Worker Email provider');
    if (!config.WORKER_EMAIL_DOMAIN) errors.push('WORKER_EMAIL_DOMAIN is required for Worker Email provider');
    if (!config.EMAIL_FROM_ADDRESS) config.EMAIL_FROM_ADDRESS = config.WORKER_EMAIL_FROM;
  } else if (config.EMAIL_PROVIDER === 'mailerlite') {
    if (!config.MAILERLITE_API_TOKEN) errors.push('MAILERLITE_API_TOKEN is required for MailerLite provider');
    if (!config.MAILERLITE_FROM_EMAIL && !config.EMAIL_FROM_ADDRESS) {
      errors.push('MAILERLITE_FROM_EMAIL or EMAIL_FROM_ADDRESS is required for MailerLite provider');
    }
    if (!config.EMAIL_FROM_ADDRESS) config.EMAIL_FROM_ADDRESS = config.MAILERLITE_FROM_EMAIL;
  } else {
    errors.push(`Invalid EMAIL_PROVIDER: ${config.EMAIL_PROVIDER}. Must be 'gmail', 'worker-email', or 'mailerlite'`);
  }

  // Check required configurations
  if (!config.RSS_FEED_URL) errors.push('RSS_FEED_URL is required');
  if (!config.TURNSTILE_SITE_KEY) errors.push('TURNSTILE_SITE_KEY is required');
  if (!config.TURNSTILE_SECRET_KEY) errors.push('TURNSTILE_SECRET_KEY is required');
  // ADMIN_TOKEN is now optional - API access is disabled for maximum security

  return {
    valid: errors.length === 0,
    errors
  };
}