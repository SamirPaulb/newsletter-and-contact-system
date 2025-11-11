/**
 * Status Page - Protected system status display
 */

import { verifyTurnstile } from '../utils/kv.js';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  return String(text).replace(/[&<>"'/]/g, char => map[char]);
}

/**
 * Handle status page request
 */
export async function handleStatus(request, env, config) {
  const url = new URL(request.url);

  // Check if this is a POST request with Turnstile token
  if (request.method === 'POST') {
    try {
      const formData = await request.formData();
      const token = formData.get('cf-turnstile-response');
      const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

      const isValid = await verifyTurnstile(token, clientIp, config.TURNSTILE_SECRET_KEY, config.TURNSTILE_VERIFY_URL);

      if (isValid) {
        // Set a cookie to remember verification
        const statusData = await getStatusData(env, config);
        return new Response(renderStatusPage(config, statusData, true), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': `status-verified=true; Max-Age=300; Path=/admin/status; HttpOnly; Secure; SameSite=Strict`
          }
        });
      }
    } catch (error) {
      console.error('Status verification error:', error);
    }

    // If verification failed, show the challenge again
    return new Response(renderStatusChallenge(config, 'Verification failed. Please try again.'), {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
      }
    });
  }

  // Check if user has verification cookie
  const cookieHeader = request.headers.get('cookie') || '';
  const hasVerification = cookieHeader.includes('status-verified=true');

  // If status page protection is enabled and no verification, show challenge
  if (config.STATUS_PAGE_PROTECTION && !hasVerification) {
    return new Response(renderStatusChallenge(config), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
      }
    });
  }

  // Get status data (this uses KV reads, so we protect it)
  const statusData = await getStatusData(env, config);

  return new Response(renderStatusPage(config, statusData, hasVerification), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Get status data with optimized KV reads
 */
async function getStatusData(env, config) {
  const status = {
    // Counts
    subscribersTotal: 0,
    contactsTotal: 0,
    emailsSentTotal: 0,
    activeQueues: 0,

    // Activity
    dailyRequests: 0,
    todaySignups: 0,

    // Last operations
    lastBackup: null,
    backupSize: null,
    lastNewsletter: null,
    lastNewsletterTitle: null,
    lastNewsletterUrl: null,
    lastCleanup: null,
    lastRssFetch: null,

    // System
    systemHealth: 'Operational',
    workerVersion: '2.0.0',
    uptime: null,
    responseTime: 'Fast',
    errorRate: '0%'
  };

  try {
    // Get exact subscriber count using pagination
    let subscriberCount = 0;
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_SUBSCRIBER,
        limit: 1000,
        cursor
      });

      if (list && list.keys) {
        subscriberCount += list.keys.length;
      }

      hasMore = list && !list.list_complete;
      cursor = list?.cursor;
    }
    status.subscribersTotal = subscriberCount;

    // Get exact contact count
    let contactCount = 0;
    cursor = null;
    hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_CONTACT,
        limit: 1000,
        cursor
      });

      if (list && list.keys) {
        contactCount += list.keys.length;
      }

      hasMore = list && !list.list_complete;
      cursor = list?.cursor;
    }
    status.contactsTotal = contactCount;

    // Get sent newsletters count
    let sentCount = 0;
    cursor = null;
    hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_NEWSLETTER_SENT,
        limit: 1000,
        cursor
      });

      if (list && list.keys) {
        sentCount += list.keys.length;
      }

      hasMore = list && !list.list_complete;
      cursor = list?.cursor;
    }
    status.emailsSentTotal = sentCount;

    // Get active queues count
    let queueCount = 0;
    cursor = null;
    hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_EMAIL_QUEUE,
        limit: 1000,
        cursor
      });

      if (list && list.keys) {
        for (const key of list.keys) {
          try {
            const queueData = await env.KV.get(key.name);
            if (queueData) {
              const queue = JSON.parse(queueData);
              if (queue.status === 'pending' || queue.status === 'in-progress') {
                queueCount++;
              }
            }
          } catch {}
        }
      }

      hasMore = list && !list.list_complete;
      cursor = list?.cursor;
    }
    status.activeQueues = queueCount;

    // Get last backup info with size
    const lastBackup = await env.KV.get(`${config.KEEP_PREFIX_MAINTENANCE}backup`);
    if (lastBackup) {
      const backup = JSON.parse(lastBackup);
      status.lastBackup = new Date(backup.timestamp).toLocaleString();

      // Calculate backup size
      if (backup.results) {
        const subscriberBackupSize = backup.results.subscribers?.count || 0;
        const contactBackupSize = backup.results.contacts?.count || 0;
        status.backupSize = `${subscriberBackupSize + contactBackupSize} records`;
      }
    }

    // Get last newsletter sent with details
    const lastDaily = await env.KV.get(`${config.KEEP_PREFIX_DAILY}run`);
    if (lastDaily) {
      const daily = JSON.parse(lastDaily);
      status.lastRssFetch = new Date(daily.timestamp).toLocaleString();
    }

    // Get last sent newsletter details
    cursor = null;
    const sentList = await env.KV.list({
      prefix: config.PREFIX_NEWSLETTER_SENT,
      limit: 1,
      cursor
    });

    if (sentList && sentList.keys && sentList.keys.length > 0) {
      const lastSentData = await env.KV.get(sentList.keys[0].name);
      if (lastSentData) {
        const sentInfo = JSON.parse(lastSentData);
        status.lastNewsletter = new Date(sentInfo.sentAt).toLocaleString();
        status.lastNewsletterTitle = sentInfo.title || 'Untitled';
        status.lastNewsletterUrl = sentInfo.url || '#';
      }
    }

    // Get last cleanup info
    const lastCleanup = await env.KV.get(`${config.KEEP_PREFIX_MAINTENANCE}cleanup`);
    if (lastCleanup) {
      const cleanup = JSON.parse(lastCleanup);
      status.lastCleanup = new Date(cleanup.timestamp).toLocaleString();
    }

    // Get today's signups (check subscribers added in last 24 hours)
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    let todaySignups = 0;

    cursor = null;
    hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_SUBSCRIBER,
        limit: 100,
        cursor
      });

      if (list && list.keys) {
        for (const key of list.keys) {
          try {
            const data = await env.KV.get(key.name);
            if (data) {
              const subscriber = JSON.parse(data);
              if (subscriber.timestamp) {
                const subTime = new Date(subscriber.timestamp).getTime();
                if (subTime > oneDayAgo) {
                  todaySignups++;
                }
              }
            }
          } catch {}
        }
      }

      hasMore = list && !list.list_complete;
      cursor = list?.cursor;
    }
    status.todaySignups = todaySignups;

    // Get daily requests count (approximate)
    const dailyRequestsKey = `stats:daily:${new Date().toISOString().split('T')[0]}`;
    const dailyStats = await env.KV.get(dailyRequestsKey);
    status.dailyRequests = dailyStats ? parseInt(dailyStats) : 0;

    // Calculate uptime (since last deployment - approximate)
    const deploymentTime = await env.KV.get('deployment:timestamp');
    if (deploymentTime) {
      const deployed = new Date(deploymentTime).getTime();
      const uptimeMs = now - deployed;
      const days = Math.floor(uptimeMs / (24 * 60 * 60 * 1000));
      const hours = Math.floor((uptimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      status.uptime = `${days}d ${hours}h`;
    } else {
      status.uptime = 'N/A';
    }

  } catch (error) {
    console.error('Error getting status:', error);
    status.systemHealth = 'Degraded';
    status.errorRate = 'Unknown';
  }

  return status;
}

