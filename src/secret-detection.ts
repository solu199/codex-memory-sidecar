const SECRET_PATTERNS = [
  /\b[A-Z0-9_]*(API|TOKEN|SECRET|PASSWORD|PRIVATE)[A-Z0-9_]*\s*=\s*['"]?[^'"\s]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/
];

const SECRET_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|private[_-]?key|credential)/i;

export function containsLikelySecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export function isLikelySecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
