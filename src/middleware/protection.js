/**
 * Protection Middleware - Rate limiting and bot detection
 * Protects against abuse while maintaining good UX
 * Uses native Cloudflare Rate Limiting API as first layer,
 * then falls back to KV-based rate limiting
 */

import { checkNativeGlobalRateLimit, checkNativeBotRateLimit } from '../utils/nativeRateLimit.js';

/**
 * Check if request is from a bot
 */
function isBot(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const botPatterns = [
    'bot', 'crawler', 'spider', 'scraper', 'curl', 'wget', 'python',
    'java', 'ruby', 'perl', 'php', 'go-http', 'postman', 'insomnia'
  ];

  return botPatterns.some(pattern =>
    userAgent.toLowerCase().includes(pattern)
  );
}

/**
 * Get rate limit key based on IP
 */
function getRateLimitKey(request, config) {
  const ip = request.headers.get('cf-connecting-ip') ||
             request.headers.get('x-forwarded-for') ||
             'unknown';
  return `${config.PREFIX_RATELIMIT}global:${ip}`;
}

/**
 * Protection middleware
 */
export async function protectRequest(request, env, config) {
  const url = new URL(request.url);

  // Track daily requests
  const dailyKey = `stats:daily:${new Date().toISOString().split('T')[0]}`;
  try {
    const current = await env.KV.get(dailyKey);
    const count = current ? parseInt(current) + 1 : 1;
    await env.KV.put(dailyKey, String(count), {
      expirationTtl: config.TTL_DAILY_STATS // Use config for 2 days TTL
    });
  } catch (error) {
    console.error('Error tracking daily requests:', error);
  }

  // Allow static resources without protection
  const staticPaths = ['/favicon.ico', '/robots.txt', '/sitemap.xml'];
  if (staticPaths.includes(url.pathname)) {
    return null; // No protection needed
  }

  // Get client IP
  const clientIp = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-forwarded-for') ||
                   'unknown';

  // FIRST LAYER: Check native global rate limit
  const nativeGlobalCheck = await checkNativeGlobalRateLimit(request, env);
  if (!nativeGlobalCheck.allowed) {
    console.log(`Native global rate limit blocked ${clientIp} on ${url.pathname}`);
    return new Response(nativeGlobalCheck.reason || 'Rate limit exceeded', {
      status: 429,
      headers: {
        'Retry-After': '60',
        'Content-Type': 'text/plain'
      }
    });
  }

  // Check if it's a bot
  if (isBot(request)) {
    // Check native bot rate limit (very strict)
    const nativeBotCheck = await checkNativeBotRateLimit(request, env);
    if (!nativeBotCheck.allowed) {
      console.log(`Native bot rate limit blocked ${clientIp}`);
      return new Response(nativeBotCheck.reason || 'Bot access restricted', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Log bot activity
    await env.KV.put(
      `${config.PREFIX_BOT_DETECT}${clientIp}:${Date.now()}`,
      JSON.stringify({
        userAgent: request.headers.get('user-agent'),
        path: url.pathname,
        timestamp: new Date().toISOString()
      }),
      { expirationTtl: config.TTL_BOT_DETECT } // Use config for 24 hours TTL
    );

    // Block suspicious bots
    const suspiciousBots = ['curl', 'wget', 'python', 'scraper'];
    const userAgent = request.headers.get('user-agent') || '';
    if (suspiciousBots.some(bot => userAgent.toLowerCase().includes(bot))) {
      return new Response('Bot access restricted', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }

  // SECOND LAYER: KV-based sliding window rate limiting (if native passes)
  const rateLimitKey = getRateLimitKey(request, config);
  const now = Date.now();
  const windowMs = config.GLOBAL_RATE_LIMIT_WINDOW_MS;
  const maxRequests = config.GLOBAL_RATE_LIMIT_PER_MINUTE;

  // Get existing request timestamps
  const existingData = await env.KV.get(rateLimitKey);
  let timestamps = existingData ? JSON.parse(existingData) : [];

  // Remove old timestamps outside the window
  timestamps = timestamps.filter(ts => now - ts < windowMs);

  // Check if rate limit exceeded
  if (timestamps.length >= maxRequests) {
    // Check if this IP is repeatedly hitting rate limits
    const abuseKey = `${config.PREFIX_RATELIMIT}abuse:${clientIp}`;
    const abuseCount = await env.KV.get(abuseKey);
    const newAbuseCount = (parseInt(abuseCount) || 0) + 1;

    await env.KV.put(abuseKey, String(newAbuseCount), {
      expirationTtl: config.TTL_ABUSE_COUNTER // Use config for 1 hour TTL
    });

    // If repeated abuse, show Turnstile challenge
    if (newAbuseCount > config.ABUSE_THRESHOLD) {
      return showTurnstileChallenge(config);
    }

    return new Response('Rate limit exceeded. Please try again later.', {
      status: 429,
      headers: {
        'Retry-After': '60',
        'Content-Type': 'text/plain'
      }
    });
  }

  // Add current timestamp
  timestamps.push(now);

  // Store updated timestamps
  await env.KV.put(rateLimitKey, JSON.stringify(timestamps), {
    expirationTtl: config.TTL_RATE_LIMIT // Use config for 2 minutes TTL
  });

  // Check for suspicious patterns
  const suspiciousPatterns = await checkSuspiciousActivity(env, config, clientIp, url.pathname);
  if (suspiciousPatterns) {
    return showTurnstileChallenge(config);
  }

  return null; // Request is allowed
}

/**
 * Check for suspicious activity patterns
 */
async function checkSuspiciousActivity(env, config, clientIp, pathname) {
  // Check if accessing sensitive endpoints repeatedly
  const sensitiveEndpoints = ['/api/', '/admin', '/wp-admin', '/.env', '/config'];

  for (const endpoint of sensitiveEndpoints) {
    if (pathname.includes(endpoint)) {
      const suspiciousKey = `${config.PREFIX_BOT}suspicious:${clientIp}`;
      const count = await env.KV.get(suspiciousKey);
      const newCount = (parseInt(count) || 0) + 1;

      await env.KV.put(suspiciousKey, String(newCount), {
        expirationTtl: config.TTL_SUSPICIOUS_ACTIVITY // Use config for 1 hour TTL
      });

      if (newCount > config.SUSPICIOUS_ACTIVITY_THRESHOLD) {
        return true; // Suspicious activity detected
      }
    }
  }

  return false;
}

/**
 * Show Turnstile challenge page
 */
function showTurnstileChallenge(config) {
  return new Response(`<!DOCTYPE html>
<html>
<head>
    <title>Security Check</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <!-- Prevent all search engine indexing and crawling -->
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, nocache">
    <meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet, noimageindex, max-snippet:0">
    <meta name="bingbot" content="noindex, nofollow, noarchive, nosnippet, noimageindex">

    <!-- Block AI crawlers -->
    <meta name="GPTBot" content="noindex, nofollow">
    <meta name="ChatGPT-User" content="noindex, nofollow">
    <meta name="CCBot" content="noindex, nofollow">
    <meta name="anthropic-ai" content="noindex, nofollow">
    <meta name="Claude-Web" content="noindex, nofollow">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
        }
        h2 {
            color: #333;
            margin-bottom: 10px;
        }
        p {
            color: #666;
            margin-bottom: 30px;
        }
        .turnstile-widget {
            display: flex;
            justify-content: center;
            margin: 30px 0;
        }
    </style>
    <script src="${config.TURNSTILE_API_URL || 'https://challenges.cloudflare.com/turnstile/v0/api.js'}" async defer></script>
</head>
<body>
    <div class="container">
        <h2>🔒 Security Check</h2>
        <p>Please verify you're human to continue</p>

        <div class="turnstile-widget">
            <div class="cf-turnstile"
                 data-sitekey="${config.TURNSTILE_SITE_KEY}"
                 data-callback="onSuccess">
            </div>
        </div>

        <p style="font-size: 12px; color: #999;">
            This helps us prevent abuse and keep the service available for everyone.
        </p>
    </div>

    <script>
        function onSuccess(token) {
            // Store token in cookie and reload
            document.cookie = "cf-turnstile-token=" + token + "; path=/; max-age=3600";
            window.location.reload();
        }
    </script>
</body>
</html>`, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
    }
  });
}

/**
 * Verify Turnstile token from cookie
 */
export async function verifyTurnstileToken(request, config) {
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/cf-turnstile-token=([^;]+)/);

  if (!tokenMatch) {
    return false;
  }

  const token = tokenMatch[1];
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

  try {
    // Use URL from config or fall back to default
    const url = config.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: config.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: clientIp
      })
    });

    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

/**
 * Get protection statistics
 */
export async function getProtectionStats(env, config) {
  const stats = {
    botsBlocked: 0,
    rateLimitsHit: 0,
    suspiciousActivity: 0,
    turnstileChallenges: 0
  };

  // Count bot detections
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const list = await env.KV.list({
      prefix: config.PREFIX_BOT_DETECT,
      limit: 1000,
      cursor
    });

    if (list && list.keys) {
      stats.botsBlocked += list.keys.length;
    }

    hasMore = list && !list.list_complete;
    cursor = list?.cursor;
  }

  return stats;
}