/**
 * Render Turnstile challenge page
 */
function renderStatusChallenge(config, errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status Page - Verification Required</title>

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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 480px;
            width: 100%;
            text-align: center;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }

        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 16px;
        }

        .icon {
            font-size: 48px;
            margin-bottom: 20px;
        }

        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #f5c6cb;
        }

        form {
            margin-top: 30px;
        }

        .turnstile-widget {
            display: flex;
            justify-content: center;
            margin: 30px 0;
        }

        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }

        .info {
            margin-top: 30px;
            padding: 16px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 14px;
            color: #666;
        }
    </style>
    <script src="${config.TURNSTILE_API_URL || 'https://challenges.cloudflare.com/turnstile/v0/api.js'}" async defer></script>
</head>
<body>
    <div class="container">
        <div class="icon">🔒</div>
        <h1>Status Page Access</h1>
        <p class="subtitle">Please verify you're human to view system status</p>

        ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}

        <form method="POST" action="/status">
            <div class="turnstile-widget">
                <div class="cf-turnstile"
                     data-sitekey="${config.TURNSTILE_SITE_KEY}"
                     data-theme="light"
                     data-size="normal">
                </div>
            </div>

            <button type="submit">View Status</button>
        </form>

        <div class="info">
            <strong>Why verification?</strong><br>
            Status page queries consume system resources. This verification helps prevent abuse and keeps the service available for everyone.
        </div>
    </div>
