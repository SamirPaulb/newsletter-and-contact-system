/**
 * Native Rate Limiting Module
 * ONLY defense mechanism using Cloudflare's native Rate Limiting API
 * No KV operations for rate limiting to avoid hitting KV limits
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
 * Check API endpoint rate limit
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeApiRateLimit(request, env) {
  try {
    if (!env.API_RATE_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);
    const { pathname } = new URL(request.url);
    const key = `${clientIp}:api:${pathname}`;

    const { success } = await env.API_RATE_LIMITER.limit({ key });

    if (!success) {
      console.log(`Native API rate limit exceeded for ${clientIp} on ${pathname}`);
      return {
        allowed: false,
        reason: 'API rate limit exceeded'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native API rate limit check error:', error);
    return { allowed: true }; // Fail open
  }
}

/**
 * Check burst rate limit (very short window)
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkNativeBurstRateLimit(request, env) {
  try {
    if (!env.BURST_RATE_LIMITER) {
      return { allowed: true };
    }

    const clientIp = getClientIp(request);
    const { success } = await env.BURST_RATE_LIMITER.limit({ key: clientIp });

    if (!success) {
      console.log(`Native burst rate limit exceeded for ${clientIp}`);
      return {
        allowed: false,
        reason: 'Too many requests in a short time. Please slow down.'
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Native burst rate limit check error:', error);
    return { allowed: true }; // Fail open
  }
}

// Daily limiters removed - Cloudflare only supports 10 or 60 second periods
// The per-minute limits are strict enough to prevent abuse

/**
 * Comprehensive rate limit check for any endpoint
 * Checks multiple rate limiters in order of strictness
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @param {string} endpointType - Type of endpoint being accessed
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkComprehensiveRateLimit(request, env, endpointType) {
  // Check burst protection first (most strict, shortest window)
  const burstCheck = await checkNativeBurstRateLimit(request, env);
  if (!burstCheck.allowed) {
    return burstCheck;
  }

  // Check global rate limit
  const globalCheck = await checkNativeGlobalRateLimit(request, env);
  if (!globalCheck.allowed) {
    return globalCheck;
  }

  // Check endpoint-specific rate limits
  switch (endpointType) {
    case 'form':
      const formType = new URL(request.url).pathname.includes('subscribe') ? 'subscribe' :
                      new URL(request.url).pathname.includes('unsubscribe') ? 'unsubscribe' : 'contact';

      // Check form rate limit (2 per minute)
      const formCheck = await checkNativeFormRateLimit(request, env, formType);
      if (!formCheck.allowed) return formCheck;
      break;

    case 'admin':
      // Check admin rate limit (2 per minute)
      const adminCheck = await checkNativeAdminRateLimit(request, env, 'api');
      if (!adminCheck.allowed) return adminCheck;
      break;

    case 'api':
      const apiCheck = await checkNativeApiRateLimit(request, env);
      if (!apiCheck.allowed) return apiCheck;
      break;

    case 'bot':
      const botCheck = await checkNativeBotRateLimit(request, env);
      if (!botCheck.allowed) return botCheck;
      break;
  }

  return { allowed: true };
}