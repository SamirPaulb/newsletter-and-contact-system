/**
 * Main Entry Point for Cloudflare Workers Newsletter System
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
import { performBackup } from './maintenance/backup.js';

/**
 * Main fetch handler for HTTP requests
 */
async function handleFetch(request, env, ctx) {
  const config = buildConfig(env);
  const url = new URL(request.url);

  // Validate configuration on first request
  const configValidation = isConfigValid(config);
  if (!configValidation.valid && url.pathname === '/debug') {
    return new Response(JSON.stringify({
      error: 'Configuration errors',
      errors: configValidation.errors
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Route requests to appropriate handlers
  try {
    // Newsletter Subscribe
    if (url.pathname.startsWith(config.SUBSCRIBE_WEB_PATH) ||
        url.pathname.startsWith(config.SUBSCRIBE_API_PATH)) {
      return await handleSubscribe(request, env, config);
    }

    // Newsletter Unsubscribe
    if (url.pathname.startsWith(config.UNSUBSCRIBE_WEB_PATH) ||
        url.pathname.startsWith(config.UNSUBSCRIBE_API_PATH)) {
      return await handleUnsubscribe(request, env, config);
    }

    // Contact Form
    if (url.pathname.startsWith(config.CONTACT_WEB_PATH) ||
        url.pathname.startsWith(config.CONTACT_API_PATH)) {
      return await handleContact(request, env, config);
    }

    // Admin endpoints
    if (url.pathname === '/check-now' && request.method === 'POST') {
      await dailyRun(env, config);
      return new Response(JSON.stringify({
        message: 'Daily processing triggered',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/maintenance' && request.method === 'POST') {
      const cleanupResults = await runCleanup(env, config);
      const backupResults = await performBackup(env, config);

      const results = {
        cleanup: cleanupResults,
        backup: backupResults,
        timestamp: new Date().toISOString()
      };

      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/status' && request.method === 'GET') {
      const status = await getMaintenanceStatus(env, config);
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Debug endpoint
    if (url.pathname === '/debug') {
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

      return new Response(JSON.stringify(debug, null, 2), {
        headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
    // Check if this is the weekly maintenance cron
    if (event.cron && config.WEEKLY_CRON && event.cron === config.WEEKLY_CRON) {
      console.log('Running weekly maintenance (cron: ' + event.cron + ')');

      // Run cleanup
      const cleanupResults = await runCleanup(env, config);

      // Store cleanup results
      await env.KV.put('maintenance:last-cleanup', JSON.stringify({
        results: cleanupResults,
        timestamp: new Date().toISOString()
      }));

      // Run backup
      const backupResults = await performBackup(env, config);

      // Store combined maintenance run
      await env.KV.put('maintenance:last-run', JSON.stringify({
        cleanup: cleanupResults,
        backup: backupResults,
        cron: event.cron,
        timestamp: new Date().toISOString()
      }));

      return;
    }

    // Otherwise, run daily newsletter processing
    console.log('Running daily newsletter processing (cron: ' + event.cron + ')');
    await dailyRun(env, config);

    // Store last daily run
    await env.KV.put('daily:last-run', JSON.stringify({
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
    }));
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
    <title>Newsletter System</title>
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
        <h1>📬 Newsletter Management System</h1>
        <p class="subtitle">Automated newsletter delivery powered by Cloudflare Workers</p>

        <div class="links">
            <a href="${config.SUBSCRIBE_WEB_PATH}" class="link-card">
                <div class="icon">✉️</div>
                <h3>Subscribe</h3>
                <p>Join our newsletter</p>
            </a>

            <a href="${config.UNSUBSCRIBE_WEB_PATH}" class="link-card">
                <div class="icon">👋</div>
                <h3>Unsubscribe</h3>
                <p>Leave our list</p>
            </a>

            <a href="${config.CONTACT_WEB_PATH}" class="link-card">
                <div class="icon">💬</div>
                <h3>Contact</h3>
                <p>Get in touch</p>
            </a>

            <a href="/status" class="link-card">
                <div class="icon">📊</div>
                <h3>Status</h3>
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
            <p>Powered by Cloudflare Workers • Version 2.0</p>
            <p>© ${new Date().getFullYear()} ${config.SITE_OWNER}</p>
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