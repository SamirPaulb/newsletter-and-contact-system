/**
 * Main Entry Point for Cloudflare Workers Newsletter & Contact Management System
 *
 * This modular system handles:
 * - Newsletter subscriptions and email delivery
 * - Contact form submissions
 * - Automated RSS feed monitoring
 * - Weekly maintenance and backups
 */

import { buildConfig, isConfigValid } from './config/config.js';
import { handleSubscribe } from './newsletter/frontend/subscribe.js';
import { handleUnsubscribe } from './newsletter/frontend/unsubscribe.js';
import { dailyRun } from './newsletter/backend/processor.js';
import { handleContact } from './contact/frontend.js';
import { runCleanup, getMaintenanceStatus } from './maintenance/cleanup.js';
import { runDailyBackupChunk, mergeAndUploadBackups, runCleanup as runWeeklyCleanup } from './maintenance/incremental.js';
import { backupD1ToGitHub } from './maintenance/d1Backup.js';
import { backupD1ToGitHubChunked, getD1BackupStatus } from './maintenance/d1BackupChunked.js';
import { protectRequest, verifyTurnstileToken } from './middleware/protection.js';
import { handleStatus } from './pages/status.js';
import { handleAdminPanel } from './pages/admin.js';
import { checkAdminApiRateLimit } from './utils/adminRateLimit.js';
import { checkNativeAdminRateLimit, checkNativeNewsletterCheckLimit } from './utils/nativeRateLimit.js';

/**
 * Admin endpoints are now protected by Turnstile CAPTCHA
 * Additional protection can be added via Cloudflare Zero Trust
 */

/**
 * Main fetch handler for HTTP requests
 */
