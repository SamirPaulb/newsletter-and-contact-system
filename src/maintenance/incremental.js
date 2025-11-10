/**
 * Incremental Backup Module
 * Daily: Stores backup chunks in KV with TTL
 * Weekly: Merges chunks and uploads to GitHub
 */

/**
 * Run daily backup chunk collection
 * Processes data in small chunks and stores in KV with TTL
 */
export async function runDailyBackupChunk(env, config) {
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 8; // Stop at 8ms to be safe (limit is 10ms)
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

  try {
    // Get current state for today
    const stateKey = `${config.PREFIX_BACKUP_CHUNK}state:${today}`;
    const stateData = await env.KV.get(stateKey);
    const state = stateData ? JSON.parse(stateData) : {
      phase: 'subscribers',
      cursor: null,
      processed: 0,
      date: today
    };

    console.log(`Daily backup chunk: Date ${today}, Phase ${state.phase}, Processed ${state.processed}`);

    // Phase 1: Backup subscribers
    if (state.phase === 'subscribers') {
      const processed = await backupSubscribersChunk(env, config, state, today, MAX_EXECUTION_TIME - (Date.now() - startTime));

      if (processed.complete) {
        // Move to next phase
        state.phase = 'contacts';
        state.cursor = null;
        state.processed = 0;
      } else {
        state.cursor = processed.cursor;
        state.processed += processed.count;
      }
    }

    // Phase 2: Backup contacts
    else if (state.phase === 'contacts') {
      const processed = await backupContactsChunk(env, config, state, today, MAX_EXECUTION_TIME - (Date.now() - startTime));

      if (processed.complete) {
        // All phases complete for today
        await env.KV.delete(stateKey);

        // Store completion record with TTL
        await env.KV.put(`${config.PREFIX_BACKUP_CHUNK}complete:${today}`, JSON.stringify({
          completedAt: new Date().toISOString(),
          totalProcessed: state.processed
        }), {
          expirationTtl: config.TTL_BACKUP_CHUNK
        });

        console.log(`Daily backup chunk completed for ${today}`);
        return { complete: true, date: today };
      } else {
        state.cursor = processed.cursor;
        state.processed += processed.count;
      }
    }

    // Save state for next run with TTL
    await env.KV.put(stateKey, JSON.stringify(state), {
      expirationTtl: config.TTL_BACKUP_CHUNK
    });

    const elapsed = Date.now() - startTime;
    console.log(`Daily backup chunk processed in ${elapsed}ms`);

    return {
      complete: false,
      phase: state.phase,
      processed: state.processed,
      date: today
    };

  } catch (error) {
    console.error('Daily backup chunk error:', error);
    throw error;
  }
}

/**
 * Backup subscribers chunk
 */
async function backupSubscribersChunk(env, config, state, date, maxTime) {
  const startTime = Date.now();

  // Get or create chunk data
  const chunkKey = `${config.PREFIX_BACKUP_CHUNK}subscribers:${date}`;
  const existingData = await env.KV.get(chunkKey);
  const subscribers = existingData ? JSON.parse(existingData) : [];

  const list = await env.KV.list({
    prefix: config.PREFIX_SUBSCRIBER,
    limit: config.BACKUP_CHUNK_SIZE,
    cursor: state.cursor
  });

  if (!list || !list.keys || list.keys.length === 0) {
    // Save chunk with TTL if we have data
    if (subscribers.length > 0) {
      await env.KV.put(chunkKey, JSON.stringify(subscribers), {
        expirationTtl: config.TTL_BACKUP_CHUNK
      });
    }
    return { complete: true, count: 0 };
  }

  let processed = 0;

  for (const key of list.keys) {
    // Check time limit
    if (Date.now() - startTime > maxTime) {
      await env.KV.put(chunkKey, JSON.stringify(subscribers), {
        expirationTtl: config.TTL_BACKUP_CHUNK
      });
      return { complete: false, cursor: list.cursor, count: processed };
    }

    try {
      const data = await env.KV.get(key.name);
      if (data) {
        const email = key.name.replace(config.PREFIX_SUBSCRIBER, '');
        const subscriberData = JSON.parse(data);

        // Check if this email already exists in the chunk (deduplication)
        const existingIndex = subscribers.findIndex(s => s.email === email);
        if (existingIndex >= 0) {
          // Update existing entry
          subscribers[existingIndex] = {
            email: email,
            ipAddress: subscriberData.ipAddress || '',
            timestamp: subscriberData.timestamp || ''
          };
        } else {
          // Add new entry
          subscribers.push({
            email: email,
            ipAddress: subscriberData.ipAddress || '',
            timestamp: subscriberData.timestamp || ''
          });
        }
        processed++;
      }
    } catch (e) {
      // Skip invalid entries
      console.error(`Error processing subscriber ${key.name}:`, e);
    }
  }

  // Save progress with TTL
  await env.KV.put(chunkKey, JSON.stringify(subscribers), {
    expirationTtl: config.TTL_BACKUP_CHUNK
  });

  if (list.list_complete) {
    return { complete: true, count: processed };
  }

  return { complete: false, cursor: list.cursor, count: processed };
}

