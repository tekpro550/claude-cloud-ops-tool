import { ConfigService } from '@nestjs/config';

/**
 * Symmetric key used to encrypt cloud_credentials.config_encrypted at rest
 * via pgcrypto's pgp_sym_encrypt/pgp_sym_decrypt. The key lives only in the
 * app's environment and is passed to Postgres as a bound query parameter, so
 * a database dump on its own contains ciphertext the dump can't decrypt --
 * the whole point of encrypting these AWS/Azure secrets at rest.
 *
 * The dev default keeps the local/pilot flow working with no extra setup;
 * production MUST set CREDENTIALS_ENCRYPTION_KEY (the deployment guide's
 * env checklist references it), otherwise every install shares one key.
 */
const DEV_DEFAULT_KEY = 'dev-only-credentials-key-change-me-in-prod';

export function credentialsEncryptionKey(config: ConfigService): string {
  return config.get<string>('CREDENTIALS_ENCRYPTION_KEY', DEV_DEFAULT_KEY);
}

/**
 * The migration runs outside Nest's DI, so it reads the same env var
 * directly rather than through ConfigService -- kept here so the key
 * resolution logic (and its dev default) has a single source of truth.
 */
export function credentialsEncryptionKeyFromEnv(): string {
  return process.env.CREDENTIALS_ENCRYPTION_KEY ?? DEV_DEFAULT_KEY;
}
