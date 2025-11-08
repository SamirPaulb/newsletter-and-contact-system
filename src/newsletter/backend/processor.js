/**
 * Newsletter Backend Processor - RSS Discovery and Queue Management
 */

import { getAllSubscribers, getQueuesByStatus } from '../../utils/kv.js';
import { EmailFactory } from '../../email/emailFactory.js';
import { withRetry, resilientFetch, DeadLetterQueue } from '../../utils/retry.js';

/**
 * Main daily processing function
 */
export async function dailyRun(env, config) {
  console.log('Starting daily newsletter run');

  // Initialize Dead Letter Queue for failed operations
  const dlq = new DeadLetterQueue(env, config);

  try {
    // Check for any active queue
    const activeQueues = await getQueuesByStatus(env, config, 'in-progress');

    if (activeQueues.length > 0) {
      // Process existing queue
      console.log(`Found ${activeQueues.length} active queue(s), processing...`);
      for (const { key, queue } of activeQueues) {
        const result = await processQueueBatch(env, config, key, queue);
        if (!result.success && result.error) {
          // Add to DLQ if processing fails
          await dlq.add({ key, queue }, result.error);
        }
      }
      return;
    }

    // Check for pending queues
    const pendingQueues = await getQueuesByStatus(env, config, 'pending');

    if (pendingQueues.length > 0) {
      console.log(`Found ${pendingQueues.length} pending queue(s), processing...`);
      for (const { key, queue } of pendingQueues) {
        const result = await processQueueBatch(env, config, key, queue);
        if (!result.success && result.error) {
          // Add to DLQ if processing fails
          await dlq.add({ key, queue }, result.error);
        }
      }
      return;
    }

    // No active queues, discover new posts
    await discoverFromRssAndQueue(env, config);
  } catch (error) {
    console.error('Error in daily run:', error);
    // Store error in KV for debugging
    await env.KV.put('error:daily-run:last', JSON.stringify({
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }), {
      expirationTtl: 7 * 24 * 60 * 60 // Keep for 7 days
    });
  }
}

/**
 * Discover new posts from RSS feed and create queue
 */
async function discoverFromRssAndQueue(env, config) {
  try {
    if (!config.RSS_FEED_URL) {
      console.log('No RSS feed URL configured');
      return;
    }

    // Get all subscribers
    const subscribers = await getAllSubscribers(env, config);
    if (subscribers.length === 0) {
      console.log('No subscribers found');
      return;
    }

    console.log(`Found ${subscribers.length} subscriber(s)`);

    // Fetch RSS feed with retry logic
    const fetchResult = await resilientFetch(config.RSS_FEED_URL, {
      headers: { 'User-Agent': config.USER_AGENT },
      timeout: config.FETCH_TIMEOUT_MS
    }, {
      retryConfig: {
        maxAttempts: 3,
        initialDelay: 2000,
        backoffMultiplier: 2
      }
    });

    if (!fetchResult.success) {
      console.error(`Failed to fetch RSS feed after retries: ${fetchResult.error.message}`);
      // Store error for monitoring
      await env.KV.put('error:rss-fetch:last', JSON.stringify({
        url: config.RSS_FEED_URL,
        error: fetchResult.error.message,
        attempts: fetchResult.attempts,
        timestamp: new Date().toISOString()
      }), {
        expirationTtl: 24 * 60 * 60 // Keep for 24 hours
      });
      return;
    }

    const response = fetchResult.result;
    const xml = await response.text();
    const items = extractRssItems(xml);

    if (!items.length) {
      console.log('No items found in RSS feed');
      return;
    }

    console.log(`Found ${items.length} items in RSS feed`);

    let created = 0;
    for (const item of items) {
      if (created >= config.MAX_POSTS_PER_RUN) break;

      const normUrl = normalizeUrl(item.url);
      const postId = postIdFromNormalizedUrl(normUrl) || item.guid || item.title || normUrl;

      if (!postId) continue;

      // Check if already sent
      const already = await alreadySent(env, config, postId, normUrl);
      if (already) {
        console.log(`Post already sent: ${postId}`);
        continue;
      }

      // Create queue entry
      const queueKey = `${config.PREFIX_EMAIL_QUEUE}${postId}`;
      const queueData = {
        post: {
          url: normUrl,
          title: item.title || postId,
          description: item.description || '',
          lastmod: item.pubDate || '',
          slug: postId
        },
        subscribers: subscribers,
        sentTo: [],
        createdAt: new Date().toISOString(),
        status: 'pending',
        nextSendAt: ''
      };

      await env.KV.put(queueKey, JSON.stringify(queueData));
      created++;
      console.log(`Created queue for post: ${item.title}`);
    }

    console.log(`Created ${created} new queue(s)`);
  } catch (error) {
    console.error('Error in discoverFromRssAndQueue:', error);
  }
}

