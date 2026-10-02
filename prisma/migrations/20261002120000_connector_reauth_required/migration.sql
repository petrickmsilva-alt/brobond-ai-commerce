-- AlterEnum (PR016.2): a stored credential that no longer decrypts — the
-- ciphertext was written before a CONNECTOR_ENCRYPTION_KEY rotation — parks
-- the channel in REAUTH_REQUIRED instead of ERROR/EXPIRED. The distinction
-- is what the panel needs: REAUTH_REQUIRED renders the clean connect button
-- (reconnecting re-encrypts with the current key), never a retry that can
-- only fail the same way.
ALTER TYPE "ConnectionStatus" ADD VALUE 'REAUTH_REQUIRED';
