/**
 * KV Storage utility functions
 */

/**
 * Get all items with a specific prefix
 */
export async function getAllByPrefix(env, prefix, limit = 1000) {
  const items = [];
  let cursor = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const list = await env.KV.list({ prefix, limit, cursor });
      if (!list || !list.keys) break;

      for (const key of list.keys) {
        try {
          const value = await env.KV.get(key.name);
          if (value) {
            items.push({
              key: key.name,
              value: value,
              metadata: key.metadata
            });
          }
        } catch (error) {
          console.error(`Error fetching key ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error(`Error listing keys with prefix ${prefix}:`, error);
  }

  return items;
}

/**
 * Get all subscriber emails
 */
export async function getAllSubscribers(env, config) {
  const subscribers = [];
  let cursor = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const list = await env.KV.list({
        prefix: config.PREFIX_SUBSCRIBER,
        limit: 1000,
        cursor
      });

      if (!list || !list.keys) break;

      for (const key of list.keys) {
        try {
          const data = await env.KV.get(key.name);
          if (data) {
            // Try to parse as JSON first (new format)
            try {
              const subscriberData = JSON.parse(data);
              if (subscriberData.email && subscriberData.email.includes('@')) {
                subscribers.push(subscriberData.email);
              }
            } catch {
              // Fall back to plain email string (old format)
              if (typeof data === 'string' && data.includes('@')) {
                subscribers.push(data);
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching subscriber ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error('Error getting subscribers:', error);
  }

  return subscribers;
}

/**
 * Add a subscriber
 */
export async function addSubscriber(env, config, email, ipAddress = '') {
  const key = `${config.PREFIX_SUBSCRIBER}${email}`;
  const existing = await env.KV.get(key);

  if (existing) {
    return { success: false, message: 'Already subscribed' };
  }

  // Store subscriber data as JSON with email, IP, and timestamp
  const subscriberData = {
    email: email,
    ipAddress: ipAddress,
    timestamp: new Date().toISOString()
  };

  await env.KV.put(key, JSON.stringify(subscriberData));

  return { success: true, message: 'Successfully subscribed' };
}

/**
 * Remove a subscriber
 */
export async function removeSubscriber(env, config, email) {
  const key = `${config.PREFIX_SUBSCRIBER}${email}`;
  const existing = await env.KV.get(key);

  if (!existing) {
    return { success: false, message: 'Email not found' };
  }

  await env.KV.delete(key);
  return { success: true, message: 'Successfully unsubscribed' };
}

/**
 * Check rate limit
 */
export async function checkRateLimit(env, config, clientIp) {
  const key = `${config.PREFIX_RATELIMIT}${clientIp}`;
  const count = await env.KV.get(key);

  if (count) {
    const currentCount = parseInt(count, 10);
    if (currentCount >= config.RATE_LIMIT_MAX) {
      return { allowed: false, remaining: 0 };
    }

    await env.KV.put(key, String(currentCount + 1), {
      expirationTtl: config.RATE_LIMIT_WINDOW_HOURS * 3600
    });

    return { allowed: true, remaining: config.RATE_LIMIT_MAX - currentCount - 1 };
  }

  await env.KV.put(key, '1', {
    expirationTtl: config.RATE_LIMIT_WINDOW_HOURS * 3600
  });

  return { allowed: true, remaining: config.RATE_LIMIT_MAX - 1 };
}

/**
 * Verify Turnstile captcha
 */
export async function verifyTurnstile(token, clientIp, secretKey) {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        remoteip: clientIp
      })
    });

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return false;
  }
}

/**
 * Clean up keys with a specific prefix
 */
export async function cleanupPrefix(env, prefix) {
  let deleted = 0;
  let cursor = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const list = await env.KV.list({ prefix, limit: 1000, cursor });
      if (!list || !list.keys) break;

      for (const key of list.keys) {
        try {
          await env.KV.delete(key.name);
          deleted++;
        } catch (error) {
          console.error(`Error deleting key ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error(`Error cleaning up prefix ${prefix}:`, error);
  }

  return deleted;
}

/**
 * Get queue by status
 */
export async function getQueuesByStatus(env, config, status) {
  const queues = [];
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
          if (raw) {
            const queue = JSON.parse(raw);
            if (!status || queue.status === status) {
              queues.push({
                key: key.name,
                queue: queue
              });
            }
          }
        } catch (error) {
          console.error(`Error parsing queue ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }
  } catch (error) {
    console.error('Error getting queues:', error);
  }

  return queues;
}

/**
 * Store contact form submission
 */
export async function storeContact(env, config, contactData) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const key = `${config.PREFIX_CONTACT}${timestamp}-${random}`;

  // Store the complete contact data (already includes IP and timestamp)
  await env.KV.put(key, JSON.stringify(contactData));

  return key;
}

/**
 * Export all KV data to CSV format
 */
export async function exportToCSV(env, config) {
  const allData = [];

  // Define all prefixes to export
  const prefixes = [
    { prefix: config.PREFIX_SUBSCRIBER, type: 'subscriber' },
    { prefix: config.PREFIX_CONTACT, type: 'contact' },
    { prefix: config.PREFIX_EMAIL_QUEUE, type: 'queue' },
    { prefix: config.PREFIX_NEWSLETTER_SENT, type: 'sent' },
    { prefix: config.PREFIX_NEWSLETTER_SENT_URL, type: 'sent_url' }
  ];

  for (const { prefix, type } of prefixes) {
    const items = await getAllByPrefix(env, prefix);

    for (const item of items) {
      let email = '';
      let data = {};

      try {
        // Extract email based on type
        if (type === 'subscriber') {
          email = item.value;
          data = { subscribedAt: item.metadata?.subscribedAt || '' };
        } else if (type === 'contact') {
          const contactData = JSON.parse(item.value);
          email = contactData.email;
          data = contactData;
        } else if (type === 'queue') {
          const queueData = JSON.parse(item.value);
          email = ''; // Queue doesn't have a single email
          data = {
            postTitle: queueData.post?.title || '',
            status: queueData.status,
            createdAt: queueData.createdAt,
            subscriberCount: queueData.subscribers?.length || 0
          };
        } else if (type === 'sent' || type === 'sent_url') {
          const sentData = JSON.parse(item.value);
          email = ''; // Sent records don't have email
          data = sentData;
        }

        allData.push({
          email: email,
          type: type,
          key: item.key.replace(prefix, ''),
          data: JSON.stringify(data),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error processing item ${item.key}:`, error);
      }
    }
  }

  // Convert to CSV
  const csvHeader = 'email,type,key,data,timestamp\n';
  const csvRows = allData.map(row => {
    return [
      row.email,
      row.type,
      row.key,
      `"${row.data.replace(/"/g, '""')}"`, // Escape quotes in JSON
      row.timestamp
    ].join(',');
  }).join('\n');

  return csvHeader + csvRows;
}