/**
 * Process a batch of emails from queue
 */
async function processQueueBatch(env, config, queueKey, queue) {
  try {
    // Check if enough time has passed since last batch
    const now = Date.now();
    const nextSendAtMs = queue.nextSendAt ? new Date(queue.nextSendAt).getTime() : 0;

    if (nextSendAtMs && now < nextSendAtMs) {
      console.log(`Waiting until ${queue.nextSendAt} to send next batch`);
      return { success: true, waiting: true };
    }

    const offset = Array.isArray(queue.sentTo) ? queue.sentTo.length : 0;
    const total = Array.isArray(queue.subscribers) ? queue.subscribers.length : 0;

    if (!total || offset >= total) {
      await finalizeQueue(env, config, queueKey, queue);
      return { success: true, completed: true };
    }

    // Get next batch of recipients
    const nextBatch = queue.subscribers.slice(offset, Math.min(offset + config.BATCH_SIZE, total));

    if (!nextBatch.length) {
      await finalizeQueue(env, config, queueKey, queue);
      return { success: true, completed: true };
    }

    console.log(`Sending to batch of ${nextBatch.length} recipients (${offset}/${total})`);

    // Track retry count for this batch
    queue.batchRetryCount = queue.batchRetryCount || 0;

    // Send emails using the email provider with retry
    const result = await withRetry(async (attempt) => {
      console.log(`Email send attempt ${attempt} for batch ${offset}/${total}`);

      const sendResult = await EmailFactory.sendNewsletter(config, env, {
        recipients: nextBatch,
        post: queue.post
      });

      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Failed to send emails');
      }

      return sendResult;
    }, {
      maxAttempts: 3,
      initialDelay: 5000,
      backoffMultiplier: 2,
      maxDelay: 30000
    });

    if (!result.success) {
      console.error('Failed to send batch after retries:', result.error);

      // Increment batch retry count
      queue.batchRetryCount++;

      // If batch has failed too many times, move failed recipients to a separate list
      if (queue.batchRetryCount >= 3) {
        queue.failedRecipients = queue.failedRecipients || [];
        queue.failedRecipients.push(...nextBatch);

        // Skip these recipients and continue with the rest
        queue.sentTo = queue.sentTo || [];
        queue.sentTo.push(...nextBatch); // Mark as "processed" even though failed

        // Reset retry count for next batch
        queue.batchRetryCount = 0;

        // Store failure details
        queue.lastError = {
          message: result.error.message,
          batch: `${offset}-${offset + nextBatch.length}`,
          timestamp: new Date().toISOString()
        };
      } else {
        // Try this batch again later
        queue.nextSendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Retry in 5 minutes
      }

      await env.KV.put(queueKey, JSON.stringify(queue));
      return { success: false, error: result.error, retryScheduled: true };
    }

    // Success - Update queue status
    const sentResult = result.result;
    queue.sentTo = queue.sentTo || [];

    // Track successfully sent recipients
    if (sentResult.totalSent) {
      const successfulRecipients = nextBatch.slice(0, sentResult.totalSent);
      queue.sentTo.push(...successfulRecipients);

      // Handle partial failures
      if (sentResult.totalFailed > 0) {
        queue.failedRecipients = queue.failedRecipients || [];
        const failedRecipients = nextBatch.slice(sentResult.totalSent);
        queue.failedRecipients.push(...failedRecipients);
        console.log(`Partial batch failure: ${sentResult.totalFailed} recipients failed`);
      }
    } else {
      // All sent successfully
      queue.sentTo.push(...nextBatch);
    }

    // Reset batch retry count on success
    queue.batchRetryCount = 0;

    queue.status = queue.sentTo.length >= total ? 'completed' : 'in-progress';
    queue.lastBatchSentAt = new Date().toISOString();
    queue.stats = {
      total: total,
      sent: queue.sentTo.length,
      failed: (queue.failedRecipients || []).length,
      remaining: total - queue.sentTo.length
    };

    if (queue.status !== 'completed') {
      // Set next send time
      queue.nextSendAt = new Date(Date.now() + config.BATCH_WAIT_MINUTES * 60 * 1000).toISOString();
    }

    if (queue.status === 'completed') {
      await finalizeQueue(env, config, queueKey, queue);
    } else {
      await env.KV.put(queueKey, JSON.stringify(queue));
    }

    console.log(`Batch processed. Status: ${queue.status}, Sent: ${queue.stats.sent}/${queue.stats.total}`);
    return { success: true, stats: queue.stats };
  } catch (error) {
    console.error('Error in processQueueBatch:', error);

    // Store error in queue for debugging
    queue.lastError = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    await env.KV.put(queueKey, JSON.stringify(queue));

    return { success: false, error: error };
  }
}

