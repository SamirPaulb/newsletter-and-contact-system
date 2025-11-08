/**
 * Gmail SMTP Email Provider using worker-mailer
 */

import { WorkerMailer } from 'worker-mailer';
import { withRetry, CircuitBreaker } from '../utils/retry.js';

export class GmailProvider {
  constructor(config) {
    this.config = config;
    // Initialize circuit breaker for SMTP connections
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 60000 // 1 minute
    });
  }

  /**
   * Send email via Gmail SMTP using worker-mailer
   */
  async sendEmail({ to, subject, html, text, replyTo }) {
    // Use circuit breaker and retry logic
    const result = await this.circuitBreaker.execute(async () => {
      return await withRetry(async (attempt) => {
        console.log(`Sending email attempt ${attempt} to ${Array.isArray(to) ? to.length : 1} recipient(s)`);

        // Prepare email options
        const emailOptions = {
          from: {
            name: this.config.EMAIL_FROM_NAME || 'Newsletter',
            email: this.config.EMAIL_FROM_ADDRESS || this.config.GMAIL_USER
          },
          to: Array.isArray(to) ? to : [to],
          subject: subject,
          html: html,
          text: text || this.stripHtml(html),
          headers: {
            'List-Unsubscribe': `<${this.config.UNSUBSCRIBE_URL}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          }
        };

        // Add reply-to if provided
        if (replyTo || this.config.EMAIL_REPLY_TO) {
          emailOptions.reply = replyTo || this.config.EMAIL_REPLY_TO;
        }

        // Connect and send using worker-mailer
        const mailer = await WorkerMailer.connect({
          credentials: {
            username: this.config.GMAIL_USER,
            password: this.config.GMAIL_PASSWORD
          },
          authType: 'plain',
          host: this.config.GMAIL_HOST,
          port: this.config.GMAIL_PORT,
          secure: this.config.GMAIL_PORT === 465,
          startTls: this.config.GMAIL_PORT === 587
        });

        await mailer.send(emailOptions);

        return {
          success: true,
          message: `Email sent successfully to ${Array.isArray(to) ? to.length : 1} recipient(s)`
        };
      }, {
        maxAttempts: 3,
        initialDelay: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'NetworkError']
      });
    }).catch(error => {
      console.error('Gmail send failed after retries:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email via Gmail',
        circuitBreakerOpen: this.circuitBreaker.state === 'OPEN'
      };
    });

    return result;
  }

  /**
   * Send batch emails with BCC to avoid exposing recipient list
   */
  async sendBatchEmail({ recipients, subject, html, text }) {
    // Split recipients into smaller batches to respect Gmail limits
    const batchSize = 50; // Gmail BCC limit per email
    const batches = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      batches.push(recipients.slice(i, i + batchSize));
    }

    const results = {
      successful: [],
      failed: [],
      totalSent: 0,
      totalFailed: 0
    };

    // Process each batch with retry logic
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing email batch ${i + 1}/${batches.length} with ${batch.length} recipients`);

      const batchResult = await this.circuitBreaker.execute(async () => {
        return await withRetry(async (attempt) => {
          console.log(`Batch ${i + 1} attempt ${attempt}`);

          // Connect to Gmail SMTP
          const mailer = await WorkerMailer.connect({
            credentials: {
              username: this.config.GMAIL_USER,
              password: this.config.GMAIL_PASSWORD
            },
            authType: 'plain',
            host: this.config.GMAIL_HOST,
            port: this.config.GMAIL_PORT,
            secure: this.config.GMAIL_PORT === 465,
            startTls: this.config.GMAIL_PORT === 587,
            socketTimeoutMs: 30000,
            responseTimeoutMs: 30000
          });

          // Send with BCC to hide recipient list
          await mailer.send({
            from: {
              name: this.config.EMAIL_FROM_NAME || 'Newsletter',
              email: this.config.EMAIL_FROM_ADDRESS || this.config.GMAIL_USER
            },
            to: this.config.EMAIL_FROM_ADDRESS || this.config.GMAIL_USER, // Send to self
            bcc: batch, // All recipients in BCC
            subject: subject,
            html: html,
            text: text || this.stripHtml(html),
            headers: {
              'List-Unsubscribe': `<${this.config.UNSUBSCRIBE_URL}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              'Precedence': 'bulk',
              'X-Batch-Number': `${i + 1}/${batches.length}`
            }
          });

          return {
            batchNumber: i + 1,
            recipients: batch,
            count: batch.length,
            success: true
          };
        }, {
          maxAttempts: 3,
          initialDelay: 3000,
          backoffMultiplier: 2,
          maxDelay: 30000
        });
      }).catch(error => {
        console.error(`Failed to send batch ${i + 1} after retries:`, error);
        return {
          batchNumber: i + 1,
          recipients: batch,
          count: batch.length,
          success: false,
          error: error.message
        };
      });

      if (batchResult.success) {
        results.successful.push(batchResult);
        results.totalSent += batchResult.count;
      } else {
        results.failed.push(batchResult);
        results.totalFailed += batchResult.count;

        // If circuit breaker is open, stop processing
        if (this.circuitBreaker.state === 'OPEN') {
          console.error('Circuit breaker is open, stopping batch processing');
          break;
        }
      }

      // Add delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        const delay = Math.min(5000, 2000 * (i + 1)); // Progressive delay, max 5 seconds
        console.log(`Waiting ${delay}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      success: results.totalFailed === 0,
      message: `Sent to ${results.totalSent}/${recipients.length} recipients`,
      totalSent: results.totalSent,
      totalFailed: results.totalFailed,
      batches: {
        successful: results.successful.length,
        failed: results.failed.length,
        total: batches.length
      },
      details: results,
      circuitBreakerState: this.circuitBreaker.state
    };
  }

  /**
   * Validate Gmail configuration
   */
  static validateConfig(config) {
    const errors = [];

    if (!config.GMAIL_USER) {
      errors.push('GMAIL_USER is required for Gmail provider');
    }

    if (!config.GMAIL_PASSWORD) {
      errors.push('GMAIL_PASSWORD is required for Gmail provider');
    }

    if (!config.GMAIL_HOST) {
      errors.push('GMAIL_HOST is required for Gmail provider');
    }

    if (!config.GMAIL_PORT) {
      errors.push('GMAIL_PORT is required for Gmail provider');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Strip HTML tags from content
   */
  stripHtml(html) {
    if (!html) return '';

    // Remove HTML tags first (non-greedy, safe pattern)
    let text = html.replace(/<[^>]+>/g, '');

    // Decode HTML entities in a single pass to avoid double-decoding
    const htmlEntities = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'"
    };

    // Use a single regex replacement with callback
    text = text.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, match => htmlEntities[match] || match);

    return text.trim();
  }
}