async function handleFetch(request, env, ctx) {
  const config = buildConfig(env);
  const url = new URL(request.url);

  // Apply protection middleware (rate limiting, bot detection)
  const protectionResponse = await protectRequest(request, env, config);

  // If protection middleware returns a response, use it (rate limited or challenge)
  if (protectionResponse) {
    // Check if user has valid Turnstile token in cookie
    const hasValidToken = await verifyTurnstileToken(request, config);
    if (hasValidToken) {
      // User passed challenge, allow request to continue
      // Clear the abuse counter
      const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
      await env.KV.delete(`${config.PREFIX_RATELIMIT}abuse:${clientIp}`);
    } else {
      return protectionResponse;
    }
  }

  // Validate configuration on first request
  const configValidation = isConfigValid(config);
  if (!configValidation.valid) {
    console.error('Configuration is invalid:', configValidation.errors);

    // Show detailed error only on debug endpoint
    if (url.pathname === '/debug') {
      return new Response(JSON.stringify({
        error: 'Configuration errors',
        errors: configValidation.errors
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For all other endpoints, return a generic error
    return new Response('Service configuration error. Please contact administrator.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // Route requests to appropriate handlers
  try {
    // Handle robots.txt
    if (url.pathname === '/robots.txt') {
      return new Response(`# Robots.txt for Cloudflare Workers Newsletter & Contact Management System
# This site is for private use only via iframe embedding

# Block all search engine crawlers
User-agent: *
Disallow: /
Crawl-delay: 86400

# Block specific known bots
User-agent: Googlebot
Disallow: /

User-agent: Bingbot
Disallow: /

User-agent: Slurp
Disallow: /

User-agent: DuckDuckBot
Disallow: /

User-agent: Baiduspider
Disallow: /

User-agent: YandexBot
Disallow: /

# Block AI crawlers
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

# Block SEO and analysis bots
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: PetalBot
Disallow: /

# No sitemap available
Sitemap:`, {
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'public, max-age=86400',
          'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
        }
      });
    }

    // Newsletter Subscribe
    if (url.pathname.startsWith(config.SUBSCRIBE_WEB_PATH) ||
        url.pathname.startsWith(config.SUBSCRIBE_API_PATH)) {
      return await handleSubscribe(request, env, config, ctx);
    }

    // Newsletter Unsubscribe
    if (url.pathname.startsWith(config.UNSUBSCRIBE_WEB_PATH) ||
        url.pathname.startsWith(config.UNSUBSCRIBE_API_PATH)) {
      return await handleUnsubscribe(request, env, config);
    }

    // Contact Form
    if (url.pathname.startsWith(config.CONTACT_WEB_PATH) ||
        url.pathname.startsWith(config.CONTACT_API_PATH)) {
      return await handleContact(request, env, config, ctx);
    }

    // ====================
    // ADMIN ROUTES - All under /admin/* path
    // Protected by Turnstile and can be further protected with Cloudflare Zero Trust
    // ====================

    // Admin panel (with Turnstile protection)
    if (url.pathname === '/admin') {
      return await handleAdminPanel(request, env, config);
    }

    // Admin API endpoints (require authentication)
    if (url.pathname === '/admin/api/check-now' && request.method === 'POST') {
      // SECURITY: Only allow session-based access from admin panel
      // API token access is disabled for maximum security
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      console.log('Manual newsletter check triggered via admin API');
      const result = await dailyRun(env, config);
      return new Response(JSON.stringify({
        success: true,
        message: 'Newsletter check completed',
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
        }
      });
    }

    if (url.pathname === '/admin/api/maintenance' && request.method === 'POST') {
      // SECURITY: Only allow session-based access from admin panel
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      console.log('Manual maintenance triggered via admin API');

      // Run full maintenance
      const cleanupResult = await runCleanup(env, config);

      // Run incremental backup - first collect chunks then merge and upload
      const chunkResult = await runDailyBackupChunk(env, config);
      const backupResult = await mergeAndUploadBackups(env, config);

      // Sanitize backup result to only include counts, no actual data
      const sanitizedBackup = {
        chunk: {
          success: chunkResult.complete || false,
          count: chunkResult.count || 0
        },
        upload: {
          subscribers: {
            success: backupResult.subscribers.success,
            count: backupResult.subscribers.count,
            error: backupResult.subscribers.error ? 'Failed' : null
          },
          contacts: {
            success: backupResult.contacts.success,
            count: backupResult.contacts.count,
            error: backupResult.contacts.error ? 'Failed' : null
          }
        }
      };

      return new Response(JSON.stringify({
        success: true,
        message: 'Maintenance completed',
        cleanup: cleanupResult,
        backup: sanitizedBackup,
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
        }
      });
    }

    if (url.pathname === '/admin/api/backup' && request.method === 'POST') {
      // SECURITY: Only allow session-based access from admin panel
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      console.log('Manual backup triggered via admin API');

      // Run incremental backup - first collect chunks then merge and upload
      const chunkResult = await runDailyBackupChunk(env, config);
      const result = await mergeAndUploadBackups(env, config);

      // Only return counts and status, no actual data
      const sanitizedResult = {
        chunk: {
          success: chunkResult.complete || false,
          count: chunkResult.count || 0
        },
        upload: {
          subscribers: {
            success: result.subscribers.success,
            count: result.subscribers.count,
            error: result.subscribers.error ? 'Failed' : null
          },
          contacts: {
            success: result.contacts.success,
            count: result.contacts.count,
            error: result.contacts.error ? 'Failed' : null
          }
        }
      };

      return new Response(JSON.stringify({
        success: true,
        message: 'Backup completed',
        result: sanitizedResult,
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
        }
      });
    }

    if (url.pathname === '/admin/api/cleanup' && request.method === 'POST') {
      // SECURITY: Only allow session-based access from admin panel
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      console.log('Manual cleanup triggered via admin API');
      const result = await runCleanup(env, config);
      return new Response(JSON.stringify({
        success: true,
        message: 'Cleanup completed',
        result,
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
        }
      });
    }

    // D1 Backup endpoint - trigger manual D1 database backup
    if (url.pathname === '/admin/api/d1-backup' && request.method === 'POST') {
      // SECURITY: Only allow session-based access from admin panel
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      console.log('Manual D1 backup triggered via admin API');

      // Use chunked backup for free plan CPU limits
      const result = await backupD1ToGitHubChunked(env, config);

      // Sanitize result - never expose actual data
      const sanitizedResult = {
        success: result.success,
        message: result.message,
        continueNextCron: result.continueNextCron || false
      };

      return new Response(JSON.stringify({
        success: result.success,
        message: 'D1 backup process initiated',
        result: sanitizedResult,
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
        }
      });
    }

    // D1 Backup Status endpoint - check D1 backup progress
    if (url.pathname === '/admin/api/d1-backup-status' && request.method === 'GET') {
      // SECURITY: Only allow session-based access from admin panel
      const cookieHeader = request.headers.get('cookie') || '';
      const hasValidSession = cookieHeader.includes('admin_session=');

      if (!hasValidSession) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Access only allowed from admin panel.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const status = await getD1BackupStatus(env);

      return new Response(JSON.stringify({
        success: true,
        status: status,
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Admin pages (require authentication)
    if (url.pathname === '/admin/status') {
      // Verify admin session
      const cookieHeader = request.headers.get('cookie') || '';
      if (!cookieHeader.includes('admin_session=')) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'Content-Type': 'text/plain',
            'Location': '/admin'
          }
        });
      }

      // FIRST: Check native admin rate limit
      const nativeCheck = await checkNativeAdminRateLimit(request, env, 'status');
      if (!nativeCheck.allowed) {
        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Rate Limited</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">Rate Limit Exceeded</h1>
            <p>${nativeCheck.reason || 'Please wait before making another request'}</p>
            <p>Retry after: 60 seconds</p>
            <a href="/admin">Return to Admin Panel</a>
          </body>
          </html>
        `, {
          status: 429,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Rate Limited</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">Rate Limit Exceeded</h1>
            <p>${rateLimitCheck.message}</p>
            <p>Reset at: ${rateLimitCheck.resetAt.toLocaleString()}</p>
            <a href="/admin">Return to Admin Panel</a>
          </body>
          </html>
        `, {
          status: 429,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      return await handleStatus(request, env, config);
    }

    if (url.pathname === '/admin/debug') {
      // Verify admin session
      const cookieHeader = request.headers.get('cookie') || '';
      if (!cookieHeader.includes('admin_session=')) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'Content-Type': 'text/plain',
            'Location': '/admin'
          }
        });
      }

      // FIRST: Check native admin rate limit
      const endpoint = url.pathname.split('/').pop(); // Get the endpoint name
      const nativeCheck = await checkNativeAdminRateLimit(request, env, endpoint);
      if (!nativeCheck.allowed) {
        return new Response(JSON.stringify({
          error: nativeCheck.reason || 'Admin API rate limit exceeded',
          message: 'Please wait before making another request',
          retryAfter: 60
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      // SECOND: Check KV-based admin API rate limit (more restrictive)
      const rateLimitCheck = await checkAdminApiRateLimit(request, env, config);
      if (!rateLimitCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitCheck.message,
          remaining: rateLimitCheck.remaining,
          resetAt: rateLimitCheck.resetAt
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(config.ADMIN_API_RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
            'X-RateLimit-Reset': rateLimitCheck.resetAt.toISOString()
          }
        });
      }

      const debug = {
        environment: {
          hasKV: !!env.KV,
          emailProvider: config.EMAIL_PROVIDER,
          configValid: configValidation.valid
        },
        configuration: {
          RSS_FEED_URL: !!config.RSS_FEED_URL,
          GITHUB_OWNER: config.GITHUB_OWNER,
          GITHUB_BACKUP_REPO: config.GITHUB_BACKUP_REPO,
          BATCH_SIZE: config.BATCH_SIZE,
          BATCH_WAIT_MINUTES: config.BATCH_WAIT_MINUTES,
          MAX_POSTS_PER_RUN: config.MAX_POSTS_PER_RUN
        },
        prefixes: {
          SUBSCRIBER: config.PREFIX_SUBSCRIBER,
          EMAIL_QUEUE: config.PREFIX_EMAIL_QUEUE,
          NEWSLETTER_SENT: config.PREFIX_NEWSLETTER_SENT,
          CONTACT: config.PREFIX_CONTACT
        },
        paths: {
          SUBSCRIBE: config.SUBSCRIBE_WEB_PATH,
          UNSUBSCRIBE: config.UNSUBSCRIBE_WEB_PATH,
          CONTACT: config.CONTACT_WEB_PATH
        },
        secrets: {
          GMAIL_USER: !!config.GMAIL_USER,
          GMAIL_PASSWORD: !!config.GMAIL_PASSWORD,
          GITHUB_TOKEN: !!config.GITHUB_TOKEN,
          TURNSTILE_SITE_KEY: !!config.TURNSTILE_SITE_KEY,
          TURNSTILE_SECRET_KEY: !!config.TURNSTILE_SECRET_KEY
        },
        timestamp: new Date().toISOString()
      };

      // Return styled HTML page
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Debug Information</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: white;
            text-align: center;
            margin-bottom: 30px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h2 {
            color: #667eea;
            margin-top: 0;
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 10px;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .item {
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        .label {
            font-weight: 600;
            color: #333;
            margin-bottom: 5px;
        }
        .value {
            color: #666;
            font-family: 'Courier New', monospace;
            word-break: break-all;
        }
        .status {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
        }
        .status.true {
            background: #d4edda;
            color: #155724;
        }
        .status.false {
            background: #f8d7da;
            color: #721c24;
        }
        .timestamp {
            text-align: center;
            color: white;
            margin-top: 20px;
            opacity: 0.9;
        }
        .back-link {
            display: inline-block;
            color: white;
            text-decoration: none;
            margin-bottom: 20px;
            padding: 10px 20px;
            background: rgba(255,255,255,0.2);
            border-radius: 8px;
            transition: background 0.3s;
        }
        .back-link:hover {
            background: rgba(255,255,255,0.3);
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Home</a>
        <h1>🐛 Debug Information</h1>

        <div class="section">
            <h2>Environment</h2>
            <div class="grid">
                <div class="item">
                    <div class="label">KV Storage</div>
                    <div class="value"><span class="status ${debug.environment.hasKV}">${debug.environment.hasKV ? '✓ Available' : '✗ Not Available'}</span></div>
                </div>
                <div class="item">
                    <div class="label">Email Provider</div>
                    <div class="value">${debug.environment.emailProvider}</div>
                </div>
                <div class="item">
                    <div class="label">Configuration Valid</div>
                    <div class="value"><span class="status ${debug.environment.configValid}">${debug.environment.configValid ? '✓ Valid' : '✗ Invalid'}</span></div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>Configuration</h2>
            <div class="grid">
                ${Object.entries(debug.configuration).map(([key, value]) => `
                <div class="item">
                    <div class="label">${key.replace(/_/g, ' ')}</div>
                    <div class="value">${value}</div>
                </div>
                `).join('')}
            </div>
        </div>

        <div class="section">
            <h2>KV Prefixes</h2>
            <div class="grid">
                ${Object.entries(debug.prefixes).map(([key, value]) => `
                <div class="item">
                    <div class="label">${key}</div>
                    <div class="value">${value}</div>
                </div>
                `).join('')}
            </div>
        </div>

        <div class="section">
            <h2>Web Paths</h2>
            <div class="grid">
                ${Object.entries(debug.paths).map(([key, value]) => `
                <div class="item">
                    <div class="label">${key.replace(/_/g, ' ')}</div>
                    <div class="value"><a href="${value}" style="color: #667eea;">${value}</a></div>
                </div>
                `).join('')}
            </div>
        </div>

        <div class="section">
            <h2>Secrets Status</h2>
            <div class="grid">
                ${Object.entries(debug.secrets).map(([key, value]) => `
                <div class="item">
                    <div class="label">${key.replace(/_/g, ' ')}</div>
                    <div class="value"><span class="status ${value}">${value ? '✓ Configured' : '✗ Not Configured'}</span></div>
                </div>
                `).join('')}
            </div>
        </div>

        <div class="timestamp">
            Generated at ${debug.timestamp}
        </div>
    </div>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default home page
    if (url.pathname === '/') {
      return new Response(getHomePage(config), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
        }
      });
    }

    // 404 for unknown paths
    return new Response('Not Found', { status: 404 });

  } catch (error) {
    console.error('Request handler error:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Scheduled handler for cron triggers
 */
async function handleScheduled(event, env, ctx) {
  const config = buildConfig(env);

  try {
    console.log('Cron triggered: ' + event.cron);

    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getUTCHours();

    // Check if it's Wednesday at noon UTC for D1 backup
    if (dayOfWeek === 3 && hour === 12) {
      console.log('Wednesday noon - Running D1 database backup to GitHub');
      // Use chunked backup for CPU-safe operation on free plan
      const d1BackupResult = await backupD1ToGitHubChunked(env, config);
      console.log('D1 backup result:', d1BackupResult);

      // Store last D1 backup status
      await env.KV.put('d1:last-backup', JSON.stringify({
        timestamp: new Date().toISOString(),
        result: d1BackupResult
      }));
    }

    // Check if it's Saturday (weekly maintenance day)
    if (dayOfWeek === 6) {
      console.log('Saturday - Running weekly maintenance sequence');

      // 1. First run daily backup chunk collection
      console.log('Step 1: Daily backup chunk collection');
      const dailyBackupResult = await runDailyBackupChunk(env, config);
      console.log('Daily backup chunk result:', dailyBackupResult);

      // 2. Then merge chunks and upload to GitHub
      console.log('Step 2: Merging and uploading weekly backup');
      const weeklyBackupResult = await mergeAndUploadBackups(env, config);
      console.log('Weekly backup result:', weeklyBackupResult);

      // 3. Finally run cleanup
      console.log('Step 3: Running weekly cleanup');
      const cleanupResult = await runWeeklyCleanup(env, config);
      console.log('Weekly cleanup result:', cleanupResult);

    } else {
      // Regular daily run - just collect backup chunks
      console.log('Daily backup chunk collection');
      const dailyBackupResult = await runDailyBackupChunk(env, config);
      console.log('Daily backup chunk result:', dailyBackupResult);
    }

    // Also check for newsletters (lightweight)
    const lastNewsletterCheck = await env.KV.get(`${config.KEEP_PREFIX_DAILY}lastNewsletterCheck`);

    if (!lastNewsletterCheck || (now - new Date(lastNewsletterCheck)) > 60 * 60 * 1000) {
      // Run newsletter check if it's been more than an hour
      await env.KV.put(`${config.KEEP_PREFIX_DAILY}lastNewsletterCheck`, now.toISOString());

      // Run in background to not block
      ctx.waitUntil(dailyRun(env, config));
    }

    // Store last daily run
    await env.KV.put(`${config.KEEP_PREFIX_DAILY}run`, JSON.stringify({
      cron: event.cron,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error('Scheduled handler error:', error);

    // Store error for debugging
    await env.KV.put('error:last', JSON.stringify({
      type: 'scheduled',
      cron: event.cron,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }), {
      expirationTtl: config.TTL_ERROR_LOGS // Use config for 7 days TTL
    });
  }
}

/**
 * Get home page HTML
 */
function getHomePage(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Newsletter & Contact Management System</title>

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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
        }
        .links {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .link-card {
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            text-decoration: none;
            color: #333;
            transition: all 0.3s ease;
            text-align: center;
        }
        .link-card:hover {
            border-color: #667eea;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
            transform: translateY(-2px);
        }
        .link-card h3 {
            margin: 10px 0 5px;
            color: #667eea;
        }
        .link-card p {
            margin: 0;
            font-size: 14px;
            color: #666;
        }
        .icon {
            font-size: 32px;
        }
        .status {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .status h3 {
            margin-top: 0;
            color: #555;
        }
        .status-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e0e0e0;
        }
        .status-item:last-child {
            border-bottom: none;
        }
        .badge {
            background: #667eea;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
        footer {
            margin-top: 40px;
            text-align: center;
            color: #999;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📬 Newsletter & Contact Management System</h1>
        <p class="subtitle">Automated newsletter delivery powered by Cloudflare Workers</p>

        <div class="links">
            <a href="${config.SUBSCRIBE_WEB_PATH}" class="link-card">
                <div class="icon">✉️</div>
                <h3>Subscribe</h3>
                <p>Join the newsletter</p>
            </a>

            <a href="${config.UNSUBSCRIBE_WEB_PATH}" class="link-card">
                <div class="icon">👋</div>
                <h3>Unsubscribe</h3>
                <p>Leave the list</p>
            </a>

            <a href="${config.CONTACT_WEB_PATH}" class="link-card">
                <div class="icon">💬</div>
                <h3>Contact</h3>
                <p>Get in touch</p>
            </a>

            <a href="/health" class="link-card">
                <div class="icon">📊</div>
                <h3>Health</h3>
                <p>System status</p>
            </a>
        </div>

        <div class="status">
            <h3>System Information</h3>
            <div class="status-item">
                <span>Email Provider</span>
                <span class="badge">${config.EMAIL_PROVIDER}</span>
            </div>
            <div class="status-item">
                <span>RSS Feed</span>
                <span class="badge">${config.RSS_FEED_URL ? 'Configured' : 'Not Set'}</span>
            </div>
            <div class="status-item">
                <span>Batch Size</span>
                <span class="badge">${config.BATCH_SIZE}</span>
            </div>
            <div class="status-item">
                <span>Bot Protection</span>
                <span class="badge">${config.TURNSTILE_SITE_KEY ? 'Enabled' : 'Disabled'}</span>
            </div>
        </div>

        <footer>
            <p>Powered by Cloudflare Workers • Version 2.0 (Production Hardened)</p>
            <p>© ${new Date().getFullYear()} ${config.SITE_OWNER}</p>
            <p style="margin-top: 15px;">
                <a href="/admin" style="color: #667eea; text-decoration: none; font-size: 12px;">🔐 Admin Panel</a>
            </p>
        </footer>
    </div>
</body>
</html>`;
}

// Export the worker handlers
export default {
  fetch: handleFetch,
  scheduled: handleScheduled
};
