/**
 * Newsletter Unsubscribe Frontend Module
 */

import { validateEmail, getClientIp } from '../../utils/validation.js';
import { removeSubscriber, checkRateLimit, verifyTurnstile } from '../../utils/kv.js';

/**
 * Handle unsubscribe requests
 */
export async function handleUnsubscribe(request, env, config) {
  const url = new URL(request.url);

  // Handle GET request - return HTML form
  if (request.method === 'GET' && url.pathname === config.UNSUBSCRIBE_WEB_PATH) {
    return new Response(getUnsubscribeFormHTML(config), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  // Handle POST request - process unsubscription
  if (request.method === 'POST' && url.pathname === config.UNSUBSCRIBE_API_PATH) {
    return await processUnsubscription(request, env, config);
  }

  // Handle OPTIONS request - CORS preflight
  if (request.method === 'OPTIONS' && url.pathname === config.UNSUBSCRIBE_API_PATH) {
    return new Response(null, {
      headers: getCORSHeaders()
    });
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Process unsubscription request
 */
async function processUnsubscription(request, env, config) {
  try {
    // Parse request
    const contentType = request.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      data = Object.fromEntries(formData);
    } else {
      return jsonResponse({ error: 'Invalid content type' }, 400);
    }

    // Validate email
    const emailValidation = validateEmail(data.email);
    if (!emailValidation.valid) {
      return jsonResponse({ error: emailValidation.error }, 400);
    }

    const email = emailValidation.email;

    // Check rate limit
    const clientIp = getClientIp(request);
    const rateLimit = await checkRateLimit(env, config, clientIp);

    if (!rateLimit.allowed) {
      return jsonResponse({
        error: 'Too many submissions. Please try again later.',
        retryAfter: config.RATE_LIMIT_WINDOW_HOURS * 3600
      }, 429);
    }

    // Verify Turnstile
    if (config.TURNSTILE_SECRET_KEY) {
      const token = data.turnstileToken || data['cf-turnstile-response'];
      if (!token) {
        return jsonResponse({ error: 'Verification token required' }, 400);
      }

      const isValid = await verifyTurnstile(token, clientIp, config.TURNSTILE_SECRET_KEY);
      if (!isValid) {
        return jsonResponse({ error: 'Verification failed. Please try again.' }, 400);
      }
    }

    // Remove subscriber
    const result = await removeSubscriber(env, config, email);

    if (!result.success) {
      return jsonResponse({
        error: result.message || 'Email not found in our list',
        email: email
      }, 400);
    }

    return jsonResponse({
      message: 'Successfully unsubscribed. You will no longer receive our newsletters.',
      email: email
    }, 200);

  } catch (error) {
    console.error('Unsubscription error:', error);
    return jsonResponse({ error: 'An error occurred. Please try again.' }, 500);
  }
}

/**
 * Get unsubscribe form HTML
 */
function getUnsubscribeFormHTML(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribe from Newsletter</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            padding: 32px;
            width: 100%;
            max-width: 480px;
        }

        h2 {
            color: #333;
            margin-bottom: 8px;
            font-size: 24px;
            font-weight: 600;
        }

        .subtitle {
            color: #666;
            margin-bottom: 24px;
            font-size: 14px;
        }

        .warning {
            background: #fff3cd;
            border: 1px solid #ffc107;
            color: #856404;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
            font-size: 14px;
        }

        input[type="email"] {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
        }

        input[type="email"]:focus {
            outline: none;
            border-color: #dc3545;
            box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.1);
        }

        button {
            width: 100%;
            padding: 12px 24px;
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(220, 53, 69, 0.3);
        }

        button:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }

        .notice {
            margin-top: 20px;
            padding: 12px;
            border-radius: 8px;
            font-size: 14px;
            display: none;
        }

        .notice.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
            display: block;
        }

        .notice.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            display: block;
        }

        .resubscribe {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            text-align: center;
            font-size: 14px;
        }

        .resubscribe a {
            color: #667eea;
            text-decoration: none;
        }

        .resubscribe a:hover {
            text-decoration: underline;
        }

        .turnstile-widget {
            margin-top: 20px;
            display: flex;
            justify-content: center;
        }

        @media (max-width: 480px) {
            .container {
                padding: 24px;
            }
        }
    </style>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
    <div class="container">
        <h2>😔 Unsubscribe from Newsletter</h2>
        <p class="subtitle">We're sorry to see you go</p>

        <div class="warning">
            ⚠️ After unsubscribing, you will no longer receive our newsletter updates.
            You can always subscribe again later if you change your mind.
        </div>

        <form id="unsubscribeForm">
            <div class="form-group">
                <label for="email">Email Address</label>
                <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="your@email.com"
                    required
                    autocomplete="email"
                >
            </div>

            <div class="turnstile-widget">
                <div class="cf-turnstile"
                     data-sitekey="${config.TURNSTILE_SITE_KEY}"
                     data-theme="light"
                     data-size="normal">
                </div>
            </div>

            <button type="submit" id="submitBtn">Unsubscribe</button>
        </form>

        <div id="notice" class="notice"></div>

        <div class="resubscribe">
            Changed your mind? <a href="${config.SUBSCRIBE_WEB_PATH}">Subscribe again</a>
        </div>
    </div>

    <script>
        const form = document.getElementById('unsubscribeForm');
        const submitBtn = document.getElementById('submitBtn');
        const notice = document.getElementById('notice');
        const emailInput = document.getElementById('email');

        // Check for email in URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const emailParam = urlParams.get('email');
        if (emailParam) {
            emailInput.value = emailParam;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Confirmation
            if (!confirm('Are you sure you want to unsubscribe from our newsletter?')) {
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
            notice.className = 'notice';
            notice.textContent = '';

            try {
                const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');

                const response = await fetch('${config.UNSUBSCRIBE_API_PATH}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: emailInput.value,
                        turnstileToken: turnstileResponse ? turnstileResponse.value : ''
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    notice.className = 'notice success';
                    notice.textContent = data.message || 'Successfully unsubscribed!';
                    form.reset();

                    // Reset Turnstile
                    if (window.turnstile) {
                        window.turnstile.reset();
                    }
                } else {
                    notice.className = 'notice error';
                    notice.textContent = data.error || 'Unsubscription failed. Please try again.';
                }
            } catch (error) {
                notice.className = 'notice error';
                notice.textContent = 'Network error. Please check your connection and try again.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Unsubscribe';
            }
        });

        // Auto-resize for iframe
        if (window.parent !== window) {
            const sendHeight = () => {
                const height = document.body.scrollHeight;
                window.parent.postMessage({
                    type: 'newsletter-iframe-height',
                    height: height
                }, '*');
            };

            sendHeight();
            window.addEventListener('resize', sendHeight);

            // Listen for ping
            window.addEventListener('message', (e) => {
                if (e.data === 'newsletter-iframe-ping') {
                    sendHeight();
                }
            });
        }
    </script>
</body>
</html>`;
}

/**
 * Get CORS headers
 */
function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Create JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCORSHeaders()
    }
  });
}