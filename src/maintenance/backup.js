/**
 * Backup Module - Handles KV data backups to GitHub
 * Implements pagination to respect KV rate limits (900 reads per call)
 */

import { createOrUpdateFile } from '../utils/github.js';

/**
 * Perform backup of KV data to GitHub
 */
export async function performBackup(env, config) {
  console.log('Starting backup process...');

  const results = {
    subscribers: { success: false, count: 0, error: null },
    contacts: { success: false, count: 0, error: null },
    timestamp: new Date().toISOString()
  };

  try {
    // Backup subscribers with rate limit handling
    console.log('Backing up subscribers...');
    const subscriberResult = await backupSubscribers(env, config);
    results.subscribers = subscriberResult;

    // Add delay between major operations to avoid rate limits
    await delay(2000);

    // Backup contacts with rate limit handling
    console.log('Backing up contacts...');
    const contactResult = await backupContacts(env, config);
    results.contacts = contactResult;

    // Store backup metadata
    await env.KV.put('maintenance:last-backup', JSON.stringify({
      results: results,
      timestamp: new Date().toISOString()
    }));

    console.log('Backup completed successfully');
    return results;
  } catch (error) {
    console.error('Error during backup:', error);
    results.error = error.message;
    return results;
  }
}

/**
 * Backup all subscribers to CSV
 */
