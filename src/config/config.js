/**
 * Centralized configuration module for the Cloudflare Workers Newsletter System
 */

function withColon(p) {
  const s = String(p || '');
  return s.endsWith(':') ? s : s + ':';
}

export function buildConfig(env) {
  // Email Provider Configuration
  let EMAIL_PROVIDER = 'gmail'; // 'gmail' or 'worker-email'
  if (env && env.EMAIL_PROVIDER) EMAIL_PROVIDER = String(env.EMAIL_PROVIDER).toLowerCase();

  // Gmail Configuration (for worker-mailer)
  let GMAIL_USER = '';
  if (env && env.GMAIL_USER) GMAIL_USER = String(env.GMAIL_USER);

  let GMAIL_PASSWORD = '';
  if (env && env.GMAIL_PASSWORD) GMAIL_PASSWORD = String(env.GMAIL_PASSWORD);

  let GMAIL_HOST = 'smtp.gmail.com';
  if (env && env.GMAIL_HOST) GMAIL_HOST = String(env.GMAIL_HOST);

  let GMAIL_PORT = 587;
  if (env && env.GMAIL_PORT) GMAIL_PORT = parseInt(String(env.GMAIL_PORT), 10) || 587;

  // Worker Email Configuration
  let WORKER_EMAIL_FROM = '';
  if (env && env.WORKER_EMAIL_FROM) WORKER_EMAIL_FROM = String(env.WORKER_EMAIL_FROM);

  let WORKER_EMAIL_DOMAIN = '';
  if (env && env.WORKER_EMAIL_DOMAIN) WORKER_EMAIL_DOMAIN = String(env.WORKER_EMAIL_DOMAIN);

  // Common Email Configuration
  let EMAIL_FROM_NAME = 'Newsletter';
  if (env && env.EMAIL_FROM_NAME) EMAIL_FROM_NAME = String(env.EMAIL_FROM_NAME);

  let EMAIL_FROM_ADDRESS = '';
  if (env && env.EMAIL_FROM_ADDRESS) EMAIL_FROM_ADDRESS = String(env.EMAIL_FROM_ADDRESS);

  let EMAIL_REPLY_TO = '';
  if (env && env.EMAIL_REPLY_TO) EMAIL_REPLY_TO = String(env.EMAIL_REPLY_TO);

  // RSS Feed Configuration
  let RSS_FEED_URL = '';
  if (env && env.RSS_FEED_URL) RSS_FEED_URL = String(env.RSS_FEED_URL);

  let USER_AGENT = 'Newsletter-Bot/2.0';
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

  // GitHub Configuration for Backups
  let GITHUB_OWNER = '';
  if (env && env.GITHUB_OWNER) GITHUB_OWNER = String(env.GITHUB_OWNER);

  let GITHUB_BACKUP_REPO = '';
  if (env && env.GITHUB_BACKUP_REPO) GITHUB_BACKUP_REPO = String(env.GITHUB_BACKUP_REPO);

  let GITHUB_BACKUP_BRANCH = '';
  if (env && env.GITHUB_BACKUP_BRANCH) GITHUB_BACKUP_BRANCH = String(env.GITHUB_BACKUP_BRANCH);

  let GITHUB_TOKEN = '';
  if (env && env.GITHUB_TOKEN) GITHUB_TOKEN = String(env.GITHUB_TOKEN);

  let GITHUB_SUBSCRIBER_BACKUP_PATH = 'cloudflare-workers-kv-subscriber-backup.csv';
  if (env && env.GITHUB_SUBSCRIBER_BACKUP_PATH) GITHUB_SUBSCRIBER_BACKUP_PATH = String(env.GITHUB_SUBSCRIBER_BACKUP_PATH);

  let GITHUB_CONTACT_BACKUP_PATH = 'cloudflare-workers-kv-contact-backup.csv';
  if (env && env.GITHUB_CONTACT_BACKUP_PATH) GITHUB_CONTACT_BACKUP_PATH = String(env.GITHUB_CONTACT_BACKUP_PATH);

  // Contact Form GitHub Configuration
  let GITHUB_CONTACT_REPO = '';
  if (env && env.GITHUB_CONTACT_REPO) GITHUB_CONTACT_REPO = String(env.GITHUB_CONTACT_REPO);

  let GITHUB_CONTACT_BRANCH = '';
  if (env && env.GITHUB_CONTACT_BRANCH) GITHUB_CONTACT_BRANCH = String(env.GITHUB_CONTACT_BRANCH);

  let GITHUB_CONTACT_PATH = '';
  if (env && env.GITHUB_CONTACT_PATH) GITHUB_CONTACT_PATH = String(env.GITHUB_CONTACT_PATH);

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

  // Turnstile Configuration
  let TURNSTILE_SITE_KEY = '';
  if (env && env.TURNSTILE_SITE_KEY) TURNSTILE_SITE_KEY = String(env.TURNSTILE_SITE_KEY);

  let TURNSTILE_SECRET_KEY = '';
  if (env && env.TURNSTILE_SECRET_KEY) TURNSTILE_SECRET_KEY = String(env.TURNSTILE_SECRET_KEY);

  // Rate Limiting
  let RATE_LIMIT_MAX = 5;
  if (env && env.RATE_LIMIT_MAX) RATE_LIMIT_MAX = parseInt(String(env.RATE_LIMIT_MAX), 10) || 5;

  let RATE_LIMIT_WINDOW_HOURS = 24;
  if (env && env.RATE_LIMIT_WINDOW_HOURS) RATE_LIMIT_WINDOW_HOURS = parseInt(String(env.RATE_LIMIT_WINDOW_HOURS), 10) || 24;

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
  let SITE_URL = 'https://samirpaulb.github.io';
  if (env && env.SITE_URL) SITE_URL = String(env.SITE_URL);

  let UNSUBSCRIBE_URL = 'https://samirpaulb.github.io/unsubscribe-newsletter/';
  if (env && env.UNSUBSCRIBE_URL) UNSUBSCRIBE_URL = String(env.UNSUBSCRIBE_URL);

  let SITE_OWNER = 'Samir P.';
  if (env && env.SITE_OWNER) SITE_OWNER = String(env.SITE_OWNER);

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

    // GitHub
    GITHUB_OWNER,
    GITHUB_BACKUP_REPO,
    GITHUB_BACKUP_BRANCH,
    GITHUB_TOKEN,
    GITHUB_SUBSCRIBER_BACKUP_PATH,
    GITHUB_CONTACT_BACKUP_PATH,
    GITHUB_CONTACT_REPO,
    GITHUB_CONTACT_BRANCH,
    GITHUB_CONTACT_PATH,

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

    // Turnstile
    TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY,

    // Rate Limiting
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_HOURS,

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
    SITE_OWNER
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
  } else {
    errors.push(`Invalid EMAIL_PROVIDER: ${config.EMAIL_PROVIDER}. Must be 'gmail' or 'worker-email'`);
  }

  // Check required configurations
  if (!config.RSS_FEED_URL) errors.push('RSS_FEED_URL is required');
  if (!config.GITHUB_TOKEN) errors.push('GITHUB_TOKEN is required');
  if (!config.TURNSTILE_SITE_KEY) errors.push('TURNSTILE_SITE_KEY is required');
  if (!config.TURNSTILE_SECRET_KEY) errors.push('TURNSTILE_SECRET_KEY is required');

  return {
    valid: errors.length === 0,
    errors
  };
}