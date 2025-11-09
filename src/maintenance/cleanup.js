/**
 * Cleanup Module - Handles KV cleanup and maintenance operations
 */

import { cleanupPrefix, getQueuesByStatus } from '../utils/kv.js';

/**
 * Clean up expired rate limit and bot detection entries
 */
async function cleanExpiredEntries(env, config) {
  const results = {
    total: 0,
    prefixes: []
  };

  try {
    // Clean up old rate limit entries (older than 24 hours)
    const rateLimitCleaned = await cleanExpiredByPrefix(
      env,
      config.PREFIX_RATELIMIT,
      24 * 60 * 60 * 1000 // 24 hours
    );
    if (rateLimitCleaned > 0) {
      results.total += rateLimitCleaned;
      results.prefixes.push('ratelimit');
      console.log(`Cleaned ${rateLimitCleaned} expired rate limit entries`);
    }

    // Clean up old bot detection entries (older than 7 days)
    const botDetectCleaned = await cleanExpiredByPrefix(
      env,
      config.PREFIX_BOT_DETECT,
      7 * 24 * 60 * 60 * 1000 // 7 days
    );
    if (botDetectCleaned > 0) {
      results.total += botDetectCleaned;
      results.prefixes.push('bot-detect');
      console.log(`Cleaned ${botDetectCleaned} expired bot detection entries`);
    }

    // Clean up old captcha entries (older than 1 hour)
    const captchaCleaned = await cleanExpiredByPrefix(
      env,
      config.PREFIX_CAPTCHA,
      60 * 60 * 1000 // 1 hour
    );
    if (captchaCleaned > 0) {
      results.total += captchaCleaned;
      results.prefixes.push('captcha');
      console.log(`Cleaned ${captchaCleaned} expired captcha entries`);
    }

    // Clean up old bot entries (older than 30 days)
    const botCleaned = await cleanExpiredByPrefix(
      env,
      config.PREFIX_BOT,
      30 * 24 * 60 * 60 * 1000 // 30 days
    );
    if (botCleaned > 0) {
      results.total += botCleaned;
      results.prefixes.push('bot');
      console.log(`Cleaned ${botCleaned} expired bot entries`);
    }

  } catch (error) {
    console.error('Error cleaning expired entries:', error);
  }

  return results;
}

/**
 * Clean expired entries by prefix based on age
 */
