/**
 * Protection Middleware - Rate limiting and bot detection
 * Protects against abuse while maintaining good UX
 * Uses ONLY native Cloudflare Rate Limiting API
 * No KV operations for rate limiting to avoid hitting KV limits
 */

import {
  checkNativeGlobalRateLimit,
  checkNativeBotRateLimit,
  checkNativeFormRateLimit,
  checkNativeAdminRateLimit,
  checkNativeBurstRateLimit,
  checkNativeApiRateLimit,
  checkComprehensiveRateLimit
} from '../utils/nativeRateLimit.js';

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
 * Protection middleware
 */
export async function protectRequest(request, env, config) {
  const url = new URL(request.url);

  // Track daily requests (for statistics, not rate limiting)
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
  const staticPaths = ['/robots.txt', '/sitemap.xml'];
  if (staticPaths.includes(url.pathname)) {
    return null; // No protection needed
  }

  // Return empty response for favicon to avoid 404 logs
  if (url.pathname === '/favicon.ico') {
    return new Response(null, { status: 204 }); // No Content
  }

  // Get client IP
  const clientIp = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-forwarded-for') ||
                   'unknown';

  // Check native rate limits based on endpoint type
  const pathname = url.pathname;
  let rateCheckResult = null;

  // LAYER 1: Check for suspicious endpoints first (immediate blocking)
  const suspiciousEndpoints = ['/wp-admin', '/.env', '/config.php', '/.git', '/admin.php',
                               '/wp-login.php', '/xmlrpc.php', '/.aws', '/phpmyadmin'];
  if (suspiciousEndpoints.some(endpoint => pathname.includes(endpoint))) {
    console.log(`Suspicious endpoint access blocked: ${pathname}`);
    // Log for monitoring
    await env.KV.put(
      `${config.PREFIX_BOT}attack:${clientIp}:${Date.now()}`,
      JSON.stringify({
        path: pathname,
        userAgent: request.headers.get('user-agent'),
        timestamp: new Date().toISOString()
      }),
      { expirationTtl: 86400 } // 24 hours
    );
    return new Response('Forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // LAYER 2: Check burst protection (prevents rapid-fire requests)
  rateCheckResult = await checkNativeBurstRateLimit(request, env);
  if (!rateCheckResult.allowed) {
    console.log(`Burst rate limit blocked on ${pathname}`);
    return new Response('Too many requests. Slow down!', {
      status: 429,
      headers: {
        'Retry-After': '10',
        'Content-Type': 'text/plain'
      }
    });
  }

  // LAYER 3: Check global rate limit (20 per minute)
  rateCheckResult = await checkNativeGlobalRateLimit(request, env);
  if (!rateCheckResult.allowed) {
    console.log(`Global rate limit blocked on ${pathname}`);
    return new Response('Rate limit exceeded. Please wait.', {
      status: 429,
      headers: {
        'Retry-After': '60',
        'Content-Type': 'text/plain'
      }
    });
  }

  // THIRD: Check specific endpoint rate limits
  // API endpoints (form submissions)
  if (pathname.includes('/api/subscribe') || pathname.includes('/api/unsubscribe') || pathname.includes('/api/contact')) {
    const formType = pathname.includes('subscribe') ? 'subscribe' :
                    pathname.includes('unsubscribe') ? 'unsubscribe' : 'contact';

    // Check API rate limit
    rateCheckResult = await checkNativeApiRateLimit(request, env);
    if (!rateCheckResult.allowed) {
      console.log(`API rate limit blocked on ${pathname}`);
      return new Response(rateCheckResult.reason || 'API rate limit exceeded', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'Content-Type': 'text/plain'
        }
      });
    }

    // Check form rate limit (2 per minute - strict to prevent abuse and bots)
    rateCheckResult = await checkNativeFormRateLimit(request, env, formType);
    if (!rateCheckResult.allowed) {
      console.log(`Form rate limit BLOCKED: ${formType} form - Possible bot/spam attempt`);
      // Return generic message to not give away rate limit details to attackers
      return new Response('Too many requests. Please wait a moment and try again.', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'Content-Type': 'text/plain'
        }
      });
    }
  }

  // Admin endpoints
  if (pathname.startsWith('/admin')) {
    const endpoint = pathname.split('/').filter(x => x).join('-'); // e.g., "admin-api-check-now"

    // Check admin rate limit (2 per minute - strict for security)
    rateCheckResult = await checkNativeAdminRateLimit(request, env, endpoint);
    if (!rateCheckResult.allowed) {
      console.log(`Native admin rate limit blocked on ${endpoint}`);
      // Show Turnstile challenge for admin rate limits
      return showTurnstileChallenge(config);
    }
  }

  // Regular page rate limiting (subscribe, unsubscribe, contact pages)
  if (pathname === '/subscribe' || pathname === '/unsubscribe' || pathname === '/contact') {
    // These pages can be accessed more frequently than API submissions
    // Global and burst limits already applied above
  }

  // LAYER 4: Bot detection and blocking
  const userAgent = request.headers.get('user-agent') || '';
  const userAgentLower = userAgent.toLowerCase();

  // Check if it's a bot
  if (isBot(request)) {
    // Check native bot rate limit (1 per minute - EXTREMELY strict)
    const nativeBotCheck = await checkNativeBotRateLimit(request, env);
    if (!nativeBotCheck.allowed) {
      console.log(`Bot BLOCKED - User-Agent: ${userAgent.substring(0, 50)}...`);
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Log bot activity
    await env.KV.put(
      `${config.PREFIX_BOT_DETECT}${clientIp}:${Date.now()}`,
      JSON.stringify({
        userAgent: userAgent,
        path: url.pathname,
        timestamp: new Date().toISOString()
      }),
      { expirationTtl: config.TTL_BOT_DETECT }
    );

    // Immediately block harmful bots
    const blockedBots = ['curl', 'wget', 'python', 'scraper', 'scanner', 'nikto',
                         'sqlmap', 'nmap', 'masscan', 'zgrab', 'censys', 'shodan'];
    if (blockedBots.some(bot => userAgentLower.includes(bot))) {
      console.log(`Malicious bot BLOCKED: ${blockedBots.find(bot => userAgentLower.includes(bot))} detected`);
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Block empty user agents (often bots)
    if (!userAgent || userAgent.length < 10) {
      console.log(`Empty/suspicious user-agent BLOCKED`);
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }

  // Check for suspicious patterns (monitoring, not rate limiting)
  const suspiciousPatterns = await checkSuspiciousActivity(env, config, clientIp, url.pathname);
  if (suspiciousPatterns) {
    return showTurnstileChallenge(config);
  }

  return null; // Request is allowed
}

/**
 * Check for suspicious activity patterns (monitoring only, no KV rate limiting)
 */
async function checkSuspiciousActivity(env, config, clientIp, pathname) {
  // Check if accessing sensitive endpoints that should not exist
  const honeypotEndpoints = ['/wp-admin', '/.env', '/config.php', '/.git', '/admin.php', '/wp-login.php'];

  for (const endpoint of honeypotEndpoints) {
    if (pathname.includes(endpoint)) {
      // Log suspicious activity for monitoring
      await env.KV.put(
        `${config.PREFIX_BOT}suspicious:${clientIp}:${Date.now()}`,
        JSON.stringify({
          path: pathname,
          timestamp: new Date().toISOString()
        }),
        { expirationTtl: config.TTL_SUSPICIOUS_ACTIVITY }
      );
      return true; // Suspicious activity detected - show Turnstile
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