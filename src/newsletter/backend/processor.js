/**
 * Newsletter Backend Processor - Universal Feed Discovery and Queue Management
 * Supports RSS 2.0, RSS 1.0, Atom, RDF, and JSON Feed formats
 */

import { getAllSubscribers, getQueuesByStatus } from '../../utils/kv.js';
import { EmailFactory } from '../../email/emailFactory.js';
import { withRetry, resilientFetch, DeadLetterQueue } from '../../utils/retry.js';
import { parseFeed, detectFeedType, isValidFeedUrl } from '../../utils/feedParser.js';

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
      expirationTtl: config.TTL_ERROR_LOGS // Use config for 7 days TTL
    });
  }
}

/**
 * Discover new posts from feed and create queue
 * Supports multiple feed formats: RSS 2.0, RSS 1.0, Atom, RDF, JSON Feed
 */
async function discoverFromRssAndQueue(env, config) {
  try {
    if (!config.RSS_FEED_URL) {
      console.log('No feed URL configured');
      return;
    }

    // Validate feed URL
    if (!isValidFeedUrl(config.RSS_FEED_URL)) {
      console.error('Invalid feed URL:', config.RSS_FEED_URL);
      return;
    }

    // Get all subscribers
    const subscribers = await getAllSubscribers(env, config);
    if (subscribers.length === 0) {
      console.log('No subscribers found');
      return;
    }

    console.log(`Processing ${subscribers.length} subscriber(s)`);

    // Fetch feed with retry logic
    const fetchResult = await resilientFetch(config.RSS_FEED_URL, {
      headers: {
        'User-Agent': config.USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*'
      },
      timeout: config.FETCH_TIMEOUT_MS
    }, {
      retryConfig: {
        maxAttempts: 3,
        initialDelay: 2000,
        backoffMultiplier: 2
      }
    });

    if (!fetchResult.success) {
      console.error(`Failed to fetch feed after retries: ${fetchResult.error.message}`);
      // Store error for monitoring
      await env.KV.put('error:feed-fetch:last', JSON.stringify({
        url: config.RSS_FEED_URL,
        error: fetchResult.error.message,
        attempts: fetchResult.attempts,
        timestamp: new Date().toISOString()
      }), {
        expirationTtl: config.TTL_FEED_ERROR // Use config for 24 hours TTL
      });
      return;
    }

    const response = fetchResult.result;
    const contentType = response.headers.get('content-type') || '';
    const feedContent = await response.text();

    // Detect feed type for logging
    const feedType = detectFeedType(feedContent);
    console.log(`Detected feed type: ${feedType}`);

    // Parse feed using universal parser
    const items = parseFeed(feedContent, contentType);

    if (!items.length) {
      console.log('No items found in feed');
      return;
    }

    console.log(`Found ${items.length} items in feed (type: ${feedType})`);

    // Step 1: Find all unsent posts
    const unsentPosts = [];
    console.log(`Checking which posts have not been sent yet...`);

    for (const item of items) {
      // IMPORTANT: Normalize URL consistently to prevent duplicates
      const normUrl = normalizeUrl(item.url);
      const postId = postIdFromNormalizedUrl(normUrl) || item.guid || item.title || normUrl;

      if (!postId) continue;

      // Check if already sent (using normalized URL)
      const already = await alreadySent(env, config, postId, normUrl);
      if (already) {
        console.log(`✓ Already sent: ${item.title}`);
        continue;
      }

      console.log(`✗ Not sent yet: ${item.title}`);
      unsentPosts.push({
        item: item,
        normUrl: normUrl,
        postId: postId
      });
    }

    console.log(`Found ${unsentPosts.length} unsent posts out of ${items.length} total posts`);

    // Step 2: Create queues for unsent posts (respecting MAX_POSTS_PER_RUN)
    let created = 0;
    for (const unsentPost of unsentPosts) {
      if (created >= config.MAX_POSTS_PER_RUN) {
        console.log(`Reached max posts per run (${config.MAX_POSTS_PER_RUN}). Remaining posts will be sent in next run.`);
        break;
      }

      const { item, normUrl, postId } = unsentPost;

      // Create queue entry with enriched data
      const queueKey = `${config.PREFIX_EMAIL_QUEUE}${postId}`;

      // Check if queue already exists (in case of interrupted processing)
      const existingQueue = await env.KV.get(queueKey);
      if (existingQueue) {
        console.log(`Queue already exists for: ${item.title} (will resume processing)`);
        continue;
      }

      const queueData = {
        post: {
          url: normUrl,
          title: item.title || postId,
          description: item.description || '',
          lastmod: item.pubDate || '',
          slug: postId,
          author: item.author || '',
          categories: item.categories || [],
          enclosure: item.enclosure || ''
        },
        subscribers: subscribers,
        sentTo: [],
        createdAt: new Date().toISOString(),
        status: 'pending',
        nextSendAt: '',
        feedType: feedType // Store feed type for debugging
      };

      await env.KV.put(queueKey, JSON.stringify(queueData));
      created++;
      console.log(`Created queue #${created} for post: ${item.title}`);
    }

    console.log(`Created ${created} new queue(s) for unsent posts`);
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

    // Ensure arrays are initialized
    queue.sentTo = queue.sentTo || [];
    queue.failedRecipients = queue.failedRecipients || [];

    const offset = queue.sentTo.length;
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
        queue.failedRecipients.push(...nextBatch);

        // Skip these recipients and continue with the rest
        queue.sentTo.push(...nextBatch); // Mark as "processed" even though failed

        // Reset retry count for next batch
        queue.batchRetryCount = 0;

        // Store failure details
        queue.lastError = {
          message: result.error?.message || 'Unknown error',
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
    // CRITICAL: Check for 0 explicitly - totalSent=0 is a valid failure state
    if (sentResult.totalSent !== undefined && sentResult.totalSent !== null) {
      if (sentResult.totalSent > 0) {
        const successfulRecipients = nextBatch.slice(0, sentResult.totalSent);
        queue.sentTo.push(...successfulRecipients);
      }

      // Handle partial failures
      if (sentResult.totalFailed > 0) {
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
 * IMPORTANT: Only skip sending if BOTH keys exist in KV
 * If either key is missing, the newsletter will be sent
 */
async function alreadySent(env, config, postId, normUrl) {
  // Check both by post ID and by normalized URL
  const postIdKey = `${config.PREFIX_NEWSLETTER_SENT}${postId}`;
  const urlKey = `${config.PREFIX_NEWSLETTER_SENT_URL}${encodeURIComponent(normUrl)}`;

  console.log(`Checking if already sent - PostID: ${postId}, URL: ${normUrl}`);
  console.log(`  Checking keys: ${postIdKey} and ${urlKey}`);

  const [byId, byUrl] = await Promise.all([
    env.KV.get(postIdKey),
    env.KV.get(urlKey)
  ]);

  const hasPostIdKey = !!byId;
  const hasUrlKey = !!byUrl;

  console.log(`  PostID key exists: ${hasPostIdKey}`);
  console.log(`  URL key exists: ${hasUrlKey}`);

  // BOTH keys must exist to skip sending
  if (hasPostIdKey && hasUrlKey) {
    console.log(`  ✓ BOTH keys found - SKIP sending (already sent)`);
    return true;
  }

  // If either key is missing, send the newsletter
  if (!hasPostIdKey && !hasUrlKey) {
    console.log(`  ✗ NEITHER key found - WILL SEND (new post)`);
  } else if (!hasPostIdKey) {
    console.log(`  ⚠️ PostID key missing - WILL SEND (fixing incomplete record)`);
  } else if (!hasUrlKey) {
    console.log(`  ⚠️ URL key missing - WILL SEND (fixing incomplete record)`);
  }

  return false;
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