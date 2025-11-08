/**
 * Cloudflare Worker Email Routing Provider
 * Requires custom domain with email routing configured
 */

export class WorkerEmailProvider {
  constructor(config, env) {
    this.config = config;
    this.env = env;
  }

  /**
   * Send email using Cloudflare Email Routing
   */
  async sendEmail({ to, subject, html, text, replyTo }) {
    try {
      // Create email message
      const message = this.createEmailMessage({
        from: {
          name: this.config.EMAIL_FROM_NAME || 'Newsletter',
          email: this.config.WORKER_EMAIL_FROM
        },
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html,
        text: text || this.stripHtml(html),
        replyTo: replyTo || this.config.EMAIL_REPLY_TO
      });

      // Send via Cloudflare Email service
      const result = await this.env.send(message);

      return {
        success: true,
        message: `Email sent successfully to ${Array.isArray(to) ? to.length : 1} recipient(s)`,
        messageId: result.messageId
      };
    } catch (error) {
      console.error('Worker Email send error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email via Worker Email'
      };
    }
  }

  /**
   * Send batch emails
   */
  async sendBatchEmail({ recipients, subject, html, text }) {
    try {
      const results = [];
      const batchSize = 50; // Send in batches to avoid limits

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        // Create message with BCC
        const message = this.createEmailMessage({
          from: {
            name: this.config.EMAIL_FROM_NAME || 'Newsletter',
            email: this.config.WORKER_EMAIL_FROM
          },
          to: this.config.WORKER_EMAIL_FROM, // Send to self
          bcc: batch, // Recipients in BCC
          subject: subject,
          html: html,
          text: text || this.stripHtml(html)
        });

        const result = await this.env.send(message);

        results.push({
          batch: batch.length,
          success: true,
          messageId: result.messageId
        });

        // Add delay between batches
        if (i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return {
        success: true,
        message: `Email sent to ${recipients.length} recipients`,
        details: results
      };
    } catch (error) {
      console.error('Worker Email batch send error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send batch email via Worker Email'
      };
    }
  }

  /**
   * Create email message object
   */
  createEmailMessage({ from, to, bcc, subject, html, text, replyTo }) {
    const message = new MimeMessage();

    // Set from
    message.setFrom(from.email, from.name);

    // Set recipients
    if (Array.isArray(to)) {
      to.forEach(recipient => {
        if (typeof recipient === 'string') {
          message.addTo(recipient);
        } else {
          message.addTo(recipient.email, recipient.name);
        }
      });
    } else if (to) {
      message.addTo(to);
    }

    // Set BCC if provided
    if (bcc) {
      const bccList = Array.isArray(bcc) ? bcc : [bcc];
      bccList.forEach(recipient => {
        if (typeof recipient === 'string') {
          message.addBcc(recipient);
        } else {
          message.addBcc(recipient.email, recipient.name);
        }
      });
    }

    // Set reply-to if provided
    if (replyTo) {
      message.setReplyTo(replyTo);
    }

    // Set subject
    message.setSubject(subject);

    // Set headers
    message.addHeader('List-Unsubscribe', `<${this.config.UNSUBSCRIBE_URL}>`);
    message.addHeader('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
    message.addHeader('Precedence', 'bulk');

    // Set content
    if (html && text) {
      message.setHtml(html);
      message.setText(text);
    } else if (html) {
      message.setHtml(html);
      message.setText(this.stripHtml(html));
    } else {
      message.setText(text);
    }

    return message;
  }

  /**
   * Validate Worker Email configuration
   */
  static validateConfig(config) {
    const errors = [];

    if (!config.WORKER_EMAIL_FROM) {
      errors.push('WORKER_EMAIL_FROM is required for Worker Email provider');
    }

    if (!config.WORKER_EMAIL_DOMAIN) {
      errors.push('WORKER_EMAIL_DOMAIN is required for Worker Email provider');
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

/**
 * Simple MIME message builder for Worker Email
 */
class MimeMessage {
  constructor() {
    this.headers = new Map();
    this.from = null;
    this.to = [];
    this.cc = [];
    this.bcc = [];
    this.subject = '';
    this.textContent = '';
    this.htmlContent = '';
  }

  setFrom(email, name) {
    this.from = name ? `"${name}" <${email}>` : email;
    this.headers.set('From', this.from);
  }

  addTo(email, name) {
    const recipient = name ? `"${name}" <${email}>` : email;
    this.to.push(recipient);
  }

  addCc(email, name) {
    const recipient = name ? `"${name}" <${email}>` : email;
    this.cc.push(recipient);
  }

  addBcc(email, name) {
    const recipient = name ? `"${name}" <${email}>` : email;
    this.bcc.push(recipient);
  }

  setReplyTo(email) {
    this.headers.set('Reply-To', email);
  }

  setSubject(subject) {
    this.subject = subject;
    this.headers.set('Subject', subject);
  }

  setText(text) {
    this.textContent = text;
  }

  setHtml(html) {
    this.htmlContent = html;
  }

  addHeader(name, value) {
    this.headers.set(name, value);
  }

  build() {
    // Build complete MIME message
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    let message = '';

    // Add headers
    if (this.to.length > 0) {
      message += `To: ${this.to.join(', ')}\r\n`;
    }
    if (this.cc.length > 0) {
      message += `Cc: ${this.cc.join(', ')}\r\n`;
    }
    if (this.bcc.length > 0) {
      message += `Bcc: ${this.bcc.join(', ')}\r\n`;
    }

    for (const [key, value] of this.headers) {
      if (key !== 'To' && key !== 'Cc' && key !== 'Bcc') {
        message += `${key}: ${value}\r\n`;
      }
    }

    // Add MIME headers
    message += 'MIME-Version: 1.0\r\n';

    if (this.htmlContent && this.textContent) {
      message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
      message += '\r\n';

      // Text part
      message += `--${boundary}\r\n`;
      message += 'Content-Type: text/plain; charset=UTF-8\r\n';
      message += 'Content-Transfer-Encoding: quoted-printable\r\n';
      message += '\r\n';
      message += this.textContent;
      message += '\r\n';

      // HTML part
      message += `--${boundary}\r\n`;
      message += 'Content-Type: text/html; charset=UTF-8\r\n';
      message += 'Content-Transfer-Encoding: quoted-printable\r\n';
      message += '\r\n';
      message += this.htmlContent;
      message += '\r\n';

      message += `--${boundary}--\r\n`;
    } else if (this.htmlContent) {
      message += 'Content-Type: text/html; charset=UTF-8\r\n';
      message += 'Content-Transfer-Encoding: quoted-printable\r\n';
      message += '\r\n';
      message += this.htmlContent;
    } else {
      message += 'Content-Type: text/plain; charset=UTF-8\r\n';
      message += 'Content-Transfer-Encoding: quoted-printable\r\n';
      message += '\r\n';
      message += this.textContent;
    }

    return message;
  }
}