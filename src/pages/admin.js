/**
 * Admin Panel - Protected administrative interface
 * Requires Turnstile verification and can be further protected with Cloudflare Zero Trust
 */

/**
 * Render the admin panel page with Turnstile protection
 */
export function renderAdminPanel(config, isAuthenticated = false) {
  if (!isAuthenticated) {
    // Show Turnstile challenge first
    return renderTurnstileChallenge(config);
  }

  // Render authenticated admin panel
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - Newsletter System</title>
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
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
        }

        .header h1 {
            color: #333;
            font-size: 32px;
            margin-bottom: 10px;
        }

        .header p {
            color: #666;
            font-size: 16px;
        }

        .warning {
            background: #fff3cd;
            border: 1px solid #ffc107;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .admin-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .admin-section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }

        .admin-section h2 {
            color: #333;
            font-size: 20px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0f0f0;
        }

        .admin-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }

        .admin-card:hover {
            background: #fff;
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }

        .admin-card .icon {
            font-size: 32px;
            margin-bottom: 10px;
        }

        .admin-card h3 {
            color: #333;
            font-size: 18px;
            margin-bottom: 5px;
        }

        .admin-card p {
            color: #666;
            font-size: 14px;
        }

        .admin-card .endpoint {
            color: #999;
            font-size: 12px;
            font-family: 'Courier New', Courier, monospace;
            margin-top: 5px;
        }

        .btn {
            display: inline-block;
            padding: 10px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.3s ease;
            text-decoration: none;
        }

        .btn:hover {
            background: #5a67d8;
        }

        .btn-danger {
            background: #dc3545;
        }

        .btn-danger:hover {
            background: #c82333;
        }

        .btn-warning {
            background: #ffc107;
            color: #333;
        }

        .btn-warning:hover {
            background: #e0a800;
        }

        .footer {
            text-align: center;
            padding: 20px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 14px;
        }

        .footer a {
            color: white;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Admin Panel</h1>
            <p>Protected administrative interface for newsletter system management</p>
        </div>

        <div class="warning">
            ⚠️ <strong>Protected Area:</strong> This admin panel is protected by Turnstile and can be further secured with Cloudflare Zero Trust. All actions are logged.
        </div>

        <div class="admin-grid">
            <!-- System Status Section -->
            <div class="admin-section">
                <h2>📊 System Status</h2>

                <div class="admin-card" onclick="window.location.href='/admin/status'">
                    <div class="icon">📈</div>
                    <h3>System Status</h3>
                    <p>View system metrics and statistics</p>
                    <div class="endpoint">GET /admin/status</div>
                </div>

                <div class="admin-card" onclick="window.location.href='/admin/debug'">
                    <div class="icon">🐛</div>
                    <h3>Debug Info</h3>
                    <p>View configuration and debug information</p>
                    <div class="endpoint">GET /admin/debug</div>
                </div>
            </div>

            <!-- Operations Section -->
            <div class="admin-section">
                <h2>⚙️ Operations</h2>

                <div class="admin-card" onclick="if(confirm('This will trigger an immediate newsletter check. Continue?')) {
                    fetch('/admin/api/check-now', {method: 'POST'})
                        .then(r => r.json())
                        .then(d => { alert('Newsletter check completed!'); console.log(d); })
                        .catch(e => alert('Error: ' + e));
                }">
                    <div class="icon">🚀</div>
                    <h3>Check Newsletter Now</h3>
                    <p>Trigger immediate newsletter check</p>
                    <div class="endpoint">POST /admin/api/check-now</div>
                </div>

                <div class="admin-card" onclick="if(confirm('This will run maintenance tasks including cleanup and backup. Continue?')) {
                    fetch('/admin/api/maintenance', {method: 'POST'})
                        .then(r => r.json())
                        .then(d => { alert('Maintenance completed! Check console for details.'); console.log(d); })
                        .catch(e => alert('Error: ' + e));
                }">
                    <div class="icon">🔧</div>
                    <h3>Run Maintenance</h3>
                    <p>Execute cleanup and backup tasks</p>
                    <div class="endpoint">POST /admin/api/maintenance</div>
                </div>
            </div>

            <!-- Data Management Section -->
            <div class="admin-section">
                <h2>💾 Data Management</h2>

                <div class="admin-card" onclick="if(confirm('This will backup all data to GitHub. Continue?')) {
                    fetch('/admin/api/backup', {method: 'POST'})
                        .then(r => r.json())
                        .then(d => { alert('Backup completed!'); console.log(d); })
                        .catch(e => alert('Error: ' + e));
                }">
                    <div class="icon">💾</div>
                    <h3>Backup Data</h3>
                    <p>Backup all KV data to GitHub</p>
                    <div class="endpoint">POST /admin/api/backup</div>
                </div>

                <div class="admin-card" onclick="if(confirm('This will clean up expired entries. Continue?')) {
                    fetch('/admin/api/cleanup', {method: 'POST'})
                        .then(r => r.json())
                        .then(d => { alert('Cleanup completed!'); console.log(d); })
                        .catch(e => alert('Error: ' + e));
                }">
                    <div class="icon">🧹</div>
                    <h3>Cleanup Data</h3>
                    <p>Remove expired KV entries</p>
                    <div class="endpoint">POST /admin/api/cleanup</div>
                </div>

                <div class="admin-card" onclick="if(confirm('This will backup D1 database to GitHub. This may take multiple runs due to CPU limits. Continue?')) {
                    fetch('/admin/api/d1-backup', {method: 'POST'})
                        .then(r => r.json())
                        .then(d => {
                            if (d.result && d.result.continueNextCron) {
                                alert('D1 backup in progress. Will continue in next cron run.');
                            } else {
                                alert('D1 backup initiated!');
                            }
                            console.log(d);
                            // Check status
                            return fetch('/admin/api/d1-backup-status');
                        })
                        .then(r => r.json())
                        .then(status => {
                            console.log('Backup status:', status);
                            if (status.status && status.status.inProgress) {
                                alert('Backup is in progress. Subscribers: ' +
                                      status.status.subscribers.processed + '/' + status.status.subscribers.total +
                                      ', Contacts: ' + status.status.contacts.processed + '/' + status.status.contacts.total);
                            }
                        })
                        .catch(e => alert('Error: ' + e));
                }">
                    <div class="icon">🗄️</div>
                    <h3>Backup D1 Database</h3>
                    <p>Export D1 to SQL and upload to GitHub</p>
                    <div class="endpoint">POST /admin/api/d1-backup</div>
                </div>
            </div>
        </div>

        <div class="admin-section" style="text-align: center;">
            <a href="/" class="btn">← Back to Home</a>
        </div>

        <div class="footer">
            <p>Newsletter System v2.0 | Protected by Turnstile & Zero Trust</p>
            <p><a href="${config.GITHUB_REPO_URL}" target="_blank">Documentation</a></p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Render Turnstile challenge page for admin authentication
 */
