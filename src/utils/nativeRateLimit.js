/**
 * Native Rate Limiting Module
 * First layer of defense using Cloudflare's native Rate Limiting API
 * Falls back to KV-based rate limiting for additional checks
 */

import { getClientIp } from './validation.js';

/**
 * Check native global rate limit (first check for all requests)
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeGlobalRateLimit(request, env) {
  try {
    if (!env.GLOBAL_RATE_LIMITER) {
      // Native rate limiter not configured, allow through
      return { allowed: true };
    }

    const clientIp = getClientIp(request);
    const { pathname } = new URL(request.url);

    // Use IP + path as key for more granular limiting
    const key = `${clientIp}:${pathname}`;

    const { success } = await env.GLOBAL_RATE_LIMITER.limit({ key });

    if (!success) {
      console.log(`Native global rate limit exceeded for ${clientIp} on ${pathname}`);
      return {
        allowed: false,
        reason: 'Global rate limit exceeded'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native global rate limit check error:', error);
    // On error, fall back to KV rate limiting (fail safe)
    // This ensures rate limiting still works even if native API has issues
    return { allowed: true, fallbackToKV: true };
  }
}

/**
 * Check native form rate limit
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @param {string} formType - Type of form (subscribe, unsubscribe, contact)
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeFormRateLimit(request, env, formType) {
  try {
    if (!env.FORM_RATE_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);

    // Use IP + form type as key
    const key = `${clientIp}:${formType}`;

    const { success } = await env.FORM_RATE_LIMITER.limit({ key });

    if (!success) {
      console.log(`Native form rate limit exceeded for ${clientIp} on ${formType} form`);
      return {
        allowed: false,
        reason: `Too many ${formType} requests. Please wait a minute and try again.`
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native form rate limit check error:', error);
    return { allowed: true, fallbackToKV: true };
  }
}

/**
 * Check native admin API rate limit
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @param {string} endpoint - The admin endpoint being accessed
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeAdminRateLimit(request, env, endpoint) {
  try {
    if (!env.ADMIN_RATE_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);

    // Use IP + endpoint as key
    const key = `${clientIp}:admin:${endpoint}`;

    const { success } = await env.ADMIN_RATE_LIMITER.limit({ key });

    if (!success) {
      console.log(`Native admin rate limit exceeded for ${clientIp} on ${endpoint}`);
      return {
        allowed: false,
        reason: 'Admin API rate limit exceeded'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native admin rate limit check error:', error);
    return { allowed: true, fallbackToKV: true };
  }
}

/**
 * Check native bot rate limit (for suspected bots)
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeBotRateLimit(request, env) {
  try {
    if (!env.BOT_RATE_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);

    const { success } = await env.BOT_RATE_LIMITER.limit({ key: clientIp });

    if (!success) {
      console.log(`Native bot rate limit exceeded for ${clientIp}`);
      return {
        allowed: false,
        reason: 'Suspicious activity detected. Access restricted.'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native bot rate limit check error:', error);
    return { allowed: true, fallbackToKV: true };
  }
}

/**
 * Check native newsletter check rate limit
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeNewsletterCheckLimit(request, env) {
  try {
    if (!env.NEWSLETTER_CHECK_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);

    const { success } = await env.NEWSLETTER_CHECK_LIMITER.limit({ key: clientIp });

    if (!success) {
      console.log(`Native newsletter check limit exceeded for ${clientIp}`);
      return {
        allowed: false,
        reason: 'Newsletter check rate limit exceeded. Please wait before checking again.'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native newsletter check limit error:', error);
    return { allowed: true, fallbackToKV: true };
  }
}

/**
 * Combined rate limit check - Native first, then KV
 * This is a helper function that checks native limits first,
 * then falls back to KV-based limits if native passes
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @param {Object} config - Configuration object
 * @param {string} type - Type of rate limit to check
 * @param {Function} kvCheckFunction - The KV rate limit function to call
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkLayeredRateLimit(request, env, config, type, kvCheckFunction) {
  // First check native rate limit based on type
  let nativeCheck;

  switch (type) {
    case 'global':
      nativeCheck = await checkNativeGlobalRateLimit(request, env);
      break;
    case 'form:subscribe':
    case 'form:unsubscribe':
    case 'form:contact':
      const formType = type.split(':')[1];
      nativeCheck = await checkNativeFormRateLimit(request, env, formType);
      break;
    case 'admin':
      nativeCheck = await checkNativeAdminRateLimit(request, env, 'api');
      break;
    case 'bot':
      nativeCheck = await checkNativeBotRateLimit(request, env);
      break;
    case 'newsletter-check':
      nativeCheck = await checkNativeNewsletterCheckLimit(request, env);
      break;
    default:
      nativeCheck = { allowed: true };
  }

  // If native rate limit blocks, return immediately
  if (!nativeCheck.allowed) {
    return nativeCheck;
  }

  // If native passes and KV check function provided, check KV limits
  if (kvCheckFunction) {
    const clientIp = getClientIp(request);
    const kvCheck = await kvCheckFunction(env, config, clientIp);

    if (!kvCheck.allowed) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        remaining: kvCheck.remaining || 0
      };
    }
  }

  return { allowed: true };
}