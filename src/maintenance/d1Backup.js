/**
 * D1 Database Backup Module
 * Exports D1 database to SQL format and uploads to GitHub
 * Runs weekly on Wednesday at noon UTC
 */

import { saveToGitHub } from '../utils/github.js';

/**
 * Export D1 database to SQL format and upload to GitHub
 * @param {Object} env - Environment with D1 binding
 * @param {Object} config - Configuration object
 * @returns {Object} - Result of the backup operation
 */
export async function backupD1ToGitHub(env, config) {
  console.log('Starting D1 database backup to GitHub...');

  const result = {
    success: false,
    message: '',
    timestamp: new Date().toISOString(),
    tables: {
      subscriber: { count: 0, success: false },
      contact: { count: 0, success: false }
    }
  };

  try {
    // Check if D1 is available
    if (!env.D1) {
      result.message = 'D1 database not configured';
      console.log(result.message);
      return result;
    }

    // Check GitHub configuration
    if (!config.GITHUB_TOKEN || !config.GITHUB_OWNER) {
      result.message = 'GitHub configuration incomplete';
      console.error(result.message);
      return result;
    }

    // Generate SQL backup content
    let sqlContent = `-- Cloudflare D1 Database Backup
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

    // Export subscriber table
    console.log('Exporting subscriber table...');
    try {
      const subscribers = await env.D1.prepare(
        'SELECT email, ip_address, timestamp FROM subscriber ORDER BY timestamp'
      ).all();

      if (subscribers.results && subscribers.results.length > 0) {
        sqlContent += '-- Subscriber data\n';
        for (const row of subscribers.results) {
          // Escape single quotes in values
          const email = row.email ? row.email.replace(/'/g, "''") : '';
          const ip = row.ip_address ? row.ip_address.replace(/'/g, "''") : '';
          const ts = row.timestamp ? row.timestamp.replace(/'/g, "''") : '';

          sqlContent += `INSERT INTO subscriber (email, ip_address, timestamp) VALUES ('${email}', '${ip}', '${ts}');\n`;
        }
        result.tables.subscriber.count = subscribers.results.length;
        result.tables.subscriber.success = true;
        sqlContent += '\n';
      } else {
        sqlContent += '-- No subscriber data\n\n';
        result.tables.subscriber.success = true;
      }
    } catch (error) {
      console.error('Error exporting subscriber table:', error);
      sqlContent += `-- Error exporting subscriber table: ${error.message}\n\n`;
    }

    // Export contact table
    sqlContent += `-- ================================================
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

    console.log('Exporting contact table...');
    try {
      const contacts = await env.D1.prepare(
        'SELECT email, name, phone, subscribed, ip_address, timestamp FROM contact ORDER BY timestamp'
      ).all();

      if (contacts.results && contacts.results.length > 0) {
        sqlContent += '-- Contact data\n';
        for (const row of contacts.results) {
          // Escape single quotes in values
          const email = row.email ? row.email.replace(/'/g, "''") : '';
          const name = row.name ? row.name.replace(/'/g, "''") : '';
          const phone = row.phone ? row.phone.replace(/'/g, "''") : '';
          const subscribed = row.subscribed ? row.subscribed.replace(/'/g, "''") : 'false';
          const ip = row.ip_address ? row.ip_address.replace(/'/g, "''") : '';
          const ts = row.timestamp ? row.timestamp.replace(/'/g, "''") : '';

          sqlContent += `INSERT INTO contact (email, name, phone, subscribed, ip_address, timestamp) VALUES ('${email}', '${name}', '${phone}', '${subscribed}', '${ip}', '${ts}');\n`;
        }
        result.tables.contact.count = contacts.results.length;
        result.tables.contact.success = true;
        sqlContent += '\n';
      } else {
        sqlContent += '-- No contact data\n\n';
        result.tables.contact.success = true;
      }
    } catch (error) {
      console.error('Error exporting contact table:', error);
      sqlContent += `-- Error exporting contact table: ${error.message}\n\n`;
    }

    // Add footer
    sqlContent += `-- ================================================
-- End of backup
-- Total subscribers: ${result.tables.subscriber.count}
-- Total contacts: ${result.tables.contact.count}
-- ================================================
`;

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
      sqlContent,
      `D1 backup - ${new Date().toISOString()}`
    );

    if (githubResult.success) {
      result.success = true;
      result.message = `Successfully backed up D1 database to GitHub. Subscribers: ${result.tables.subscriber.count}, Contacts: ${result.tables.contact.count}`;
      console.log(result.message);
    } else {
      result.message = `Failed to upload backup to GitHub: ${githubResult.error}`;
      console.error(result.message);
    }

  } catch (error) {
    result.message = `D1 backup error: ${error.message}`;
    console.error(result.message);
  }

  return result;
}

/**
 * Get D1 database statistics (read-only, for monitoring)
 * @param {Object} env - Environment with D1 binding
 * @returns {Object} - Database statistics
 */
export async function getD1Stats(env) {
  const stats = {
    available: false,
    subscribers: 0,
    contacts: 0,
    error: null
  };

  try {
    if (!env.D1) {
      stats.error = 'D1 not configured';
      return stats;
    }

    stats.available = true;

    // Get subscriber count
    const subCount = await env.D1.prepare(
      'SELECT COUNT(*) as count FROM subscriber'
    ).first();
    stats.subscribers = subCount?.count || 0;

    // Get contact count
    const contactCount = await env.D1.prepare(
      'SELECT COUNT(*) as count FROM contact'
    ).first();
    stats.contacts = contactCount?.count || 0;

  } catch (error) {
    stats.error = error.message;
    console.error('D1 stats error:', error);
  }

  return stats;
}