/**
 * Backup contacts chunk
 */
async function backupContactsChunk(env, config, state, date, maxTime) {
  const startTime = Date.now();

  // Get or create chunk data
  const chunkKey = `${config.PREFIX_BACKUP_CHUNK}contacts:${date}`;
  const existingData = await env.KV.get(chunkKey);
  const contacts = existingData ? JSON.parse(existingData) : [];

  const list = await env.KV.list({
    prefix: config.PREFIX_CONTACT,
    limit: config.BACKUP_CHUNK_SIZE,
    cursor: state.cursor
  });

  if (!list || !list.keys || list.keys.length === 0) {
    // Save chunk with TTL if we have data
    if (contacts.length > 0) {
      await env.KV.put(chunkKey, JSON.stringify(contacts), {
        expirationTtl: config.TTL_BACKUP_CHUNK
      });
    }
    return { complete: true, count: 0 };
  }

  let processed = 0;

  for (const key of list.keys) {
    // Check time limit
    if (Date.now() - startTime > maxTime) {
      await env.KV.put(chunkKey, JSON.stringify(contacts), {
        expirationTtl: config.TTL_BACKUP_CHUNK
      });
      return { complete: false, cursor: list.cursor, count: processed };
    }

    try {
      const data = await env.KV.get(key.name);
      if (data) {
        const contact = JSON.parse(data);

        // Check if this contact already exists (deduplication by timestamp)
        const existingIndex = contacts.findIndex(c =>
          c.timestamp === (contact.timestamp || contact.submittedAt)
        );

        if (existingIndex >= 0) {
          // Update existing entry
          contacts[existingIndex] = {
            email: contact.email || '',
            name: contact.name || '',
            phone: contact.phone || '',
            message: contact.message || '',
            subscribed: contact.subscribed || false,
            ipAddress: contact.ipAddress || contact.ip || '',
            timestamp: contact.timestamp || contact.submittedAt || ''
          };
        } else {
          // Add new entry
          contacts.push({
            email: contact.email || '',
            name: contact.name || '',
            phone: contact.phone || '',
            message: contact.message || '',
            subscribed: contact.subscribed || false,
            ipAddress: contact.ipAddress || contact.ip || '',
            timestamp: contact.timestamp || contact.submittedAt || ''
          });
        }
        processed++;
      }
    } catch (e) {
      // Skip invalid entries
      console.error(`Error processing contact ${key.name}:`, e);
    }
  }

  // Save progress with TTL
  await env.KV.put(chunkKey, JSON.stringify(contacts), {
    expirationTtl: config.TTL_BACKUP_CHUNK
  });

  if (list.list_complete) {
    return { complete: true, count: processed };
  }

  return { complete: false, cursor: list.cursor, count: processed };
}

/**
 * Merge weekly backup chunks and upload to GitHub
 * This runs on Saturdays before cleanup
 */
export async function mergeAndUploadBackups(env, config) {
  console.log('Starting weekly backup merge and upload...');

  const results = {
    subscribers: { success: false, count: 0, error: null },
    contacts: { success: false, count: 0, error: null },
    timestamp: new Date().toISOString()
  };

  try {
    // Check GitHub configuration
    if (!config.GITHUB_TOKEN || !config.GITHUB_OWNER || !config.GITHUB_BACKUP_REPO) {
      const error = 'GitHub configuration incomplete';
      console.error(error);
      results.error = error;
      return results;
    }

    // Merge and upload subscribers
    console.log('Merging subscriber backup chunks...');
    const subscriberResult = await mergeAndUploadSubscribers(env, config);
    results.subscribers = subscriberResult;

    // Merge and upload contacts
    console.log('Merging contact backup chunks...');
    const contactResult = await mergeAndUploadContacts(env, config);
    results.contacts = contactResult;

    // Store backup metadata
    await env.KV.put(`${config.KEEP_PREFIX_MAINTENANCE}weekly-backup`, JSON.stringify({
      results: results,
      timestamp: results.timestamp
    }));

    console.log('Weekly backup merge completed');
    console.log(`Subscribers: ${results.subscribers.count}, Contacts: ${results.contacts.count}`);

    return results;
  } catch (error) {
    console.error('Error during weekly backup merge:', error);
    results.error = error.message;
    return results;
  }
}

/**
 * Merge subscriber chunks and upload
 */
