/**
 * D1 Database Backup Module - Optimized for Free Plan
 * Processes data in small chunks to avoid CPU limits
 * Uses KV to store progress and assembled backup
 */

import { saveToGitHub } from '../utils/github.js';

const CHUNK_SIZE = 10; // Process only 10 records at a time to stay under CPU limit
const MAX_EXECUTION_TIME = 8; // 8ms max to be safe (10ms limit)

/**
 * Start or continue D1 backup process
 * @param {Object} env - Environment with D1 and KV bindings
 * @param {Object} config - Configuration object
 * @returns {Object} - Result of the backup operation
 */
export async function backupD1ToGitHubChunked(env, config) {
  const startTime = Date.now();
  console.log('Starting/continuing D1 database backup (chunked mode)...');

  const backupKey = 'd1:backup:progress';
  const backupDataKey = 'd1:backup:data';

  // Get or initialize backup progress
  let progress = await env.KV.get(backupKey, { type: 'json' });
  if (!progress) {
    progress = {
      state: 'starting',
      subscribersOffset: 0,
      subscribersTotal: 0,
      subscribersDone: false,
      contactsOffset: 0,
      contactsTotal: 0,
      contactsDone: false,
      timestamp: new Date().toISOString(),
      sqlContent: ''
    };
  }

  try {
    // Check if D1 is available
    if (!env.D1) {
      return {
        success: false,
        message: 'D1 database not configured',
        continueNextCron: false
      };
    }

    // Initialize SQL content if starting fresh
    if (progress.state === 'starting') {
      progress.sqlContent = `-- Cloudflare D1 Database Backup (Chunked)
-- Generated: ${new Date().toISOString()}
-- Database: data
-- Environment: Production

-- ================================================
-- Table: subscriber
-- ================================================

CREATE TABLE IF NOT EXISTS subscriber (
  email TEXT PRIMARY KEY,
  ip_address TEXT,
  timestamp TEXT
);

`;
      progress.state = 'exporting_subscribers';

      // Get total count
      const countResult = await env.D1.prepare(
        'SELECT COUNT(*) as count FROM subscriber'
      ).first();
      progress.subscribersTotal = countResult?.count || 0;
      console.log(`Total subscribers to export: ${progress.subscribersTotal}`);
    }

    // Export subscribers in chunks
    if (progress.state === 'exporting_subscribers' && !progress.subscribersDone) {
      if (progress.subscribersTotal === 0) {
        progress.sqlContent += '-- No subscriber data\n\n';
        progress.subscribersDone = true;
      } else {
        console.log(`Exporting subscribers: ${progress.subscribersOffset}/${progress.subscribersTotal}`);

        // Get next chunk
        const subscribers = await env.D1.prepare(
          'SELECT email, ip_address, timestamp FROM subscriber ORDER BY timestamp LIMIT ? OFFSET ?'
        ).bind(CHUNK_SIZE, progress.subscribersOffset).all();

        if (subscribers.results && subscribers.results.length > 0) {
          if (progress.subscribersOffset === 0) {
            progress.sqlContent += '-- Subscriber data\n';
          }

          for (const row of subscribers.results) {
            // Check execution time
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
              // Save progress and return - will continue on next cron
              await env.KV.put(backupKey, JSON.stringify(progress));
              await env.KV.put(backupDataKey, progress.sqlContent);
              return {
                success: true,
                message: `Processing subscribers: ${progress.subscribersOffset}/${progress.subscribersTotal}`,
                continueNextCron: true
              };
            }

            // Escape single quotes in values
            const email = row.email ? row.email.replace(/'/g, "''") : '';
            const ip = row.ip_address ? row.ip_address.replace(/'/g, "''") : '';
            const ts = row.timestamp ? row.timestamp.replace(/'/g, "''") : '';

            progress.sqlContent += `INSERT INTO subscriber (email, ip_address, timestamp) VALUES ('${email}', '${ip}', '${ts}');\n`;
            progress.subscribersOffset++;
          }
        }

        if (progress.subscribersOffset >= progress.subscribersTotal) {
          progress.subscribersDone = true;
          progress.sqlContent += '\n';
        }
      }

      // Move to contacts if subscribers done
      if (progress.subscribersDone) {
        progress.state = 'exporting_contacts';

        // Get contacts count
        const countResult = await env.D1.prepare(
          'SELECT COUNT(*) as count FROM contact'
        ).first();
        progress.contactsTotal = countResult?.count || 0;
        console.log(`Total contacts to export: ${progress.contactsTotal}`);

        progress.sqlContent += `-- ================================================
-- Table: contact
-- ================================================

CREATE TABLE IF NOT EXISTS contact (
  email TEXT,
  name TEXT,
  phone TEXT,
  subscribed TEXT,
  ip_address TEXT,
  timestamp TEXT
);

`;
      }
    }

    // Export contacts in chunks
    if (progress.state === 'exporting_contacts' && !progress.contactsDone) {
      if (progress.contactsTotal === 0) {
        progress.sqlContent += '-- No contact data\n\n';
        progress.contactsDone = true;
      } else {
        console.log(`Exporting contacts: ${progress.contactsOffset}/${progress.contactsTotal}`);

        // Get next chunk
        const contacts = await env.D1.prepare(
          'SELECT email, name, phone, subscribed, ip_address, timestamp FROM contact ORDER BY timestamp LIMIT ? OFFSET ?'
        ).bind(CHUNK_SIZE, progress.contactsOffset).all();

        if (contacts.results && contacts.results.length > 0) {
          if (progress.contactsOffset === 0) {
            progress.sqlContent += '-- Contact data\n';
          }

          for (const row of contacts.results) {
            // Check execution time
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
              // Save progress and return - will continue on next cron
              await env.KV.put(backupKey, JSON.stringify(progress));
              await env.KV.put(backupDataKey, progress.sqlContent);
              return {
                success: true,
                message: `Processing contacts: ${progress.contactsOffset}/${progress.contactsTotal}`,
                continueNextCron: true
              };
            }

            // Escape single quotes in values
            const email = row.email ? row.email.replace(/'/g, "''") : '';
            const name = row.name ? row.name.replace(/'/g, "''") : '';
            const phone = row.phone ? row.phone.replace(/'/g, "''") : '';
            const subscribed = row.subscribed ? row.subscribed.replace(/'/g, "''") : 'false';
            const ip = row.ip_address ? row.ip_address.replace(/'/g, "''") : '';
            const ts = row.timestamp ? row.timestamp.replace(/'/g, "''") : '';

            progress.sqlContent += `INSERT INTO contact (email, name, phone, subscribed, ip_address, timestamp) VALUES ('${email}', '${name}', '${phone}', '${subscribed}', '${ip}', '${ts}');\n`;
            progress.contactsOffset++;
          }
        }

        if (progress.contactsOffset >= progress.contactsTotal) {
          progress.contactsDone = true;
          progress.sqlContent += '\n';
        }
      }
    }

    // If both tables are done, upload to GitHub
    if (progress.subscribersDone && progress.contactsDone) {
      progress.state = 'uploading';

      // Add footer
      progress.sqlContent += `-- ================================================
-- End of backup
-- Total subscribers: ${progress.subscribersTotal}
-- Total contacts: ${progress.contactsTotal}
-- ================================================
`;

      // Save final SQL to KV temporarily
      await env.KV.put(backupDataKey, progress.sqlContent);

      // Upload to GitHub
      console.log('Uploading SQL backup to GitHub...');
      const githubResult = await saveToGitHub(
        {
          GITHUB_TOKEN: config.GITHUB_TOKEN,
          GITHUB_OWNER: config.GITHUB_OWNER,
          GITHUB_REPO: config.GITHUB_BACKUP_REPO || 'database-backup',
          GITHUB_BRANCH: config.GITHUB_BACKUP_BRANCH || 'main',
          GITHUB_PATH: 'cloudflare-d1-data-backup.sql'
        },
        progress.sqlContent,
        `D1 backup - ${new Date().toISOString()}`
      );

      // Clean up KV storage
      await env.KV.delete(backupKey);
      await env.KV.delete(backupDataKey);

      if (githubResult.success) {
        return {
          success: true,
          message: `Successfully backed up D1 database to GitHub. Subscribers: ${progress.subscribersTotal}, Contacts: ${progress.contactsTotal}`,
          continueNextCron: false
        };
      } else {
        return {
          success: false,
          message: `Failed to upload backup to GitHub: ${githubResult.error}`,
          continueNextCron: false
        };
      }
    }

    // Save progress for next run
    await env.KV.put(backupKey, JSON.stringify(progress));
    await env.KV.put(backupDataKey, progress.sqlContent);

    return {
      success: true,
      message: `Backup in progress: Subscribers ${progress.subscribersOffset}/${progress.subscribersTotal}, Contacts ${progress.contactsOffset}/${progress.contactsTotal}`,
      continueNextCron: true
    };

  } catch (error) {
    console.error('D1 backup error:', error);

    // Clean up on error
    await env.KV.delete(backupKey);
    await env.KV.delete(backupDataKey);

    return {
      success: false,
      message: `D1 backup error: ${error.message}`,
      continueNextCron: false
    };
  }
}

/**
 * Get D1 backup status from KV
 * @param {Object} env - Environment with KV binding
 * @returns {Object} - Current backup status
 */
export async function getD1BackupStatus(env) {
  const progress = await env.KV.get('d1:backup:progress', { type: 'json' });

  if (!progress) {
    return {
      inProgress: false,
      message: 'No backup in progress'
    };
  }

  return {
    inProgress: true,
    state: progress.state,
    subscribers: {
      processed: progress.subscribersOffset,
      total: progress.subscribersTotal,
      done: progress.subscribersDone
    },
    contacts: {
      processed: progress.contactsOffset,
      total: progress.contactsTotal,
      done: progress.contactsDone
    },
    startedAt: progress.timestamp
  };
}