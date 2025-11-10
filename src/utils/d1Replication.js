/**
 * D1 Database Replication Module
 * Asynchronously replicates data to D1 database without blocking main operations
 * This is a write-only module - NO READS from D1
 */

/**
 * Replicate subscriber data to D1 (async, non-blocking)
 * @param {Object} env - Environment with D1 binding
 * @param {ExecutionContext} ctx - Execution context for waitUntil
 * @param {string} email - Subscriber email
 * @param {string} ipAddress - IP address
 * @param {string} timestamp - ISO timestamp
 */
export async function replicateSubscriberToD1(env, ctx, email, ipAddress, timestamp) {
  // Only proceed if D1 is configured
  if (!env.D1) {
    return;
  }

  // Use waitUntil to run in background after response is sent
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(
      env.D1.prepare(
        `INSERT OR IGNORE INTO subscriber (email, ip_address, timestamp)
         VALUES (?, ?, ?)`
      )
      .bind(email, ipAddress || '', timestamp || new Date().toISOString())
      .run()
      .catch(error => {
        // Log error but don't throw - this is non-critical
        console.error('D1 subscriber replication error (non-critical):', error);
      })
    );
  } else {
    // Fallback: fire and forget without waitUntil
    env.D1.prepare(
      `INSERT OR IGNORE INTO subscriber (email, ip_address, timestamp)
       VALUES (?, ?, ?)`
    )
    .bind(email, ipAddress || '', timestamp || new Date().toISOString())
    .run()
    .catch(error => {
      console.error('D1 subscriber replication error (non-critical):', error);
    });
  }
}

/**
 * Replicate contact data to D1 (async, non-blocking)
 * @param {Object} env - Environment with D1 binding
 * @param {ExecutionContext} ctx - Execution context for waitUntil
 * @param {Object} contactData - Contact form data
 */
export async function replicateContactToD1(env, ctx, contactData) {
  // Only proceed if D1 is configured
  if (!env.D1) {
    return;
  }

  // Use waitUntil to run in background after response is sent
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(
      env.D1.prepare(
        `INSERT OR IGNORE INTO contact (email, name, phone, subscribed, ip_address, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        contactData.email || '',
        contactData.name || '',
        contactData.phone || '',
        contactData.subscribed ? 'true' : 'false',  // Convert boolean to text for D1
        contactData.ipAddress || contactData.ip || '',
        contactData.timestamp || contactData.submittedAt || new Date().toISOString()
      )
      .run()
      .catch(error => {
        // Log error but don't throw - this is non-critical
        console.error('D1 contact replication error (non-critical):', error);
      })
    );
  } else {
    // Fallback: fire and forget without waitUntil
    env.D1.prepare(
      `INSERT OR IGNORE INTO contact (email, name, phone, subscribed, ip_address, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      contactData.email || '',
      contactData.name || '',
      contactData.phone || '',
      contactData.subscribed ? 'true' : 'false',  // Convert boolean to text for D1
      contactData.ipAddress || contactData.ip || '',
      contactData.timestamp || contactData.submittedAt || new Date().toISOString()
    )
    .run()
    .catch(error => {
      console.error('D1 contact replication error (non-critical):', error);
    });
  }
}

/**
 * Batch replicate multiple records (for backup restoration)
 * This is still async but uses batch for efficiency
 * @param {Object} env - Environment with D1 binding
 * @param {Array} subscribers - Array of subscriber objects
 * @param {Array} contacts - Array of contact objects
 */
export async function batchReplicateToD1(env, subscribers = [], contacts = []) {
  // Only proceed if D1 is configured
  if (!env.D1) {
    return;
  }

  try {
    const statements = [];

    // Prepare subscriber statements
    for (const subscriber of subscribers) {
      statements.push(
        env.D1.prepare(
          `INSERT OR IGNORE INTO subscriber (email, ip_address, timestamp)
           VALUES (?, ?, ?)`
        ).bind(
          subscriber.email || '',
          subscriber.ipAddress || subscriber.ip_address || '',
          subscriber.timestamp || new Date().toISOString()
        )
      );
    }

    // Prepare contact statements
    for (const contact of contacts) {
      statements.push(
        env.D1.prepare(
          `INSERT OR IGNORE INTO contact (email, name, phone, subscribed, ip_address, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          contact.email || '',
          contact.name || '',
          contact.phone || '',
          contact.subscribed ? 'true' : 'false',  // Convert boolean to text for D1
          contact.ipAddress || contact.ip_address || '',
          contact.timestamp || new Date().toISOString()
        )
      );
    }

    // Execute batch if there are statements
    if (statements.length > 0) {
      // Fire and forget - don't await
      env.D1.batch(statements)
        .catch(error => {
          console.error('D1 batch replication error (non-critical):', error);
        });
    }
  } catch (error) {
    console.error('D1 batch replication setup error (non-critical):', error);
  }
}

/**
 * Helper to check if D1 is available (for debugging)
 * @param {Object} env - Environment
 * @returns {boolean} - Whether D1 is configured
 */
export function isD1Available(env) {
  return !!env.D1;
}