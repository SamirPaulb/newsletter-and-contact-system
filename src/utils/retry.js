/**
 * Comprehensive Retry Logic and Error Handling Utilities
 */

/**
 * Retry configuration defaults
 */
const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'NetworkError',
    'TimeoutError'
  ],
  retryableStatusCodes: [408, 429, 500, 502, 503, 504, 522, 524]
};

/**
 * Exponential backoff with jitter
 */
function calculateDelay(attempt, config) {
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
    config.maxDelay
  );

  if (config.jitter) {
    // Add random jitter (±25% of base delay)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(baseDelay + jitter);
  }

  return baseDelay;
}

/**
 * Check if error is retryable
 */
function isRetryableError(error, config) {
  if (!error) return false;

  // Check error message
  const errorMessage = error.message || '';
  if (config.retryableErrors.some(msg => errorMessage.includes(msg))) {
    return true;
  }

  // Check status code
  if (error.status && config.retryableStatusCodes.includes(error.status)) {
    return true;
  }

  // Check response status
  if (error.response?.status && config.retryableStatusCodes.includes(error.response.status)) {
    return true;
  }

  return false;
}

/**
 * Main retry wrapper with exponential backoff
 */
export async function withRetry(fn, options = {}) {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options };
  let lastError;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // Execute the function
      const result = await fn(attempt);

      // Success - return result
      return {
        success: true,
        result: result,
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt}/${config.maxAttempts} failed:`, error.message);

      // Check if we should retry
      if (attempt === config.maxAttempts) {
        break; // Max attempts reached
      }

      if (!isRetryableError(error, config)) {
        break; // Non-retryable error
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, config);
      console.log(`Retrying in ${delay}ms...`);

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All attempts failed
  return {
    success: false,
    error: lastError,
    attempts: config.maxAttempts
  };
}

/**
 * Retry wrapper for HTTP requests
 */
export async function withHttpRetry(url, options = {}, retryConfig = {}) {
  return withRetry(async (attempt) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Check if response is ok
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);

      if (error.name === 'AbortError') {
        error.message = 'Request timeout';
      }

      throw error;
    }
  }, retryConfig);
}

/**
 * Retry wrapper for KV operations
 */
export async function withKVRetry(operation, retryConfig = {}) {
  const config = {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: 3,
    initialDelay: 500,
    ...retryConfig
  };

  return withRetry(operation, config);
}

/**
 * Batch processing with retry and partial failure handling
 */
export async function processBatchWithRetry(items, processor, options = {}) {
  const {
    batchSize = 10,
    maxConcurrent = 5,
    continueOnError = true,
    retryConfig = {}
  } = options;

  const results = {
    successful: [],
    failed: [],
    totalProcessed: 0
  };

  // Process in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));

    // Process batch items concurrently (with concurrency limit)
    const batchPromises = [];

    for (let j = 0; j < batch.length; j += maxConcurrent) {
      const concurrent = batch.slice(j, Math.min(j + maxConcurrent, batch.length));

      const concurrentPromises = concurrent.map(async (item, index) => {
        const itemIndex = i + j + index;

        const result = await withRetry(
          async () => processor(item, itemIndex),
          retryConfig
        );

        if (result.success) {
          results.successful.push({
            item: item,
            index: itemIndex,
            result: result.result
          });
        } else {
          results.failed.push({
            item: item,
            index: itemIndex,
            error: result.error
          });

          if (!continueOnError) {
            throw new Error(`Batch processing failed at item ${itemIndex}: ${result.error.message}`);
          }
        }

        results.totalProcessed++;
      });

      batchPromises.push(...await Promise.all(concurrentPromises));
    }

    // Add delay between batches to avoid rate limiting
    if (i + batchSize < items.length && options.batchDelay) {
      await new Promise(resolve => setTimeout(resolve, options.batchDelay));
    }
  }

  return results;
}

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = Date.now();
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      console.error(`Circuit breaker opened. Will retry at ${new Date(this.nextAttempt).toISOString()}`);
    }
  }

  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.nextAttempt = Date.now();
  }
}

/**
 * Dead letter queue for failed operations
 */
export class DeadLetterQueue {
  constructor(env, config) {
    this.env = env;
    this.config = config;
    this.prefix = 'dlq:';
  }

  async add(item, error) {
    const key = `${this.prefix}${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const data = {
      item: item,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      timestamp: new Date().toISOString(),
      retryCount: item.retryCount || 0
    };

    await this.env.KV.put(key, JSON.stringify(data), {
      expirationTtl: 7 * 24 * 60 * 60 // Keep for 7 days
    });

    return key;
  }

  async getAll() {
    const items = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const list = await this.env.KV.list({
        prefix: this.prefix,
        limit: 1000,
        cursor
      });

      if (!list || !list.keys) break;

      for (const key of list.keys) {
        const data = await this.env.KV.get(key.name);
        if (data) {
          items.push({
            key: key.name,
            data: JSON.parse(data)
          });
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }

    return items;
  }

  async retry(key) {
    const data = await this.env.KV.get(key);
    if (!data) return null;

    const item = JSON.parse(data);
    item.item.retryCount = (item.item.retryCount || 0) + 1;

    // Delete from DLQ
    await this.env.KV.delete(key);

    return item.item;
  }

  async clear() {
    let deleted = 0;
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const list = await this.env.KV.list({
        prefix: this.prefix,
        limit: 1000,
        cursor
      });

      if (!list || !list.keys) break;

      for (const key of list.keys) {
        await this.env.KV.delete(key.name);
        deleted++;
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }

    return deleted;
  }
}

/**
 * Resilient fetch with retry, timeout, and circuit breaking
 */
export async function resilientFetch(url, options = {}, config = {}) {
  const {
    timeout = 30000,
    circuitBreaker = null,
    retryConfig = {},
    ...fetchOptions
  } = options;

  const execute = async () => {
    return await withHttpRetry(url, {
      ...fetchOptions,
      timeout
    }, retryConfig);
  };

  if (circuitBreaker) {
    return await circuitBreaker.execute(execute);
  }

  return await execute();
}