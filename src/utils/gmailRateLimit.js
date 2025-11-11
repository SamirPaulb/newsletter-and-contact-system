/**
 * Gmail Rate Limiting Module
 * Tracks and enforces Gmail's daily and per-minute sending limits
 *
 * Gmail Limits:
 * - Regular accounts: 500 emails/day
 * - Google Workspace: 2000 emails/day
 * - Per-minute limit: ~20 emails
 */

/**
 * Get current Gmail usage stats
 */
export async function getGmailUsage(env, config) {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `gmail:usage:daily:${today}`;
  const minuteKey = `gmail:usage:minute:${Date.now() / 60000 | 0}`;

  const [dailyCount, minuteCount] = await Promise.all([
    env.KV.get(dailyKey),
    env.KV.get(minuteKey)
  ]);

  return {
    daily: {
      count: parseInt(dailyCount || '0', 10),
      limit: config.GMAIL_DAILY_LIMIT || 490,
      remaining: (config.GMAIL_DAILY_LIMIT || 490) - parseInt(dailyCount || '0', 10),
      date: today
    },
    perMinute: {
      count: parseInt(minuteCount || '0', 10),
      limit: config.GMAIL_PER_MINUTE_LIMIT || 20,
      remaining: (config.GMAIL_PER_MINUTE_LIMIT || 20) - parseInt(minuteCount || '0', 10),
      minute: Date.now() / 60000 | 0
    }
  };
}

/**
 * Check if we can send emails within Gmail limits
 */
export async function canSendEmails(env, config, emailCount = 1) {
  const usage = await getGmailUsage(env, config);

  // Check daily limit
  if (usage.daily.remaining < emailCount) {
    console.log(`Gmail daily limit reached: ${usage.daily.count}/${usage.daily.limit}`);
    return {
      allowed: false,
      reason: 'Daily limit exceeded',
      resetAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
      usage
    };
  }

  // Check per-minute limit
  if (usage.perMinute.remaining < emailCount) {
    console.log(`Gmail per-minute limit reached: ${usage.perMinute.count}/${usage.perMinute.limit}`);
    return {
      allowed: false,
      reason: 'Per-minute limit exceeded',
      waitSeconds: 60 - (Date.now() / 1000 % 60),
      usage
    };
  }

  return {
    allowed: true,
    usage
  };
}

/**
 * Track email sent for rate limiting
 */
export async function trackEmailSent(env, config, emailCount = 1) {
  const today = new Date().toISOString().split('T')[0];
  const minute = Date.now() / 60000 | 0;

  const dailyKey = `gmail:usage:daily:${today}`;
  const minuteKey = `gmail:usage:minute:${minute}`;

  // Get current counts
  const [dailyCount, minuteCount] = await Promise.all([
    env.KV.get(dailyKey),
    env.KV.get(minuteKey)
  ]);

  const newDailyCount = parseInt(dailyCount || '0', 10) + emailCount;
  const newMinuteCount = parseInt(minuteCount || '0', 10) + emailCount;

  // Update counts with appropriate TTLs
  await Promise.all([
    // Daily count expires at end of day
    env.KV.put(dailyKey, String(newDailyCount), {
      expirationTtl: 86400 // 24 hours
    }),
    // Minute count expires after 2 minutes
    env.KV.put(minuteKey, String(newMinuteCount), {
      expirationTtl: 120 // 2 minutes
    })
  ]);

  // Log usage
  console.log(`Gmail usage updated - Daily: ${newDailyCount}/${config.GMAIL_DAILY_LIMIT || 490}, Minute: ${newMinuteCount}/${config.GMAIL_PER_MINUTE_LIMIT || 20}`);

  return {
    daily: newDailyCount,
    minute: newMinuteCount
  };
}

/**
 * Calculate optimal batch size based on current limits
 */
export function calculateOptimalBatchSize(config, subscriberCount) {
  const gmailBccLimit = 50; // Gmail's BCC limit per email
  const dailyLimit = config.GMAIL_DAILY_LIMIT || 490;
  const perMinuteLimit = config.GMAIL_PER_MINUTE_LIMIT || 20;

  // Calculate how many emails we need to send
  const emailsNeeded = Math.ceil(subscriberCount / gmailBccLimit);

  // Can we send all in one day?
  if (emailsNeeded <= dailyLimit) {
    // Yes, optimize for per-minute limit
    const batchesPerMinute = Math.min(perMinuteLimit, emailsNeeded);
    const totalMinutesNeeded = Math.ceil(emailsNeeded / batchesPerMinute);

    return {
      recipientsPerEmail: gmailBccLimit,
      emailsPerBatch: batchesPerMinute,
      batchWaitMinutes: 1,
      totalEmails: emailsNeeded,
      totalMinutes: totalMinutesNeeded,
      totalDays: 1,
      strategy: 'single-day'
    };
  } else {
    // Need multiple days
    const daysNeeded = Math.ceil(emailsNeeded / dailyLimit);
    const emailsPerDay = Math.ceil(emailsNeeded / daysNeeded);
    const emailsPerMinute = Math.min(perMinuteLimit, emailsPerDay);
    const minutesPerDay = Math.ceil(emailsPerDay / emailsPerMinute);

    return {
      recipientsPerEmail: gmailBccLimit,
      emailsPerDay: emailsPerDay,
      emailsPerMinute: emailsPerMinute,
      batchWaitMinutes: 1,
      totalEmails: emailsNeeded,
      totalMinutes: minutesPerDay * daysNeeded,
      totalDays: daysNeeded,
      strategy: 'multi-day'
    };
  }
}

/**
 * Get Gmail quota reset time
 */
export function getQuotaResetTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);

  const hoursUntilReset = Math.floor((tomorrow - now) / (1000 * 60 * 60));
  const minutesUntilReset = Math.floor((tomorrow - now) / (1000 * 60)) % 60;

  return {
    resetAt: tomorrow.toISOString(),
    hoursUntilReset,
    minutesUntilReset,
    formatted: `${hoursUntilReset}h ${minutesUntilReset}m`
  };
}

/**
 * Calculate wait time for rate limiting
 */
export function calculateWaitTime(usage) {
  // If daily limit exceeded, wait until tomorrow
  if (usage.daily.remaining <= 0) {
    const resetTime = getQuotaResetTime();
    return {
      waitMinutes: resetTime.hoursUntilReset * 60 + resetTime.minutesUntilReset,
      reason: 'daily-limit',
      resetAt: resetTime.resetAt
    };
  }

  // If per-minute limit exceeded, wait 1 minute
  if (usage.perMinute.remaining <= 0) {
    return {
      waitMinutes: 1,
      reason: 'per-minute-limit',
      resetAt: new Date(Date.now() + 60000).toISOString()
    };
  }

  return {
    waitMinutes: 0,
    reason: 'no-wait',
    canSend: true
  };
}