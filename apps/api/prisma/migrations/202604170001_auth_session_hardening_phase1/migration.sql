-- Security / Compliance / Access Governance Hardening - Phase 1
-- Auth + Session Hardening

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthActorType') THEN
    CREATE TYPE "AuthActorType" AS ENUM ('PUBLIC', 'ADMIN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthSessionStatus') THEN
    CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'LOCKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RefreshTokenEventType') THEN
    CREATE TYPE "RefreshTokenEventType" AS ENUM ('ISSUED', 'ROTATED', 'REVOKED', 'REUSE_DETECTED', 'FAMILY_REVOKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LoginAttemptResult') THEN
    CREATE TYPE "LoginAttemptResult" AS ENUM ('SUCCESS', 'FAILURE', 'LOCKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthRiskSeverity') THEN
    CREATE TYPE "AuthRiskSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthRiskType') THEN
    CREATE TYPE "AuthRiskType" AS ENUM (
      'BRUTE_FORCE',
      'TOKEN_REUSE',
      'ADMIN_IP_BLOCKED',
      'STEP_UP_FAILURE',
      'STEP_UP_SUCCESS',
      'GLOBAL_LOGOUT',
      'SESSION_REVOKED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminStepUpStatus') THEN
    CREATE TYPE "AdminStepUpStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  actor_type "AuthActorType" NOT NULL DEFAULT 'PUBLIC',
  status "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  session_key text NOT NULL UNIQUE,
  ip text,
  user_agent text,
  device_fingerprint text,
  environment text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_status_last_seen_idx
  ON auth_sessions (user_id, status, last_seen_at);

CREATE TABLE IF NOT EXISTS refresh_token_families (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  session_id text REFERENCES auth_sessions(id) ON DELETE SET NULL,
  actor_type "AuthActorType" NOT NULL DEFAULT 'PUBLIC',
  status "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  revoked_at timestamptz,
  revoked_reason text,
  last_rotated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_token_families_user_status_created_idx
  ON refresh_token_families (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS refresh_token_families_session_idx
  ON refresh_token_families (session_id);

CREATE TABLE IF NOT EXISTS refresh_token_events (
  id text PRIMARY KEY,
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  family_id text REFERENCES refresh_token_families(id) ON DELETE SET NULL,
  token_id text REFERENCES "RefreshToken"(id) ON DELETE SET NULL,
  event_type "RefreshTokenEventType" NOT NULL,
  reason text,
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_token_events_family_created_idx
  ON refresh_token_events (family_id, created_at);

CREATE INDEX IF NOT EXISTS refresh_token_events_user_created_idx
  ON refresh_token_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id text PRIMARY KEY,
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  actor_type "AuthActorType" NOT NULL DEFAULT 'PUBLIC',
  email text,
  ip text,
  user_agent text,
  result "LoginAttemptResult" NOT NULL,
  reason text,
  risk_score integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_email_ip_created_idx
  ON login_attempts (email, ip, created_at);

CREATE INDEX IF NOT EXISTS login_attempts_actor_result_created_idx
  ON login_attempts (actor_type, result, created_at);

CREATE TABLE IF NOT EXISTS auth_risk_events (
  id text PRIMARY KEY,
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  session_id text REFERENCES auth_sessions(id) ON DELETE SET NULL,
  family_id text REFERENCES refresh_token_families(id) ON DELETE SET NULL,
  actor_type "AuthActorType" NOT NULL DEFAULT 'PUBLIC',
  risk_type "AuthRiskType" NOT NULL,
  severity "AuthRiskSeverity" NOT NULL DEFAULT 'WARNING',
  reason text,
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_risk_events_type_severity_created_idx
  ON auth_risk_events (risk_type, severity, created_at);

CREATE INDEX IF NOT EXISTS auth_risk_events_actor_created_idx
  ON auth_risk_events (actor_type, created_at);

CREATE INDEX IF NOT EXISTS auth_risk_events_user_created_idx
  ON auth_risk_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_access_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE REFERENCES auth_sessions(id) ON DELETE CASCADE,
  status "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  step_up_required boolean NOT NULL DEFAULT false,
  step_up_verified_at timestamptz,
  ip text,
  user_agent text,
  allowed_ip boolean,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_access_sessions_user_status_created_idx
  ON admin_access_sessions (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS admin_step_up_challenges (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  session_id text REFERENCES auth_sessions(id) ON DELETE SET NULL,
  status "AdminStepUpStatus" NOT NULL DEFAULT 'PENDING',
  challenge_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  ip text,
  user_agent text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_step_up_challenges_user_status_created_idx
  ON admin_step_up_challenges (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS admin_step_up_challenges_session_status_created_idx
  ON admin_step_up_challenges (session_id, status, created_at);

ALTER TABLE "RefreshToken"
  ADD COLUMN IF NOT EXISTS "tokenJti" text,
  ADD COLUMN IF NOT EXISTS "familyId" text,
  ADD COLUMN IF NOT EXISTS "sessionId" text,
  ADD COLUMN IF NOT EXISTS "actorType" "AuthActorType" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN IF NOT EXISTS "usedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "revokedReason" text,
  ADD COLUMN IF NOT EXISTS "replacedByTokenId" text,
  ADD COLUMN IF NOT EXISTS "deviceFingerprint" text,
  ADD COLUMN IF NOT EXISTS "ipAddress" text,
  ADD COLUMN IF NOT EXISTS "userAgent" text;

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenJti_key"
  ON "RefreshToken" ("tokenJti")
  WHERE "tokenJti" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "RefreshToken_userId_revokedAt_idx"
  ON "RefreshToken" ("userId", "revokedAt");

CREATE INDEX IF NOT EXISTS "RefreshToken_familyId_idx"
  ON "RefreshToken" ("familyId");

CREATE INDEX IF NOT EXISTS "RefreshToken_sessionId_idx"
  ON "RefreshToken" ("sessionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'RefreshToken' AND constraint_name = 'RefreshToken_familyId_fkey'
  ) THEN
    ALTER TABLE "RefreshToken"
      ADD CONSTRAINT "RefreshToken_familyId_fkey"
      FOREIGN KEY ("familyId") REFERENCES refresh_token_families(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'RefreshToken' AND constraint_name = 'RefreshToken_sessionId_fkey'
  ) THEN
    ALTER TABLE "RefreshToken"
      ADD CONSTRAINT "RefreshToken_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES auth_sessions(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'RefreshToken' AND constraint_name = 'RefreshToken_replacedByTokenId_fkey'
  ) THEN
    ALTER TABLE "RefreshToken"
      ADD CONSTRAINT "RefreshToken_replacedByTokenId_fkey"
      FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