async function backupSubscribers(env, config) {
  try {
    const subscribers = [];
    let cursor = null;
    let hasMore = true;
    let totalReads = 0;
    const batchSize = 800; // Stay under 900 limit with buffer

    while (hasMore) {
      // Check if we're approaching rate limit
      if (totalReads >= batchSize) {
        console.log(`Reached ${totalReads} reads, waiting 5 minutes for rate limit cooldown...`);
        await delay(5 * 60 * 1000); // 5 minute cooldown
        totalReads = 0;
      }

      // List keys in batches
      const list = await env.KV.list({
        prefix: config.PREFIX_SUBSCRIBER,
        limit: Math.min(100, batchSize - totalReads), // Smaller batches
        cursor
      });

      if (!list || !list.keys || list.keys.length === 0) break;

      // Fetch values for this batch
      for (const key of list.keys) {
        try {
          const data = await env.KV.get(key.name);
          totalReads++;

          if (data) {
            // Extract email from key (format: subscriber:email@example.com)
            const email = key.name.replace(config.PREFIX_SUBSCRIBER, '');

            // Try to parse as JSON (new format) or use as string (old format)
            try {
              const subscriberData = JSON.parse(data);
              subscribers.push({
                email: subscriberData.email || email,
                ipAddress: subscriberData.ipAddress || '',
                timestamp: subscriberData.timestamp || ''
              });
            } catch {
              // Old format - just email string
              subscribers.push({
                email: email,
                ipAddress: '',
                timestamp: ''
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching subscriber ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;

      console.log(`Processed ${subscribers.length} subscribers so far...`);
    }

    // Create CSV content
    const csvContent = createSubscriberCSV(subscribers);

    // Save to GitHub using config variable
    const fileName = config.GITHUB_SUBSCRIBER_BACKUP_PATH;
    const result = await createOrUpdateFile(config, {
      repo: config.GITHUB_BACKUP_REPO,
      branch: config.GITHUB_BACKUP_BRANCH,
      path: fileName,
      content: csvContent,
      message: `Subscriber backup - ${new Date().toLocaleString()} - ${subscribers.length} records`
    });

    return {
      success: result.success,
      count: subscribers.length,
      fileName: fileName,
      error: result.success ? null : 'Failed to save to GitHub'
    };
  } catch (error) {
    console.error('Error backing up subscribers:', error);
    return {
      success: false,
      count: 0,
      error: error.message
    };
  }
}

/**
 * Backup all contacts to CSV
 */
async function backupContacts(env, config) {
  try {
    const contacts = [];
    let cursor = null;
    let hasMore = true;
    let totalReads = 0;
    const batchSize = 800; // Stay under 900 limit with buffer

    while (hasMore) {
      // Check if we're approaching rate limit
      if (totalReads >= batchSize) {
        console.log(`Reached ${totalReads} reads, waiting 5 minutes for rate limit cooldown...`);
        await delay(5 * 60 * 1000); // 5 minute cooldown
        totalReads = 0;
      }

      // List keys in batches
      const list = await env.KV.list({
        prefix: config.PREFIX_CONTACT,
        limit: Math.min(100, batchSize - totalReads), // Smaller batches
        cursor
      });

      if (!list || !list.keys || list.keys.length === 0) break;

      // Fetch values for this batch
      for (const key of list.keys) {
        try {
          const data = await env.KV.get(key.name);
          totalReads++;

          if (data) {
            const contactData = JSON.parse(data);
            contacts.push({
              email: contactData.email || '',
              name: contactData.name || '',
              phone: contactData.phone || '',
              message: contactData.message || '',
              subscribed: contactData.subscribed || false,
              ipAddress: contactData.ipAddress || contactData.ip || '',
              timestamp: contactData.timestamp || contactData.submittedAt || ''
            });
          }
        } catch (error) {
          console.error(`Error fetching contact ${key.name}:`, error);
        }
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;

      console.log(`Processed ${contacts.length} contacts so far...`);
    }

    // Create CSV content
    const csvContent = createContactCSV(contacts);

    // Save to GitHub using config variable
    const fileName = config.GITHUB_CONTACT_BACKUP_PATH;
    const result = await createOrUpdateFile(config, {
      repo: config.GITHUB_BACKUP_REPO,
      branch: config.GITHUB_BACKUP_BRANCH,
      path: fileName,
      content: csvContent,
      message: `Contact backup - ${new Date().toLocaleString()} - ${contacts.length} records`
    });

    return {
      success: result.success,
      count: contacts.length,
      fileName: fileName,
      error: result.success ? null : 'Failed to save to GitHub'
    };
  } catch (error) {
    console.error('Error backing up contacts:', error);
    return {
      success: false,
      count: 0,
      error: error.message
    };
  }
}

/**
 * Create subscriber CSV content
 */
function createSubscriberCSV(subscribers) {
  // Headers: email, ip_address, timestamp
  let csv = 'email,ip_address,timestamp\n';

  for (const subscriber of subscribers) {
    const row = [
      escapeCSV(subscriber.email),
      escapeCSV(subscriber.ipAddress),
      escapeCSV(subscriber.timestamp)
    ];
    csv += row.join(',') + '\n';
  }

  return csv;
}

/**
 * Create contact CSV content
 */
function createContactCSV(contacts) {
  // Headers in order: email, name, phone, message, subscribed, ip_address, timestamp
  let csv = 'email,name,phone,message,subscribed,ip_address,timestamp\n';

  for (const contact of contacts) {
    const row = [
      escapeCSV(contact.email),
      escapeCSV(contact.name),
      escapeCSV(contact.phone),
      escapeCSV(contact.message),
      contact.subscribed ? 'true' : 'false',
      escapeCSV(contact.ipAddress),
      escapeCSV(contact.timestamp)
    ];
    csv += row.join(',') + '\n';
  }

  return csv;
}

/**
 * Escape CSV field
 */
function escapeCSV(field) {
  if (field === null || field === undefined) return '';

  const str = String(field);

  // Check if field needs escaping
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape double quotes by doubling them
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get backup status
 */
export async function getBackupStatus(env, config) {
  try {
    const lastBackup = await env.KV.get('maintenance:last-backup');

    if (!lastBackup) {
      return {
        lastRun: null,
        subscribers: { count: 0 },
        contacts: { count: 0 }
      };
    }

    const data = JSON.parse(lastBackup);
    return {
      lastRun: data.timestamp,
      subscribers: data.results?.subscribers || { count: 0 },
      contacts: data.results?.contacts || { count: 0 }
    };
  } catch (error) {
    console.error('Error getting backup status:', error);
    return {
      lastRun: null,
      error: error.message
    };
  }
}