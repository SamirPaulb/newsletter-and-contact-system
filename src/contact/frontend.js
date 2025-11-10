/**
 * Contact Form Frontend Module
 */

import { validateEmail, validatePhone, validateRequired, getClientIp, sanitizeHtml } from '../utils/validation.js';
import { checkRateLimit, verifyTurnstile, storeContact, addSubscriber } from '../utils/kv.js';
import { checkNativeFormRateLimit } from '../utils/nativeRateLimit.js';
import { saveContactToGitHub } from '../utils/github.js';
import { EmailFactory } from '../email/emailFactory.js';
import { replicateContactToD1, replicateSubscriberToD1 } from '../utils/d1Replication.js';

/**
 * Handle contact form requests
 */
export async function handleContact(request, env, config, ctx) {
  const url = new URL(request.url);

  // Handle GET request - return HTML form
  if (request.method === 'GET' && url.pathname === config.CONTACT_WEB_PATH) {
    return new Response(getContactFormHTML(config), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex'
      }
    });
  }

  // Handle POST request - process contact form
  if (request.method === 'POST' && url.pathname === config.CONTACT_API_PATH) {
    return await processContactForm(request, env, config, ctx);
  }

  // Handle OPTIONS request - CORS preflight
  if (request.method === 'OPTIONS' && url.pathname === config.CONTACT_API_PATH) {
    return new Response(null, {
      headers: getCORSHeaders(config)
    });
  }

  return new Response('Not Found', { status: 404 });
}

/**
 * Process contact form submission
 */
async function processContactForm(request, env, config, ctx) {
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

    // Validate fields
    const nameValidation = validateRequired(data.name, 'Name');
    if (!nameValidation.valid) {
      return jsonResponse({ error: nameValidation.error }, 400, config);
    }

    const emailValidation = validateEmail(data.email);
    if (!emailValidation.valid) {
      return jsonResponse({ error: emailValidation.error }, 400, config);
    }

    const phoneValidation = validatePhone(data.phone);
    if (!phoneValidation.valid) {
      return jsonResponse({ error: phoneValidation.error }, 400, config);
    }

    const messageValidation = validateRequired(data.message, 'Message');
    if (!messageValidation.valid) {
      return jsonResponse({ error: messageValidation.error }, 400, config);
    }

    // FIRST: Check native rate limit for forms
    const nativeCheck = await checkNativeFormRateLimit(request, env, 'contact');
    if (!nativeCheck.allowed) {
      return jsonResponse({
        error: nativeCheck.reason || 'Too many submissions. Please wait a minute and try again.',
        retryAfter: 60
      }, 429, config);
    }

    // SECOND: Check KV-based rate limit (more restrictive, 24-hour window)
    const clientIp = getClientIp(request);
    const rateLimit = await checkRateLimit(env, config, clientIp);

    if (!rateLimit.allowed) {
      return jsonResponse({
        error: 'Too many submissions. Please try again later.',
        retryAfter: config.RATE_LIMIT_WINDOW_HOURS * 3600
      }, 429, config);
    }

    // Verify Turnstile
    if (config.TURNSTILE_SECRET_KEY) {
      const token = data.turnstileToken || data['cf-turnstile-response'];
      if (!token) {
        return jsonResponse({ error: 'Verification token required' }, 400, config);
      }

      const isValid = await verifyTurnstile(token, clientIp, config.TURNSTILE_SECRET_KEY);
      if (!isValid) {
        return jsonResponse({ error: 'Verification failed. Please try again.' }, 400, config);
      }
    }

    // Check if email is subscribed
    const subscriberKey = `${config.PREFIX_SUBSCRIBER}${emailValidation.email}`;
    const subscriberData = await env.KV.get(subscriberKey);
    const isSubscribed = !!subscriberData;

    // Prepare contact data with IP and subscription status
    const contactData = {
      name: sanitizeHtml(nameValidation.value),
      email: emailValidation.email,
      phone: phoneValidation.phone,
      message: sanitizeHtml(messageValidation.value),
      subscribed: isSubscribed,
      ipAddress: clientIp,
      timestamp: new Date().toISOString()
    };

    // Store in KV
    const contactKey = await storeContact(env, config, contactData);

    // Auto-subscribe to newsletter if requested
    if (data.subscribe === true && !isSubscribed) {
      await addSubscriber(env, config, emailValidation.email, clientIp);

      // Replicate subscriber to D1 (async, non-blocking)
      replicateSubscriberToD1(env, ctx, emailValidation.email, clientIp, new Date().toISOString());
    }

    // Replicate contact to D1 (async, non-blocking)
    // This runs in background and won't affect response time
    replicateContactToD1(env, ctx, contactData);

    // Save to GitHub
    const githubResult = await saveContactToGitHub(config, contactData);
    if (!githubResult.success) {
      console.error('Failed to save to GitHub:', githubResult.error);
    }

    // Send email notifications with retry
    try {
      // Email to owner
      let ownerEmailSent = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const ownerResult = await EmailFactory.sendContactEmail(config, env, {
            contactData: contactData,
            toOwner: true
          });
          if (ownerResult.success) {
            ownerEmailSent = true;
            break;
          }
          console.warn(`Failed to send owner email (attempt ${attempt}/3): ${ownerResult.error}`);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        } catch (error) {
          console.error(`Owner email error on attempt ${attempt}:`, error);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // Confirmation email to sender
      let confirmationEmailSent = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const confirmResult = await EmailFactory.sendContactEmail(config, env, {
            contactData: contactData,
            toOwner: false
          });
          if (confirmResult.success) {
            confirmationEmailSent = true;
            break;
          }
          console.warn(`Failed to send confirmation email (attempt ${attempt}/3): ${confirmResult.error}`);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        } catch (error) {
          console.error(`Confirmation email error on attempt ${attempt}:`, error);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // Log results
      if (ownerEmailSent && confirmationEmailSent) {
        console.log('Both contact emails sent successfully');
      } else {
        console.warn(`Email delivery incomplete: owner=${ownerEmailSent}, confirmation=${confirmationEmailSent}`);
      }
    } catch (emailError) {
      console.error('Failed to send email notifications:', emailError);
    }

    // Return appropriate response based on email delivery status
    if (!ownerEmailSent && !confirmationEmailSent) {
      // Both emails failed - still save contact but warn user
      return jsonResponse({
        message: 'Your message has been saved, but email notifications could not be sent. We will still review your message.',
        warning: 'Email delivery failed'
      }, 200, config);
    } else if (!ownerEmailSent || !confirmationEmailSent) {
      // Partial failure
      return jsonResponse({
        message: 'Thank you for contacting us! Your message has been received.',
        warning: 'Partial email delivery'
      }, 200, config);
    }

    return jsonResponse({
      message: 'Thank you for contacting us! We will get back to you soon.'
    }, 200, config);

  } catch (error) {
    console.error('Contact form error:', error);
    return jsonResponse({ error: 'An error occurred. Please try again.' }, 500, config);
  }
}

