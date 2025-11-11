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
      (async () => {
        try {
          // Insert or replace to always keep latest timestamp
          // Table already exists with columns: email, ip_address, timestamp
          await env.D1.prepare(
            `INSERT OR REPLACE INTO subscriber (email, ip_address, timestamp)
             VALUES (?, ?, ?)`
          )
          .bind(
            email || '',
            ipAddress || '',
            timestamp || new Date().toISOString()
          )
          .run();
        } catch (error) {
          // Log error but don't throw - this is non-critical
          // Handle duplicate key or any other errors gracefully
          if (!error.message?.includes('UNIQUE constraint') && !error.message?.includes('already exists')) {
            console.error('D1 subscriber replication error (non-critical):', error.message);
          }
        }
      })()
    );
  } else {
    // Fallback: fire and forget without waitUntil
    (async () => {
      try {
        await env.D1.prepare(
          `INSERT OR REPLACE INTO subscriber (email, ip_address, timestamp)
           VALUES (?, ?, ?)`
        )
        .bind(
          email || '',
          ipAddress || '',
          timestamp || new Date().toISOString()
        )
        .run();
      } catch (error) {
        if (!error.message?.includes('UNIQUE constraint') && !error.message?.includes('already exists')) {
          console.error('D1 subscriber replication error (non-critical):', error.message);
        }
      }
    })();
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
      (async () => {
        try {
          // Always insert new contact record (append-only)
          // Table already exists with columns: email, name, phone, subscribed, ip_address, timestamp, message
          await env.D1.prepare(
            `INSERT INTO contact (email, name, phone, subscribed, ip_address, timestamp, message)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            contactData.email || '',
            contactData.name || '',
            contactData.phone || '',
            contactData.subscribed ? 'true' : 'false',  // Convert boolean to text for D1
            contactData.ipAddress || contactData.ip || '',
            contactData.timestamp || contactData.submittedAt || new Date().toISOString(),
            contactData.message || ''
          )
          .run();
        } catch (error) {
          // Log error but don't throw - this is non-critical
          console.error('D1 contact replication error (non-critical):', error.message);
        }
      })()
    );
  } else {
    // Fallback: fire and forget without waitUntil
    (async () => {
      try {
        await env.D1.prepare(
          `INSERT INTO contact (email, name, phone, subscribed, ip_address, timestamp, message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          contactData.email || '',
          contactData.name || '',
          contactData.phone || '',
          contactData.subscribed ? 'true' : 'false',  // Convert boolean to text for D1
          contactData.ipAddress || contactData.ip || '',
          contactData.timestamp || contactData.submittedAt || new Date().toISOString(),
          contactData.message || ''
        )
        .run();
      } catch (error) {
        console.error('D1 contact replication error (non-critical):', error.message);
      }
    })();
  }
}

// Batch replication removed - not needed since data is replicated on-the-fly during form submission

/**
 * Helper to check if D1 is available (for debugging)
 * @param {Object} env - Environment
 * @returns {boolean} - Whether D1 is configured
 */
export function isD1Available(env) {
  return !!env.D1;
}