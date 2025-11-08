/**
 * GitHub API utility functions
 */

import { withRetry, withHttpRetry } from './retry.js';

/**
 * Convert string to base64
 */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Get file from GitHub repository
 */
export async function getFile(config, { repo, branch, path }) {
  const url = `https://api.github.com/repos/${config.GITHUB_OWNER}/${repo}/contents/${path}?ref=${branch}`;

  const result = await withHttpRetry(url, {
    headers: {
      'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Cloudflare-Worker'
    }
  }, {
    maxAttempts: 3,
    initialDelay: 1000,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504]
  });

  if (!result.success) {
    if (result.error?.status === 404) {
      return null; // File doesn't exist
    }
    console.error('Error getting file from GitHub:', result.error);
    throw result.error;
  }

  const data = await result.result.json();
  return data;
}

/**
 * Create or update file in GitHub repository
 */
export async function createOrUpdateFile(config, { repo, branch, path, content, message }) {
  return await withRetry(async (attempt) => {
    console.log(`GitHub file update attempt ${attempt} for ${path}`);

    // Check if file exists
    const existingFile = await getFile(config, { repo, branch, path }).catch(() => null);

    const url = `https://api.github.com/repos/${config.GITHUB_OWNER}/${repo}/contents/${path}`;

    const body = {
      message: message,
      content: toBase64(content),
      branch: branch
    };

    // If file exists, include its SHA for update
    if (existingFile && existingFile.sha) {
      body.sha = existingFile.sha;
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      const errorObj = new Error(`GitHub API error: ${response.status} - ${error}`);
      errorObj.status = response.status;

      // Don't retry on certain errors
      if (response.status === 401 || response.status === 403 || response.status === 422) {
        throw errorObj; // These won't be retried
      }

      // Retry on server errors
      if (response.status >= 500 || response.status === 429) {
        throw errorObj; // Will be retried
      }

      throw errorObj;
    }

    const result = await response.json();
    return {
      success: true,
      sha: result.content.sha,
      url: result.content.html_url
    };
  }, {
    maxAttempts: 3,
    initialDelay: 2000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  });
}

/**
 * Commit multiple files to GitHub using low-level Git API
 */
export async function commitMultipleFiles(config, { repo, branch, files, message }) {
  try {
    const githubApi = 'https://api.github.com';
    const owner = config.GITHUB_OWNER;
    const token = config.GITHUB_TOKEN;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Cloudflare-Worker'
    };

    // Get current branch reference
    const refRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      headers
    });

    if (!refRes.ok) {
      // Branch might not exist, try to create it from main
      const mainRefRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/main`, {
        headers
      });

      if (!mainRefRes.ok) {
        throw new Error('Could not find main branch');
      }

      const mainRef = await mainRefRes.json();

      // Create new branch
      const createBranchRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: mainRef.object.sha
        })
      });

      if (!createBranchRes.ok) {
        throw new Error('Failed to create branch');
      }

      // Re-fetch the new branch reference
      const newRefRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        headers
      });

      if (!newRefRes.ok) {
        throw new Error('Failed to get new branch reference');
      }

      const refData = await newRefRes.json();
      return await continueCommit(githubApi, owner, repo, branch, token, headers, refData, files, message);
    }

    const refData = await refRes.json();
    return await continueCommit(githubApi, owner, repo, branch, token, headers, refData, files, message);
  } catch (error) {
    console.error('Error committing to GitHub:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function continueCommit(githubApi, owner, repo, branch, token, headers, refData, files, message) {
  // Get the commit object
  const commitRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/commits/${refData.object.sha}`, {
    headers
  });

  if (!commitRes.ok) {
    throw new Error('Failed to get commit');
  }

  const commitData = await commitRes.json();

  // Create blobs for each file
  const blobs = [];
  for (const file of files) {
    const blobRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: toBase64(file.content),
        encoding: 'base64'
      })
    });

    if (!blobRes.ok) {
      throw new Error(`Failed to create blob for ${file.path}`);
    }

    const blob = await blobRes.json();
    blobs.push({
      path: file.path,
      sha: blob.sha
    });
  }

  // Create tree
  const treeRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: commitData.tree.sha,
      tree: blobs.map(blob => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      }))
    })
  });

  if (!treeRes.ok) {
    throw new Error('Failed to create tree');
  }

  const tree = await treeRes.json();

  // Create commit
  const newCommitRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: message,
      tree: tree.sha,
      parents: [refData.object.sha]
    })
  });

  if (!newCommitRes.ok) {
    throw new Error('Failed to create commit');
  }

  const newCommit = await newCommitRes.json();

  // Update reference
  const updateRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      sha: newCommit.sha,
      force: false
    })
  });

  if (!updateRes.ok) {
    // Retry with latest SHA in case of conflict
    const latestRefRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      headers
    });

    if (latestRefRes.ok) {
      const latestRef = await latestRefRes.json();
      const retryCommitRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: message,
          tree: tree.sha,
          parents: [latestRef.object.sha]
        })
      });

      if (retryCommitRes.ok) {
        const retryCommit = await retryCommitRes.json();
        const retryUpdateRes = await fetch(`${githubApi}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            sha: retryCommit.sha,
            force: false
          })
        });

        if (!retryUpdateRes.ok) {
          throw new Error('Failed to update reference after retry');
        }

        return {
          success: true,
          commitSha: retryCommit.sha
        };
      }
    }

    throw new Error('Failed to update reference');
  }

  return {
    success: true,
    commitSha: newCommit.sha
  };
}

/**
 * Backup KV data to GitHub as CSV
 */
export async function backupToGitHub(config, csvContent) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `kv-backup-${timestamp}.csv`;
  const path = config.GITHUB_BACKUP_PATH || fileName;

  const result = await createOrUpdateFile(config, {
    repo: config.GITHUB_BACKUP_REPO,
    branch: config.GITHUB_BACKUP_BRANCH,
    path: path,
    content: csvContent,
    message: `KV backup - ${new Date().toLocaleString()}`
  });

  return result;
}

/**
 * Save contact form submission to GitHub
 */
export async function saveContactToGitHub(config, contactData) {
  const content = JSON.stringify(contactData, null, 2);

  const result = await createOrUpdateFile(config, {
    repo: config.GITHUB_CONTACT_REPO,
    branch: config.GITHUB_CONTACT_BRANCH,
    path: config.GITHUB_CONTACT_PATH,
    content: content,
    message: `Contact from ${contactData.name} <${contactData.email}>`
  });

  return result;
}