/**
 * Mark queue as complete and clean up
 */
async function finalizeQueue(env, config, queueKey, queue) {
  try {
    const normUrl = normalizeUrl(queue.post.url);
    const postId = postIdFromNormalizedUrl(normUrl) || queue.post.slug;

    const record = {
      url: normUrl,
      slug: postId,
      title: queue.post.title,
      lastmod: queue.post.lastmod || '',
      sentAt: new Date().toISOString(),
      recipientCount: queue.sentTo?.length || 0
    };

    // Mark as sent
    await Promise.all([
      env.KV.put(`${config.PREFIX_NEWSLETTER_SENT}${postId}`, JSON.stringify(record)),
      env.KV.put(`${config.PREFIX_NEWSLETTER_SENT_URL}${encodeURIComponent(normUrl)}`, JSON.stringify(record)),
      env.KV.delete(queueKey)
    ]);

    console.log(`Finalized queue for post: ${queue.post.title}`);
  } catch (error) {
    console.error('Error in finalizeQueue:', error);
  }
}

/**
 * Check if post was already sent
 */
async function alreadySent(env, config, postId, normUrl) {
  const [byId, byUrl] = await Promise.all([
    env.KV.get(`${config.PREFIX_NEWSLETTER_SENT}${postId}`),
    env.KV.get(`${config.PREFIX_NEWSLETTER_SENT_URL}${encodeURIComponent(normUrl)}`)
  ]);

  return !!(byId || byUrl);
}

/**
 * Extract RSS items from XML
 */
function extractRssItems(xml) {
  const items = [];

  // Parse RSS 2.0 items
  const rssItemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = rssItemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    const link = (block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || '';
    const guid = (block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() || '';
    const description = (block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i) || [])[1]?.trim() || '';

    if (link) {
      items.push({
        url: link,
        title: cleanCDATA(title),
        guid: cleanCDATA(guid),
        pubDate: pubDate,
        description: cleanCDATA(description)
      });
    }
  }

  // Parse Atom entries
  const atomEntryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;

  while ((match = atomEntryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    const linkHref = (block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i) || [])[1]?.trim() || '';
    const id = (block.match(/<id\b[^>]*>([\s\S]*?)<\/id>/i) || [])[1]?.trim() || '';
    const updated = (block.match(/<updated\b[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]?.trim() || '';
    const summary = (block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i) || [])[1]?.trim() || '';

    if (linkHref) {
      items.push({
        url: linkHref,
        title: cleanCDATA(title),
        guid: id,
        pubDate: updated,
        description: cleanCDATA(summary)
      });
    }
  }

  return items;
}

/**
 * Clean CDATA sections
 */
function cleanCDATA(text) {
  if (!text) return '';

  // Remove CDATA markers first
  let cleaned = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  // Remove HTML tags with non-greedy pattern to avoid polynomial regex
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  return cleaned.trim();
}

/**
 * Normalize URL
 */
function normalizeUrl(input) {
  let s = String(input || '');

  // Remove markdown link syntax
  const mdMatch = s.match(/^\[.*?\]\((.*?)\)$/);
  if (mdMatch) s = mdMatch[1];

  s = s.trim().replace(/^[<\[]+/, '').replace(/[>\]]+$/, '');

  try {
    let u;
    if (/^https?:\/\//i.test(s)) {
      u = new URL(s);
    } else {
      u = new URL('https://' + s);
    }

    const host = u.host.toLowerCase();
    let path = (u.pathname || '/').replace(/\/{2,}/g, '/');

    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    return `https://${host}${path}`;
  } catch {
    return s;
  }
}

/**
 * Extract post ID from normalized URL
 */
function postIdFromNormalizedUrl(normUrl) {
  try {
    const u = new URL(normUrl);
    const p = u.pathname.replace(/^\/+|\/+$/g, '');
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(resource, options = {}, ms = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('timeout'), ms);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}