async function cleanExpiredByPrefix(env, prefix, maxAgeMs) {
  let deleted = 0;
  let cursor = null;
  let hasMore = true;
  const now = Date.now();

  try {
    while (hasMore) {
      const list = await env.KV.list({ prefix, limit: 100, cursor });
      if (!list || !list.keys) break;

      for (const key of list.keys) {
        try {
          // Get the value to check timestamp
          const value = await env.KV.get(key.name);
          if (value) {
            try {
              const data = JSON.parse(value);
              const timestamp = data.timestamp || data.createdAt || data.date;
              if (timestamp) {
                const age = now - new Date(timestamp).getTime();
                if (age > maxAgeMs) {
                  await env.KV.delete(key.name);
                  deleted++;
                }
              } else {
                // No timestamp, delete if it's an old format entry
                await env.KV.delete(key.name);
                deleted++;
              }
            } catch {
              // If it's not JSON or has no timestamp, check metadata
              const metadata = key.metadata || {};
              if (metadata.timestamp) {
                const age = now - new Date(metadata.timestamp).getTime();
                if (age > maxAgeMs) {
                  await env.KV.delete(key.name);
                  deleted++;
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error processing ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error(`Error cleaning prefix ${prefix}:`, error);
  }

  return deleted;
}

/**
 * Run cleanup tasks
 */
export async function runCleanup(env, config) {
  console.log('Starting cleanup tasks...');

  const results = {
    cleanedTotal: 0,
    keptPrefixes: [],
    cleanedPrefixes: [],
    expiredPrefixes: [],
    timestamp: new Date().toISOString()
  };

  try {
    // First, clean up expired rate limit and bot detection entries
    const expiredCleaned = await cleanExpiredEntries(env, config);
    results.expiredPrefixes = expiredCleaned.prefixes;
    results.cleanedTotal += expiredCleaned.total;

    // Define what prefixes to KEEP (everything else will be deleted)
    const keepPrefixes = [
      config.PREFIX_SUBSCRIBER,        // Keep all subscribers
      config.PREFIX_CONTACT,          // Keep all contacts
      config.PREFIX_NEWSLETTER_SENT,  // Keep newsletter sent records
      config.PREFIX_NEWSLETTER_SENT_URL, // Keep newsletter sent URLs
      config.KEEP_PREFIX_MAINTENANCE,  // Keep maintenance metadata
      config.KEEP_PREFIX_DAILY,        // Keep daily run metadata
      config.KEEP_PREFIX_DEPLOYMENT,   // Keep deployment info
      config.KEEP_PREFIX_STATS,        // Keep stats data
      config.PREFIX_EMAIL_QUEUE       // Keep email queues (they have their own lifecycle)
    ];

    // Get all KV keys and clean up those not in keep list
    let cursor = null;
    let hasMore = true;
    let processed = 0;
    let deleted = 0;

    console.log('Prefixes to keep:', keepPrefixes);

    while (hasMore) {
      const list = await env.KV.list({
        limit: 1000,
        cursor
      });

      if (!list || !list.keys) break;

      for (const key of list.keys) {
        processed++;

        // Check if this key should be kept
        let shouldKeep = false;
        for (const keepPrefix of keepPrefixes) {
          if (key.name.startsWith(keepPrefix)) {
            shouldKeep = true;
            break;
          }
        }

        if (!shouldKeep) {
          try {
            await env.KV.delete(key.name);
            deleted++;

            // Track which prefix was cleaned
            const prefix = key.name.split(':')[0];
            if (!results.cleanedPrefixes.includes(prefix)) {
              results.cleanedPrefixes.push(prefix);
            }

            console.log(`Deleted: ${key.name}`);
          } catch (error) {
            console.error(`Error deleting ${key.name}:`, error);
          }
        } else {
          // Track which prefix was kept
          const prefix = key.name.split(':')[0];
          if (!results.keptPrefixes.includes(prefix)) {
            results.keptPrefixes.push(prefix);
          }
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }

    results.cleanedTotal += deleted;
    console.log(`Cleanup completed: Processed ${processed} keys, deleted ${deleted} keys`);
    console.log(`Kept prefixes: ${results.keptPrefixes.join(', ')}`);
    console.log(`Cleaned prefixes: ${results.cleanedPrefixes.join(', ')}`);
    console.log(`Expired prefixes cleaned: ${results.expiredPrefixes.join(', ')}`);

    // Store cleanup results
    await env.KV.put(`${config.KEEP_PREFIX_MAINTENANCE}cleanup`, JSON.stringify({
      results: results,
      timestamp: results.timestamp
    }));

    return results;
  } catch (error) {
    console.error('Error during cleanup:', error);
    results.error = error.message;
    return results;
  }
}


/**
 * Get maintenance status
 */
export async function getMaintenanceStatus(env, config) {
  const status = {
    prefixes: {},
    queues: {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0
    },
    subscribers: 0,
    contacts: 0,
    sent: 0,
    lastCleanup: null,
    lastBackup: null
  };

  try {
    // Count items for each prefix
    const prefixes = [
      { name: 'subscriber', prefix: config.PREFIX_SUBSCRIBER },
      { name: 'contact', prefix: config.PREFIX_CONTACT },
      { name: 'sent', prefix: config.PREFIX_NEWSLETTER_SENT },
      { name: 'ratelimit', prefix: config.PREFIX_RATELIMIT },
      { name: 'captcha', prefix: config.PREFIX_CAPTCHA }
    ];

    for (const { name, prefix } of prefixes) {
      let count = 0;
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const list = await env.KV.list({ prefix, limit: 1000, cursor });
        if (!list || !list.keys) break;
        count += list.keys.length;
        hasMore = !list.list_complete;
        cursor = list.cursor;
      }

      status.prefixes[name] = count;

      if (name === 'subscriber') status.subscribers = count;
      if (name === 'contact') status.contacts = count;
      if (name === 'sent') status.sent = count;
    }

    // Count queues by status
    const allQueues = await getQueuesByStatus(env, config);
    status.queues.total = allQueues.length;

    for (const { queue } of allQueues) {
      if (queue.status === 'pending') status.queues.pending++;
      else if (queue.status === 'in-progress') status.queues.inProgress++;
      else if (queue.status === 'completed') status.queues.completed++;
    }

    // Get last cleanup info
    const lastCleanup = await env.KV.get(`${config.KEEP_PREFIX_MAINTENANCE}cleanup`);
    if (lastCleanup) {
      status.lastCleanup = JSON.parse(lastCleanup);
    }

    // Get last backup info
    const lastBackup = await env.KV.get(`${config.KEEP_PREFIX_MAINTENANCE}backup`);
    if (lastBackup) {
      status.lastBackup = JSON.parse(lastBackup);
    }

    return status;
  } catch (error) {
    console.error('Error getting maintenance status:', error);
    status.error = error.message;
    return status;
  }
}

/**
 * Manual cleanup of specific items
 */
export async function cleanupSpecific(env, config, { prefix, pattern }) {
  let deleted = 0;
  let cursor = null;
  let hasMore = true;

  try {
    const regex = pattern ? new RegExp(pattern) : null;

    while (hasMore) {
      const list = await env.KV.list({ prefix, limit: 1000, cursor });
      if (!list || !list.keys) break;

      for (const key of list.keys) {
        if (!regex || regex.test(key.name)) {
          try {
            await env.KV.delete(key.name);
            deleted++;
          } catch (error) {
            console.error(`Error deleting ${key.name}:`, error);
          }
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }

    return {
      success: true,
      deleted: deleted
    };
  } catch (error) {
    console.error('Error in specific cleanup:', error);
    return {
      success: false,
      error: error.message,
      deleted: deleted
    };
  }
}