</body>
</html>`;
}

/**
 * Render status page
 */
function renderStatusPage(config, status, isVerified) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Status</title>

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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
        }

        .header {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            text-align: center;
        }

        h1 {
            color: #333;
            margin-bottom: 10px;
        }

        .status-badge {
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            margin-top: 10px;
        }

        .status-operational {
            background: #d4edda;
            color: #155724;
        }

        .status-degraded {
            background: #fff3cd;
            color: #856404;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .stat-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        .stat-label {
            color: #666;
            font-size: 14px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .stat-value {
            color: #333;
            font-size: 28px;
            font-weight: bold;
        }

        .stat-icon {
            font-size: 20px;
        }

        .info-card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            margin-bottom: 20px;
        }

        .info-title {
            color: #333;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #eee;
        }

        .info-item:last-child {
            border-bottom: none;
        }

        .info-label {
            color: #666;
        }

        .info-value {
            color: #333;
            font-weight: 500;
        }

        .footer {
            text-align: center;
            margin-top: 40px;
            color: white;
            opacity: 0.9;
        }

        .footer a {
            color: white;
            text-decoration: none;
            margin: 0 10px;
        }

        .footer a:hover {
            text-decoration: underline;
        }

        .refresh-info {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 12px;
            margin-top: 15px;
            font-size: 14px;
            color: #666;
            text-align: center;
        }

        ${isVerified ? '' : `
        .verification-warning {
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
        }
        `}
    </style>
</head>
<body>
    <div class="container">
        ${!isVerified && config.STATUS_PAGE_PROTECTION ? `
        <div class="verification-warning">
            ⚠️ Limited view. Verify to see detailed statistics.
        </div>
        ` : ''}

        <div class="header">
            <h1>📊 System Status</h1>
            <div class="status-badge ${status.systemHealth === 'Operational' ? 'status-operational' : 'status-degraded'}">
                ${status.systemHealth}
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">
                    <span class="stat-icon">👥</span>
                    <span>Total Subscribers</span>
                </div>
                <div class="stat-value">${status.subscribersTotal}</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">
                    <span class="stat-icon">📧</span>
                    <span>Contact Forms</span>
                </div>
                <div class="stat-value">${status.contactsTotal}</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">
                    <span class="stat-icon">📨</span>
                    <span>Newsletters Sent</span>
                </div>
                <div class="stat-value">${status.emailsSentTotal}</div>
            </div>

            <div class="stat-card">
                <div class="stat-label">
                    <span class="stat-icon">🆕</span>
                    <span>Today's Signups</span>
                </div>
                <div class="stat-value">${status.todaySignups}</div>
            </div>
        </div>

        <div class="info-card">
            <div class="info-title">
                <span>📬</span>
                <span>Newsletter Activity</span>
            </div>

            <div class="info-item">
                <span class="info-label">Last Newsletter Sent</span>
                <span class="info-value">${status.lastNewsletter || 'Never'}</span>
            </div>

            ${status.lastNewsletterTitle ? `
            <div class="info-item">
                <span class="info-label">Last Newsletter Title</span>
                <span class="info-value">${escapeHtml(status.lastNewsletterTitle)}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Last Newsletter URL</span>
                <span class="info-value"><a href="${escapeHtml(status.lastNewsletterUrl)}" target="_blank" style="color: #667eea;">View Article</a></span>
            </div>
            ` : ''}

            <div class="info-item">
                <span class="info-label">Active Email Queues</span>
                <span class="info-value">${status.activeQueues}</span>
            </div>

            <div class="info-item">
                <span class="info-label">RSS Feed Last Check</span>
                <span class="info-value">${status.lastRssFetch || 'Never'}</span>
            </div>
        </div>

        <div class="info-card">
            <div class="info-title">
                <span>💾</span>
                <span>Backup & Maintenance</span>
            </div>

            <div class="info-item">
                <span class="info-label">Last Backup</span>
                <span class="info-value">${status.lastBackup || 'Never'}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Backup Size</span>
                <span class="info-value">${status.backupSize || 'N/A'}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Last Cleanup</span>
                <span class="info-value">${status.lastCleanup || 'Never'}</span>
            </div>
        </div>

        <div class="info-card">
            <div class="info-title">
                <span>⚙️</span>
                <span>System Information</span>
            </div>

            <div class="info-item">
                <span class="info-label">Worker Version</span>
                <span class="info-value">${status.workerVersion}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Uptime</span>
                <span class="info-value">${status.uptime}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Daily Requests</span>
                <span class="info-value">${status.dailyRequests.toLocaleString()}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Response Time</span>
                <span class="info-value">${status.responseTime}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Error Rate</span>
                <span class="info-value">${status.errorRate}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Email Provider</span>
                <span class="info-value">${config.EMAIL_PROVIDER}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Rate Limiting</span>
                <span class="info-value">Active (${config.GLOBAL_RATE_LIMIT_PER_MINUTE} req/min)</span>
            </div>
        </div>

        <div class="info-card">
            <div class="info-title">
                <span>🛡️</span>
                <span>Security Status</span>
            </div>

            <div class="info-item">
                <span class="info-label">Bot Protection</span>
                <span class="info-value">Active</span>
            </div>

            <div class="info-item">
                <span class="info-label">Turnstile Verification</span>
                <span class="info-value">${config.TURNSTILE_SITE_KEY ? 'Enabled' : 'Disabled'}</span>
            </div>

            <div class="info-item">
                <span class="info-label">Status Page Protection</span>
                <span class="info-value">${config.STATUS_PAGE_PROTECTION ? 'Enabled' : 'Disabled'}</span>
            </div>

            <div class="refresh-info">
                ${isVerified ? 'Access expires in 5 minutes' : 'Auto-refresh disabled for public view'}
            </div>
        </div>

        <div class="footer">
            <p>© ${new Date().getFullYear()} ${config.SITE_OWNER}</p>
            <p>
                <a href="/">Home</a> •
                <a href="${config.SUBSCRIBE_WEB_PATH}">Subscribe</a> •
                <a href="${config.CONTACT_WEB_PATH}">Contact</a>
            </p>
        </div>
    </div>
</body>
</html>`;
}