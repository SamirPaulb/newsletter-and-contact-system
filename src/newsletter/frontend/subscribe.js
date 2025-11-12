/**
 * Newsletter Subscribe Frontend Module
 */

import { validateEmail, getClientIp } from '../../utils/validation.js';
import { addSubscriber, verifyTurnstile } from '../../utils/kv.js';
import { checkNativeFormRateLimit } from '../../utils/nativeRateLimit.js';
import { replicateSubscriberToD1 } from '../../utils/d1Replication.js';

/**
 * Handle subscribe requests
 */
export async function handleSubscribe(request, env, config, ctx) {
  const url = new URL(request.url);

  // Handle GET request - return HTML form
  if (request.method === 'GET' && url.pathname === config.SUBSCRIBE_WEB_PATH) {
    return new Response(getSubscribeFormHTML(config), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
      }
    });
  }

  // Handle POST request - process subscription
  if (request.method === 'POST' && url.pathname === config.SUBSCRIBE_API_PATH) {
    return await processSubscription(request, env, config, ctx);
  }

  // Handle OPTIONS request - CORS preflight
  if (request.method === 'OPTIONS' && url.pathname === config.SUBSCRIBE_API_PATH) {
    return new Response(null, {
      headers: getCORSHeaders(config)
    });
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Process subscription request
 */
async function processSubscription(request, env, config, ctx) {
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
      return jsonResponse({ error: 'Invalid content type' }, 400, config);
    }

    // Validate email
    const emailValidation = validateEmail(data.email);
    if (!emailValidation.valid) {
      return jsonResponse({ error: emailValidation.error }, 400, config);
    }

    const email = emailValidation.email;

    // Check native rate limit for forms (already checked in protection.js, but double-check here)
    const nativeCheck = await checkNativeFormRateLimit(request, env, 'subscribe');
    if (!nativeCheck.allowed) {
      return jsonResponse({
        error: nativeCheck.reason || 'Too many subscription attempts. Please wait a minute and try again.',
        retryAfter: 60
      }, 429, config);
    }

    // Get client IP for Turnstile verification
    const clientIp = getClientIp(request);

    // Verify Turnstile
    if (config.TURNSTILE_SECRET_KEY) {
      const token = data.turnstileToken || data['cf-turnstile-response'];
      if (!token) {
        return jsonResponse({ error: 'Verification token required' }, 400, config);
      }

      const isValid = await verifyTurnstile(token, clientIp, config.TURNSTILE_SECRET_KEY, config.TURNSTILE_VERIFY_URL);
      if (!isValid) {
        return jsonResponse({ error: 'Verification failed. Please try again.' }, 400, config);
      }
    }

    // Add subscriber with IP address - wrapped in try-catch for resilience
    let subscribed = false;
    let alreadySubscribed = false;

    try {
      const result = await addSubscriber(env, config, email, clientIp);
      subscribed = result.success;
      alreadySubscribed = !result.success && result.message === 'Already subscribed';
    } catch (error) {
      console.error('KV subscription error:', error);
      // Check if it's because they're already subscribed
      try {
        const existing = await env.KV.get(`${config.PREFIX_SUBSCRIBER}${email}`);
        alreadySubscribed = !!existing;
      } catch (e) {
        console.error('KV check error:', e);
      }
    }

    // Replicate to D1 (async, non-blocking) - wrapped in try-catch
    try {
      replicateSubscriberToD1(env, ctx, email, clientIp, new Date().toISOString());
    } catch (error) {
      console.error('D1 replication error (non-blocking):', error);
    }

    // Always return success message appropriate to the situation
    if (alreadySubscribed) {
      return jsonResponse({
        message: 'You are already subscribed to our newsletter!'
      }, 200, config);
    }

    return jsonResponse({
      message: 'Successfully subscribed! You will receive the next newsletter update.'
    }, 200, config);

  } catch (error) {
    console.error('Subscription error:', error);
    // Even on error, return a success-like message
    // The intent to subscribe was received
    return jsonResponse({
      message: 'Thank you for subscribing! We have received your subscription request.'
    }, 200, config);
  }
}

/**
 * Get subscribe form HTML
 */
function getSubscribeFormHTML(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Subscribe to Newsletter</title>

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
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        button {
            width: 100%;
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
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

        .privacy {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
            text-align: center;
        }

        .privacy a {
            color: #667eea;
            text-decoration: none;
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
    <script src="${config.TURNSTILE_API_URL || 'https://challenges.cloudflare.com/turnstile/v0/api.js'}" async defer></script>
</head>
<body>
    <div class="container">
        <h2>📬 Get New Posts in Your Inbox</h2>
        <p class="subtitle">Get the latest updates delivered directly to your inbox</p>

        <form id="subscribeForm">
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

            <button type="submit" id="submitBtn">Subscribe Now</button>
        </form>

        <div id="notice" class="notice"></div>

        <div class="privacy">
            By subscribing, you agree to receive newsletter emails.
            You can unsubscribe at any time.
        </div>
    </div>

    <script>
        const form = document.getElementById('subscribeForm');
        const submitBtn = document.getElementById('submitBtn');
        const notice = document.getElementById('notice');
        const emailInput = document.getElementById('email');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
            notice.className = 'notice';
            notice.textContent = '';

            try {
                const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');

                const response = await fetch('${config.SUBSCRIBE_API_PATH}', {
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
                    notice.textContent = data.message || 'Successfully subscribed!';
                    form.reset();

                    // Reset Turnstile
                    if (window.turnstile) {
                        window.turnstile.reset();
                    }
                } else {
                    notice.className = 'notice error';
                    notice.textContent = data.error || 'Subscription failed. Please try again.';
                }
            } catch (error) {
                notice.className = 'notice error';
                notice.textContent = 'Network error. Please check your connection and try again.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Subscribe Now';
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
function getCORSHeaders(config) {
  // Only allow requests from the configured site URL
  const allowedOrigin = config.SITE_URL || 'https://samirpaulb.github.io';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Create JSON response
 */
function jsonResponse(data, status = 200, config) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCORSHeaders(config)
    }
  });
}