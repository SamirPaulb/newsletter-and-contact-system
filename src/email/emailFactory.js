/**
 * Email Factory - Selects and initializes the appropriate email provider
 */

import { GmailProvider } from './gmailProvider.js';
import { WorkerEmailProvider } from './workerEmailProvider.js';

export class EmailFactory {
    /**
     * Create email provider based on configuration
     */
    static createProvider(config, env) {
        const provider = config.EMAIL_PROVIDER?.toLowerCase();

        switch (provider) {
            case 'gmail':
                // Validate Gmail configuration
                const gmailValidation = GmailProvider.validateConfig(config);
                if (!gmailValidation.valid) {
                    throw new Error(`Gmail configuration errors: ${gmailValidation.errors.join(', ')}`);
                }
                return new GmailProvider(config);

            case 'worker-email':
                // Validate Worker Email configuration
                const workerValidation = WorkerEmailProvider.validateConfig(config);
                if (!workerValidation.valid) {
                    throw new Error(`Worker Email configuration errors: ${workerValidation.errors.join(', ')}`);
                }
                return new WorkerEmailProvider(config, env);

            default:
                throw new Error(`Unknown email provider: ${provider}. Supported: gmail, worker-email`);
        }
    }

    /**
     * Send newsletter email
     */
    static async sendNewsletter(config, env, { recipients, post }) {
        const provider = this.createProvider(config, env);

        // Create newsletter HTML content
        const html = this.createNewsletterHtml(post, config);
        const text = this.createNewsletterText(post, config);

        // Send using the selected provider
        return await provider.sendBatchEmail({
            recipients: recipients,
            subject: post.title,
            html: html,
            text: text
        });
    }

    /**
     * Send contact form email
     */
    static async sendContactEmail(config, env, { contactData, toOwner = true }) {
        const provider = this.createProvider(config, env);

        if (toOwner) {
            // Email to website owner
            const html = this.createContactOwnerHtml(contactData);
            const text = this.createContactOwnerText(contactData);

            return await provider.sendEmail({
                to: config.EMAIL_FROM_ADDRESS || config.GMAIL_USER || config.WORKER_EMAIL_FROM,
                subject: `New Contact Form Submission from ${contactData.name}`,
                html: html,
                text: text,
                replyTo: contactData.email
            });
        } else {
            // Confirmation email to sender
            const html = this.createContactConfirmationHtml(contactData, config);
            const text = this.createContactConfirmationText(contactData, config);

            return await provider.sendEmail({
                to: contactData.email,
                subject: 'Thank you for contacting us',
                html: html,
                text: text
            });
        }
    }

    /**
     * Create newsletter HTML content
     */
    static createNewsletterHtml(post, config) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${post.title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 0;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            margin: 20px auto;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }
        .content {
            padding: 30px 20px;
        }
        .content h2 {
            color: #333;
            margin-top: 0;
            font-size: 20px;
        }
        .content p {
            color: #666;
            margin: 15px 0;
        }
        .button {
            display: inline-block;
            padding: 12px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: 500;
            margin: 20px 0;
        }
        .footer {
            background-color: #f8f9fa;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #666;
            border-top: 1px solid #e9ecef;
        }
        .footer a {
            color: #667eea;
            text-decoration: none;
        }
        .post-link {
            word-break: break-all;
            color: #667eea;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📬 ${config.EMAIL_FROM_NAME || 'Newsletter'}</h1>
        </div>
        <div class="content">
            <h2>${post.title}</h2>
            ${post.description ? `<p>${post.description}</p>` : ''}
            <p>We've published a new article that we think you'll find interesting.</p>
            <center>
                <a href="${post.url}" class="button">Read Now →</a>
            </center>
            <p style="font-size: 14px; color: #999; margin-top: 20px;">
                Article link: <a href="${post.url}" class="post-link">${post.url}</a>
            </p>
        </div>
        <div class="footer">
            <p>You're receiving this because you subscribed to our newsletter.</p>
            <p>
                <a href="${config.UNSUBSCRIBE_URL}">Unsubscribe</a> |
                <a href="${config.SITE_URL}">Visit our website</a>
            </p>
            <p style="margin-top: 15px; color: #999;">
                © ${new Date().getFullYear()} ${config.SITE_OWNER}. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Create newsletter text content
     */
    static createNewsletterText(post, config) {
        return `${config.EMAIL_FROM_NAME || 'Newsletter'}
=====================================

${post.title}

${post.description || 'We\'ve published a new article that we think you\'ll find interesting.'}

Read the full article: ${post.url}

-------------------------------------

You're receiving this because you subscribed to our newsletter.

Unsubscribe: ${config.UNSUBSCRIBE_URL}
Visit our website: ${config.SITE_URL}

© ${new Date().getFullYear()} ${config.SITE_OWNER}. All rights reserved.`;
    }

    /**
     * Create contact owner HTML
     */
    static createContactOwnerHtml(contactData) {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .field { margin-bottom: 15px; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; margin-top: 5px; }
        .message { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>New Contact Form Submission</h2>
        <div class="field">
            <div class="label">Name:</div>
            <div class="value">${contactData.name}</div>
        </div>
        <div class="field">
            <div class="label">Email:</div>
            <div class="value"><a href="mailto:${contactData.email}">${contactData.email}</a></div>
        </div>
        ${contactData.phone ? `
        <div class="field">
            <div class="label">Phone:</div>
            <div class="value">${contactData.phone}</div>
        </div>
        ` : ''}
        <div class="field">
            <div class="label">Message:</div>
            <div class="message">${contactData.message.replace(/\n/g, '<br>')}</div>
        </div>
        <div class="field">
            <div class="label">Submitted At:</div>
            <div class="value">${new Date(contactData.submittedAt).toLocaleString()}</div>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Create contact owner text
     */
    static createContactOwnerText(contactData) {
        return `New Contact Form Submission
============================

Name: ${contactData.name}
Email: ${contactData.email}
${contactData.phone ? `Phone: ${contactData.phone}` : ''}
Message:
${contactData.message}

Submitted At: ${new Date(contactData.submittedAt).toLocaleString()}`;
    }

    /**
     * Create contact confirmation HTML
     */
    static createContactConfirmationHtml(contactData, config) {
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 5px; text-align: center; }
        .content { margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Thank You for Contacting Us!</h2>
        </div>
        <div class="content">
            <p>Hi ${contactData.name},</p>
            <p>We've received your message and will get back to you as soon as possible.</p>
            <p>Here's a copy of your submission:</p>
            <blockquote style="background: #f5f5f5; padding: 15px; border-left: 3px solid #667eea; margin: 20px 0;">
                ${contactData.message.replace(/\n/g, '<br>')}
            </blockquote>
            <p>Best regards,<br>${config.SITE_OWNER || 'The Team'}</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Create contact confirmation text
     */
    static createContactConfirmationText(contactData, config) {
        return `Thank You for Contacting Us!
============================

Hi ${contactData.name},

We've received your message and will get back to you as soon as possible.

Here's a copy of your submission:

${contactData.message}

Best regards,
${config.EMAIL_FROM_NAME || 'The Team'}`;
    }
}