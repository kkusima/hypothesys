-- ============================================================
-- HypotheSys migration — 2026-07-15
-- Run ONCE against the live database (Supabase SQL editor).
-- Fully idempotent and safe to re-run. Wrapped in a transaction so a failed
-- probe rolls everything back — run the verification queries at the bottom
-- before COMMIT if you want to check by hand.
--
-- Contents:
--   1. SECURITY: close the project_members self-join / role-escalation hole.
--   2. New feature columns: tasks.links, tasks/subtasks.reminder_recurrence.
-- The full supabase-schema.sql already contains all of this; this file exists
-- for databases that were provisioned before these changes.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1a. Secure INSERT: owner may add anyone; a non-owner may insert ONLY their
--     own row and ONLY with a matching pending, unexpired, same-email,
--     same-role invitation.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert membership or invite themselves" ON public.project_members;
DROP POLICY IF EXISTS "Members added by owner or via valid invitation" ON public.project_members;
CREATE POLICY "Members added by owner or via valid invitation"
  ON public.project_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
    )
    OR (
      project_members.user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.project_invitations pi
        WHERE pi.project_id = project_members.project_id
          AND pi.status = 'pending'
          AND pi.expires_at > now()
          AND lower(pi.email) = lower(coalesce(auth.email(), ''))
          AND pi.role = project_members.role
      )
    )
  );

-- ------------------------------------------------------------
-- 1b. Keep the UPDATE policy (own-row or owner) and add a trigger that blocks
--     a non-owner from changing role / user_id / project_id (priority_rank
--     self-updates keep working).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own membership or owners can manage members" ON public.project_members;
CREATE POLICY "Users can update own membership or owners can manage members"
  ON public.project_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.enforce_member_update_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.owner_id = auth.uid()
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN NEW;
  END IF;

  IF NEW.role       IS DISTINCT FROM OLD.role
     OR NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'Not authorized to change role, user_id, or project_id on a membership row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_member_update ON public.project_members;
CREATE TRIGGER enforce_member_update
  BEFORE UPDATE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_update_rules();

REVOKE EXECUTE ON FUNCTION public.enforce_member_update_rules() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1c. DELETE policy (own-row leave OR owner) is already correct — re-assert.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own membership or owners can manage members" ON public.project_members;
CREATE POLICY "Users can delete own membership or owners can manage members"
  ON public.project_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 2. Feature columns (idempotent).
-- ------------------------------------------------------------
ALTER TABLE public.tasks    ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.tasks    ADD COLUMN IF NOT EXISTS reminder_recurrence TEXT;
ALTER TABLE public.subtasks ADD COLUMN IF NOT EXISTS reminder_recurrence TEXT;

-- ------------------------------------------------------------
-- Optional verification (run as two distinct auth users on a scratch project):
--   -- attacker self-insert as editor with no/again-wrong invitation -> must FAIL
--   -- invited viewer self-insert at role 'viewer' -> must SUCCEED
--   -- invited viewer UPDATE ... SET role='editor' -> must FAIL (trigger)
--   -- invited viewer UPDATE ... SET priority_rank=3 -> must SUCCEED
--   -- owner add / role change / remove -> must SUCCEED
-- ------------------------------------------------------------
COMMIT;