function renderTurnstileChallenge(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Authentication - Newsletter System</title>
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
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .auth-container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            text-align: center;
        }

        .auth-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }

        h1 {
            color: #333;
            font-size: 24px;
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
            min-height: 65px;
        }

        .info {
            background: #f0f4ff;
            border: 1px solid #667eea;
            color: #4a5568;
            padding: 12px;
            border-radius: 6px;
            font-size: 14px;
            margin-top: 20px;
        }

        .back-link {
            display: inline-block;
            margin-top: 20px;
            color: #667eea;
            text-decoration: none;
            font-size: 14px;
        }

        .back-link:hover {
            text-decoration: underline;
        }
    </style>
    <script src="${config.TURNSTILE_API_URL}" async defer></script>
</head>
<body>
    <div class="auth-container">
        <div class="auth-icon">🔐</div>
        <h1>Admin Authentication</h1>
        <p>Please verify you're authorized to access the admin panel</p>

        <form id="authForm" method="POST" action="/admin">
            <div class="turnstile-widget">
                <div class="cf-turnstile"
                     data-sitekey="${config.TURNSTILE_SITE_KEY}"
                     data-callback="onTurnstileSuccess"
                     data-error-callback="onTurnstileError">
                </div>
            </div>

            <input type="hidden" name="cf-turnstile-response" id="turnstileResponse">
        </form>

        <div class="info">
            🛡️ This area is protected by Cloudflare Turnstile and can be further secured with Zero Trust
        </div>

        <a href="/" class="back-link">← Back to Home</a>
    </div>

    <script>
        function onTurnstileSuccess(token) {
            document.getElementById('turnstileResponse').value = token;
            document.getElementById('authForm').submit();
        }

        function onTurnstileError() {
            alert('Turnstile verification failed. Please try again.');
        }
    </script>
</body>
</html>`;
}

/**
 * Handle admin panel request
 */
export async function handleAdminPanel(request, env, config) {
  const url = new URL(request.url);

  // Check if this is a POST request with Turnstile token
  if (request.method === 'POST') {
    try {
      const formData = await request.formData();
      const token = formData.get('cf-turnstile-response');

      if (!token) {
        return new Response(renderAdminPanel(config, false), {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // Verify Turnstile token
      const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
      const verifyResponse = await fetch(config.TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: config.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: clientIp
        })
      });

      const result = await verifyResponse.json();

      if (result.success) {
        // Set a session cookie
        const response = new Response(renderAdminPanel(config, true), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': `admin_session=${Date.now()}_${Math.random().toString(36).substring(7)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`
          }
        });
        return response;
      }
    } catch (error) {
      console.error('Admin authentication error:', error);
    }

    // Authentication failed
    return new Response(renderAdminPanel(config, false), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // Check for existing session cookie
  const cookieHeader = request.headers.get('cookie') || '';
  const hasAdminSession = cookieHeader.includes('admin_session=');

  // Render the appropriate page
  return new Response(renderAdminPanel(config, hasAdminSession), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}