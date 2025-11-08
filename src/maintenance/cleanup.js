/**
 * Cleanup Module - Handles KV cleanup and maintenance operations
 */

import { cleanupPrefix, getQueuesByStatus } from '../utils/kv.js';

/**
 * Run cleanup tasks
 */
export async function runCleanup(env, config) {
  console.log('Starting cleanup tasks...');

  const results = {
    cleanedPrefixes: {},
    cleanedQueues: 0,
    timestamp: new Date().toISOString()
  };

  try {
    // Clean up rate limit entries (temporary data)
    results.cleanedPrefixes.ratelimit = await cleanupPrefix(env, config.PREFIX_RATELIMIT);
    console.log(`Cleaned ${results.cleanedPrefixes.ratelimit} rate limit entries`);

    // Clean up captcha entries (temporary data)
    results.cleanedPrefixes.captcha = await cleanupPrefix(env, config.PREFIX_CAPTCHA);
    console.log(`Cleaned ${results.cleanedPrefixes.captcha} captcha entries`);

    // Clean up bot detection entries (temporary data)
    results.cleanedPrefixes.bot = await cleanupPrefix(env, config.PREFIX_BOT);
    console.log(`Cleaned ${results.cleanedPrefixes.bot} bot entries`);

    results.cleanedPrefixes.botDetect = await cleanupPrefix(env, config.PREFIX_BOT_DETECT);
    console.log(`Cleaned ${results.cleanedPrefixes.botDetect} bot-detect entries`);

    // Clean up old completed queues (only completed ones, older than 45 days)
    results.cleanedQueues = await cleanupOldQueues(env, config);
    console.log(`Cleaned ${results.cleanedQueues} old queue entries`);

    // NOTE: Subscribers and contacts are kept forever per user requirements
    // They are only removed when users explicitly unsubscribe

    console.log('Cleanup tasks completed successfully');
    return results;
  } catch (error) {
    console.error('Error during cleanup:', error);
    results.error = error.message;
    return results;
  }
}

/**
 * Clean up old and completed queues
 */
async function cleanupOldQueues(env, config) {
  let deleted = 0;
  let cursor = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_EMAIL_QUEUE,
        limit: 1000,
        cursor
      });

      if (!list || !list.keys) break;

      for (const key of list.keys) {
        try {
          const raw = await env.KV.get(key.name);

          if (!raw) {
            // Delete empty entries
            await env.KV.delete(key.name);
            deleted++;
            continue;
          }

          const queue = JSON.parse(raw);
          const createdAtMs = queue.createdAt ? new Date(queue.createdAt).getTime() : 0;
          const staleCutoff = Date.now() - 45 * 24 * 60 * 60 * 1000; // 45 days

          // Delete completed or stale queues
          if (queue.status === 'completed' || (createdAtMs && createdAtMs < staleCutoff)) {
            await env.KV.delete(key.name);
            deleted++;
            console.log(`Deleted ${queue.status} queue: ${key.name}`);
          }
        } catch (error) {
          console.error(`Error processing queue ${key.name}:`, error);
          // Try to delete corrupted entries
          try {
            await env.KV.delete(key.name);
            deleted++;
          } catch {}
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error('Error cleaning up queues:', error);
  }

  return deleted;
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
    const lastCleanup = await env.KV.get('maintenance:last-cleanup');
    if (lastCleanup) {
      status.lastCleanup = JSON.parse(lastCleanup);
    }

    // Get last backup info
    const lastBackup = await env.KV.get('maintenance:last-backup');
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