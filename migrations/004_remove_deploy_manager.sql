DELETE FROM api_keys
WHERE role = 'deploy-manager';

ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_role_check;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_role_check
  CHECK (role IN ('analyst', 'implementer', 'admin'));
