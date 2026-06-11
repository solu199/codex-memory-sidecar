const SECRET_PATTERNS = [
  /\b[A-Z0-9_]*(API|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*['"]?[^'"\s]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{10,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/
];

const SECRET_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|private[_-]?key|credential|bearer|authorization)/i;

export function containsLikelySecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export function isLikelySecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
