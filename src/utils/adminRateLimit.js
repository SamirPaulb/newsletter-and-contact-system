/**
 * Admin API Rate Limiting
 * Limits admin API requests to prevent abuse
 * Separate from form rate limiting to allow admins to still use forms
 */

import { getClientIp } from './validation.js';

/**
 * Check and update admin API rate limit
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment object with KV
 * @param {Object} config - Configuration object
 * @returns {Object} - { allowed: boolean, remaining: number, resetAt: Date }
 */
export async function checkAdminApiRateLimit(request, env, config) {
  const clientIp = getClientIp(request);
  const key = `${config.PREFIX_RATELIMIT}admin-api:${clientIp}`;

  // Get current count
  const currentCount = parseInt(await env.KV.get(key) || '0', 10);

  // Check if rate limit exceeded
  if (currentCount >= config.ADMIN_API_RATE_LIMIT_MAX) {
    // Get TTL to calculate reset time
    const ttlSeconds = config.ADMIN_API_RATE_LIMIT_WINDOW_HOURS * 3600;
    const resetAt = new Date(Date.now() + ttlSeconds * 1000);

    return {
      allowed: false,
      remaining: 0,
      resetAt: resetAt,
      message: `Admin API rate limit exceeded. Maximum ${config.ADMIN_API_RATE_LIMIT_MAX} requests per ${config.ADMIN_API_RATE_LIMIT_WINDOW_HOURS} hours.`
    };
  }

  // Increment counter with TTL
  const newCount = currentCount + 1;
  const ttlSeconds = config.ADMIN_API_RATE_LIMIT_WINDOW_HOURS * 3600;

  await env.KV.put(key, String(newCount), {
    expirationTtl: ttlSeconds // Auto-expire after the window
  });

  return {
    allowed: true,
    remaining: config.ADMIN_API_RATE_LIMIT_MAX - newCount,
    resetAt: new Date(Date.now() + ttlSeconds * 1000),
    message: `Request allowed. ${config.ADMIN_API_RATE_LIMIT_MAX - newCount} requests remaining.`
  };
}

/**
 * Reset admin API rate limit for an IP (for testing or emergency)
 * @param {string} clientIp - The IP address to reset
 * @param {Object} env - Environment object with KV
 * @param {Object} config - Configuration object
 */
export async function resetAdminApiRateLimit(clientIp, env, config) {
  const key = `${config.PREFIX_RATELIMIT}admin-api:${clientIp}`;
  await env.KV.delete(key);
}

/**
 * Get current admin API rate limit status without incrementing
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment object with KV
 * @param {Object} config - Configuration object
 * @returns {Object} - { count: number, remaining: number, limit: number }
 */
export async function getAdminApiRateLimitStatus(request, env, config) {
  const clientIp = getClientIp(request);
  const key = `${config.PREFIX_RATELIMIT}admin-api:${clientIp}`;

  const currentCount = parseInt(await env.KV.get(key) || '0', 10);

  return {
    count: currentCount,
    remaining: Math.max(0, config.ADMIN_API_RATE_LIMIT_MAX - currentCount),
    limit: config.ADMIN_API_RATE_LIMIT_MAX,
    window: `${config.ADMIN_API_RATE_LIMIT_WINDOW_HOURS} hours`
  };
}