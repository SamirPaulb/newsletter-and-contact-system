/**
 * Validation utilities for email addresses and other inputs
 */

// Disposable email domains to block
const DISPOSABLE_DOMAINS = [
  'tempmail.com',
  'guerrillamail.com',
  '10minutemail.com',
  'mailinator.com',
  'maildrop.cc',
  'throwawaymail.com',
  'yopmail.com',
  'temp-mail.org',
  'fakeinbox.com',
  'sharklasers.com',
  'guerrillamail.info',
  'grr.la'
];

// Invalid domain patterns
const INVALID_PATTERNS = [
  /^localhost$/i,
  /^test\..*$/i,
  /^example\..*$/i,
  /^fake\..*$/i,
  /^temp\..*$/i,
  /^throwaway\..*$/i,
  /^disposable\..*$/i,
  /\.test$/i,
  /\.local$/i,
  /\.localhost$/i,
  /\.invalid$/i,
  /\.example$/i
];

/**
 * Validate email address format
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const trimmed = email.trim().toLowerCase();

  // Check basic format
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // Check length
  if (trimmed.length > 254) {
    return { valid: false, error: 'Email address too long' };
  }

  // Extract domain
  const [localPart, domain] = trimmed.split('@');

  // Check local part length
  if (localPart.length > 64) {
    return { valid: false, error: 'Email local part too long' };
  }

  // Check for disposable domains
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return { valid: false, error: 'Disposable email addresses are not allowed' };
  }

  // Check for invalid patterns
  for (const pattern of INVALID_PATTERNS) {
    if (pattern.test(domain)) {
      return { valid: false, error: 'Invalid email domain' };
    }
  }

  return { valid: true, email: trimmed };
}

/**
 * Check if email domain is invalid or disposable
 */
export function isInvalidDomain(email, additionalBlocklist = '') {
  if (!email || typeof email !== 'string') return true;

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return true;

  // Check default disposable domains
  if (DISPOSABLE_DOMAINS.includes(domain)) return true;

  // Check invalid patterns
  for (const pattern of INVALID_PATTERNS) {
    if (pattern.test(domain)) return true;
  }

  // Check additional blocklist from config
  if (additionalBlocklist) {
    const additionalDomains = additionalBlocklist.split(',').map(d => d.trim().toLowerCase());
    if (additionalDomains.includes(domain)) return true;
  }

  return false;
}

/**
 * Validate phone number (basic validation)
 */
export function validatePhone(phone) {
  if (!phone) {
    return { valid: true, phone: '' }; // Phone is optional
  }

  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

  // Check if it contains only numbers and optional + at start
  const phoneRegex = /^\+?\d{7,15}$/;
  if (!phoneRegex.test(cleaned)) {
    return { valid: false, error: 'Invalid phone number format' };
  }

  return { valid: true, phone: cleaned };
}

/**
 * Validate required text input
 */
export function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return { valid: false, error: `${fieldName} is required` };
  }

  if (typeof value === 'string' && value.trim().length < 2) {
    return { valid: false, error: `${fieldName} is too short` };
  }

  return { valid: true, value: typeof value === 'string' ? value.trim() : value };
}

/**
 * Sanitize HTML input to prevent XSS
 */
export function sanitizeHtml(input) {
  if (!input) return '';

  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/&(?!(lt|gt|quot|#39|amp);)/g, '&amp;');
}

/**
 * Validate Turnstile token format
 */
export function validateTurnstileToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Verification token is required' };
  }

  // Basic format check - Turnstile tokens are typically long alphanumeric strings
  if (token.length < 20 || token.length > 2048) {
    return { valid: false, error: 'Invalid verification token format' };
  }

  return { valid: true };
}

/**
 * Get client IP address from request
 */
export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         request.headers.get('X-Real-IP') ||
         'unknown';
}

/**
 * Create a URL-safe slug from text
 */
export function createSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}