/**
 * Get contact form HTML
 */
function getContactFormHTML(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Us</title>

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
            max-width: 520px;
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

        .required {
            color: #dc3545;
        }

        input[type="text"],
        input[type="email"],
        input[type="tel"],
        textarea {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            font-family: inherit;
            transition: all 0.3s ease;
        }

        input:focus,
        textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        textarea {
            min-height: 120px;
            resize: vertical;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }

        input[type="checkbox"] {
            margin-right: 8px;
        }

        .checkbox-label {
            font-size: 14px;
            color: #666;
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

        .turnstile-widget {
            margin-top: 20px;
            margin-bottom: 20px;
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
        <h2>📧 Drop Me a Message</h2>
        <p class="subtitle">We'd love to hear from you! Send us a message.</p>

        <form id="contactForm">
            <div class="form-group">
                <label for="name">Name <span class="required">*</span></label>
                <input
                    type="text"
                    id="name"
                    name="name"
                    placeholder="John Doe"
                    required
                    autocomplete="name"
                >
            </div>

            <div class="form-group">
                <label for="email">Email Address <span class="required">*</span></label>
                <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="john.doe@example.com"
                    required
                    autocomplete="email"
                >
            </div>

            <div class="form-group">
                <label for="phone">Phone Number (Optional)</label>
                <input
                    type="tel"
                    id="phone"
                    name="phone"
                    placeholder="+1 (555) 123-4567"
                    autocomplete="tel"
                >
            </div>

            <div class="form-group">
                <label for="message">Message <span class="required">*</span></label>
                <textarea
                    id="message"
                    name="message"
                    required
                    placeholder="Tell us how we can help you..."
                ></textarea>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="subscribe" name="subscribe" checked>
                <label for="subscribe" class="checkbox-label">
                    Subscribe to the newsletter for updates
                </label>
            </div>

            <div class="turnstile-widget">
                <div class="cf-turnstile"
                     data-sitekey="${config.TURNSTILE_SITE_KEY}"
                     data-theme="light"
                     data-size="normal">
                </div>
            </div>

            <button type="submit" id="submitBtn">Send Message</button>
        </form>

        <div id="notice" class="notice"></div>
    </div>

    <script>
        const form = document.getElementById('contactForm');
        const submitBtn = document.getElementById('submitBtn');
        const notice = document.getElementById('notice');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';
            notice.className = 'notice';
            notice.textContent = '';

            try {
                const turnstileResponse = document.querySelector('[name="cf-turnstile-response"]');
                const formData = new FormData(form);

                const response = await fetch('${config.CONTACT_API_PATH}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: formData.get('name'),
                        email: formData.get('email'),
                        phone: formData.get('phone'),
                        message: formData.get('message'),
                        subscribe: formData.get('subscribe') === 'on',
                        turnstileToken: turnstileResponse ? turnstileResponse.value : ''
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    notice.className = 'notice success';
                    notice.textContent = data.message || 'Message sent successfully!';
                    form.reset();

                    // Reset Turnstile
                    if (window.turnstile) {
                        window.turnstile.reset();
                    }
                } else {
                    notice.className = 'notice error';
                    notice.textContent = data.error || 'Failed to send message. Please try again.';
                }
            } catch (error) {
                notice.className = 'notice error';
                notice.textContent = 'Network error. Please check your connection and try again.';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Message';
            }
        });

        // Auto-resize for iframe
        if (window.parent !== window) {
            const sendHeight = () => {
                const height = document.body.scrollHeight;
                window.parent.postMessage({
                    type: 'contact-iframe-height',
                    height: height
                }, '*');
            };

            sendHeight();
            window.addEventListener('resize', sendHeight);

            // Listen for ping
            window.addEventListener('message', (e) => {
                if (e.data === 'contact-iframe-ping') {
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