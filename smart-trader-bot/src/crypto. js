const crypto = require('crypto');

// Encrypts a secret (e.g. an agent private key) using AES-256-GCM.
// KEY_ENCRYPTION_SECRET must be a 32-byte value — checked at call time,
// not at module load, so the rest of the bot still boots fine for people
// who haven't set up auto-trading at all.
function getKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET is not set. Auto-trading requires this env var ' +
        '(32+ random bytes, e.g. `openssl rand -hex 32`) before any agent key can be stored.'
    );
  }
  // Derive a stable 32-byte key from whatever string length was provided.
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptSecret({ ciphertext, iv, tag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
