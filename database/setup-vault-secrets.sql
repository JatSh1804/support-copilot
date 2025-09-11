-- ================================================
-- SUPABASE VAULT SETUP FOR SECRETS
-- ================================================
-- Run these commands in your Supabase SQL editor to store secrets securely

-- 1. Store Supabase URL (replace with your actual project URL)
INSERT INTO vault.secrets (name, secret)
VALUES ('supabase_url', 'https://your-project-ref.supabase.co')
ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- 2. Store Service Role Key (replace with your actual service role key)  
INSERT INTO vault.secrets (name, secret)
VALUES ('service_role_key', 'your-service-role-key-here')
ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- 3. Store OpenAI API Key (for edge functions)
INSERT INTO vault.secrets (name, secret)
VALUES ('openai_api_key', 'your-openai-api-key-here')
ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- ================================================
-- VERIFY SECRETS ARE STORED
-- ================================================
-- Check that secrets are properly stored (this won't show the actual values)
SELECT name, created_at FROM vault.secrets WHERE name IN ('supabase_url', 'service_role_key', 'openai_api_key');

-- ================================================
-- TEST SECRET ACCESS (for verification only)
-- ================================================
-- Test that secrets can be decrypted (run this to verify setup)
-- SELECT vault.decrypt_secret('supabase_url'); -- Should return your URL
-- SELECT LEFT(vault.decrypt_secret('service_role_key'), 10) || '...'; -- Should show first 10 chars

-- ================================================
-- NOTES
-- ================================================
-- The vault.secrets table is automatically created by Supabase
-- Secrets are encrypted at rest and can only be decrypted within the database
-- This is much more secure than storing secrets in regular tables