async function mergeAndUploadSubscribers(env, config) {
  try {
    const allSubscribers = new Map(); // Use Map for deduplication by email

    // List all subscriber backup chunks
    const list = await env.KV.list({
      prefix: `${config.PREFIX_BACKUP_CHUNK}subscribers:`,
      limit: config.BACKUP_CHUNK_LIST_LIMIT
    });

    if (!list || !list.keys || list.keys.length === 0) {
      console.log('No subscriber backup chunks found');
      return { success: false, count: 0, error: 'No backup chunks found' };
    }

    // Merge all chunks
    for (const key of list.keys) {
      try {
        const chunkData = await env.KV.get(key.name);
        if (chunkData) {
          const subscribers = JSON.parse(chunkData);
          for (const subscriber of subscribers) {
            // Use email as key for deduplication
            allSubscribers.set(subscriber.email, subscriber);
          }
        }
      } catch (e) {
        console.error(`Error reading chunk ${key.name}:`, e);
      }
    }

    // Convert Map to array
    const subscribersArray = Array.from(allSubscribers.values());

    // Create CSV content
    const csvContent = createSubscriberCSV(subscribersArray);

    // Upload to GitHub
    const { createOrUpdateFile } = await import('../utils/github.js');
    const fileName = config.GITHUB_SUBSCRIBER_BACKUP_PATH;

    const result = await createOrUpdateFile(config, {
      repo: config.GITHUB_BACKUP_REPO,
      branch: config.GITHUB_BACKUP_BRANCH,
      path: fileName,
      content: csvContent,
      message: `Weekly subscriber backup - ${new Date().toLocaleString()} - ${subscribersArray.length} records`
    });

    if (result.success) {
      console.log(`Successfully uploaded ${subscribersArray.length} subscribers to GitHub`);

      // Clean up processed chunks (they have TTL but we can clean them now)
      for (const key of list.keys) {
        await env.KV.delete(key.name);
      }
    }

    return {
      success: result.success,
      count: subscribersArray.length,
      fileName: fileName,
      error: result.success ? null : result.error
    };
  } catch (error) {
    console.error('Error merging subscriber backups:', error);
    return {
      success: false,
      count: 0,
      error: error.message
    };
  }
}

/**
 * Merge contact chunks and upload
 */
async function mergeAndUploadContacts(env, config) {
  try {
    const allContacts = new Map(); // Use Map for deduplication by timestamp

    // List all contact backup chunks
    const list = await env.KV.list({
      prefix: `${config.PREFIX_BACKUP_CHUNK}contacts:`,
      limit: config.BACKUP_CHUNK_LIST_LIMIT
    });

    if (!list || !list.keys || list.keys.length === 0) {
      console.log('No contact backup chunks found');
      return { success: false, count: 0, error: 'No backup chunks found' };
    }

    // Merge all chunks
    for (const key of list.keys) {
      try {
        const chunkData = await env.KV.get(key.name);
        if (chunkData) {
          const contacts = JSON.parse(chunkData);
          for (const contact of contacts) {
            // Use timestamp as key for deduplication
            const key = contact.timestamp || `${contact.email}-${contact.name}`;
            allContacts.set(key, contact);
          }
        }
      } catch (e) {
        console.error(`Error reading chunk ${key.name}:`, e);
      }
    }

    // Convert Map to array
    const contactsArray = Array.from(allContacts.values());

    // Create CSV content
    const csvContent = createContactCSV(contactsArray);

    // Upload to GitHub
    const { createOrUpdateFile } = await import('../utils/github.js');
    const fileName = config.GITHUB_CONTACT_BACKUP_PATH;

    const result = await createOrUpdateFile(config, {
      repo: config.GITHUB_BACKUP_REPO,
      branch: config.GITHUB_BACKUP_BRANCH,
      path: fileName,
      content: csvContent,
      message: `Weekly contact backup - ${new Date().toLocaleString()} - ${contactsArray.length} records`
    });

    if (result.success) {
      console.log(`Successfully uploaded ${contactsArray.length} contacts to GitHub`);

      // Clean up processed chunks (they have TTL but we can clean them now)
      for (const key of list.keys) {
        await env.KV.delete(key.name);
      }
    }

    return {
      success: result.success,
      count: contactsArray.length,
      fileName: fileName,
      error: result.success ? null : result.error
    };
  } catch (error) {
    console.error('Error merging contact backups:', error);
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
 * Cleanup old entries (runs after backup on Saturdays)
 */
export async function runCleanup(env, config) {
  console.log('Starting cleanup of old entries...');

  const prefixesToClean = [
    { prefix: config.PREFIX_RATELIMIT, name: 'Rate limits' },
    { prefix: config.PREFIX_BOT_DETECT, name: 'Bot detection' },
    { prefix: config.PREFIX_CAPTCHA, name: 'Captcha tokens' }
  ];

  let totalDeleted = 0;

  for (const { prefix, name } of prefixesToClean) {
    let deleted = 0;
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const list = await env.KV.list({
        prefix: prefix,
        limit: config.CLEANUP_BATCH_SIZE,
        cursor
      });

      if (!list || !list.keys || list.keys.length === 0) break;

      // Delete all keys with this prefix (they have TTL but we clean them weekly)
      for (const key of list.keys) {
        await env.KV.delete(key.name);
        deleted++;
      }

      hasMore = !list.list_complete;
      cursor = list.cursor;
    }

    console.log(`Cleaned ${deleted} ${name} entries`);
    totalDeleted += deleted;
  }

  console.log(`Cleanup completed. Total entries deleted: ${totalDeleted}`);

  return {
    success: true,
    deleted: totalDeleted,
    timestamp: new Date().toISOString()
  };
}