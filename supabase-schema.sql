-- HypotheSys™ Database Schema for Supabase
-- FULLY IDEMPOTENT: safe to copy-paste and run any number of times.
-- Every policy is dropped-then-created, every function uses CREATE OR REPLACE,
-- and every trigger is dropped before being recreated. Running this on a fresh
-- or an existing database brings it to the correct, working state without errors.

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- pgcrypto provides gen_random_bytes(), used for project_invitations.token below.
-- On Supabase it is normally pre-enabled; declared here so a fresh DB never fails.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  email_notifications BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  emoji TEXT DEFAULT '🚀',
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  priority_rank INTEGER DEFAULT 999,
  current_stage_index INTEGER DEFAULT 0,
  modified_by UUID REFERENCES public.users(id),
  archived BOOLEAN DEFAULT FALSE
);

-- Project Members table (for sharing)
CREATE TABLE IF NOT EXISTS public.project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'editor', -- 'editor', 'viewer'
  priority_rank INTEGER DEFAULT 999, -- Personal priority for this user
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Stages table
CREATE TABLE IF NOT EXISTS public.stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage_id UUID NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  links JSONB DEFAULT '[]'::jsonb,
  order_index INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  reminder_date TIMESTAMPTZ,
  reminder_recurrence TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  modified_by UUID REFERENCES public.users(id)
);

-- Subtasks table
CREATE TABLE IF NOT EXISTS public.subtasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  reminder_date TIMESTAMPTZ,
  reminder_recurrence TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  modified_by UUID REFERENCES public.users(id)
);

-- Comments table
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  subtask_id UUID REFERENCES public.subtasks(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  reminder_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags table
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Task Tags table (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.task_tags (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (task_id, tag_id)
);

-- Subtask Tags table (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.subtask_tags (
  subtask_id UUID NOT NULL REFERENCES public.subtasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (subtask_id, tag_id)
);

-- Today items table
CREATE TABLE IF NOT EXISTS public.today_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, day)
);

-- Project invitations
CREATE TABLE IF NOT EXISTS public.project_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  UNIQUE(project_id, email)
);

-- Notification Settings table (granular per-channel preferences)
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,

  -- Reminders & Due Dates
  reminder_upcoming_inapp BOOLEAN DEFAULT TRUE,
  reminder_upcoming_email BOOLEAN DEFAULT FALSE,
  reminder_upcoming_push BOOLEAN DEFAULT TRUE,
  reminder_overdue_inapp BOOLEAN DEFAULT TRUE,
  reminder_overdue_email BOOLEAN DEFAULT FALSE,
  reminder_overdue_push BOOLEAN DEFAULT TRUE,

  -- Task Activity
  task_created_inapp BOOLEAN DEFAULT TRUE,
  task_created_email BOOLEAN DEFAULT FALSE,
  task_created_push BOOLEAN DEFAULT FALSE,
  task_updated_inapp BOOLEAN DEFAULT FALSE,
  task_updated_email BOOLEAN DEFAULT FALSE,
  task_updated_push BOOLEAN DEFAULT FALSE,
  task_deleted_inapp BOOLEAN DEFAULT TRUE,
  task_deleted_email BOOLEAN DEFAULT FALSE,
  task_deleted_push BOOLEAN DEFAULT FALSE,
  subtask_activity_inapp BOOLEAN DEFAULT FALSE,
  subtask_activity_email BOOLEAN DEFAULT FALSE,
  subtask_activity_push BOOLEAN DEFAULT FALSE,

  -- Collaboration
  project_shared_inapp BOOLEAN DEFAULT TRUE,
  project_shared_email BOOLEAN DEFAULT FALSE,
  project_shared_push BOOLEAN DEFAULT TRUE,
  project_removed_inapp BOOLEAN DEFAULT TRUE,
  project_removed_email BOOLEAN DEFAULT FALSE,
  project_removed_push BOOLEAN DEFAULT TRUE,
  comment_added_inapp BOOLEAN DEFAULT TRUE,
  comment_added_email BOOLEAN DEFAULT FALSE,
  comment_added_push BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SAFE MIGRATIONS (for databases created with older versions)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comments' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.comments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_notifications'
  ) THEN
    ALTER TABLE public.users ADD COLUMN email_notifications BOOLEAN DEFAULT TRUE;
  END IF;

  -- Prevent duplicate notifications for the same user/entity/type combination.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_unique_per_entity'
  ) THEN
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_unique_per_entity UNIQUE (user_id, type, task_id, subtask_id)';
  END IF;

  -- Task reference links (array of {url,label}).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'links'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN links JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Recurring reminders (none|daily|weekly|monthly) on tasks and subtasks.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'reminder_recurrence'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN reminder_recurrence TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subtasks' AND column_name = 'reminder_recurrence'
  ) THEN
    ALTER TABLE public.subtasks ADD COLUMN reminder_recurrence TEXT;
  END IF;
END;
$$;

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_stages_project ON public.stages(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON public.tasks(stage_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON public.subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON public.comments(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_today_items_user_day ON public.today_items(user_id, day);
CREATE INDEX IF NOT EXISTS idx_tags_user ON public.tags(user_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON public.task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON public.task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_subtask_tags_subtask ON public.subtask_tags(subtask_id);
CREATE INDEX IF NOT EXISTS idx_notification_settings_user ON public.notification_settings(user_id);

-- ============================================================
-- HELPER FUNCTIONS (used by RLS policies)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(project_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_uuid AND p.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = project_uuid
      AND pm.user_id = auth.uid()
      AND pm.role = 'editor'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_user(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = target_user_id
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.owner_id = target_user_id
        AND public.is_project_member(p.id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.user_id = target_user_id
        AND public.is_project_member(pm.project_id)
    );
$$;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.today_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtask_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CLEAN UP LEGACY POLICY NAMES (from older schema versions)
-- ============================================================
DROP POLICY IF EXISTS "Users can view owned projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view shared projects" ON public.projects;
DROP POLICY IF EXISTS "Owners can insert project members" ON public.project_members;
DROP POLICY IF EXISTS "Owners can update project members" ON public.project_members;
DROP POLICY IF EXISTS "Owners can delete project members" ON public.project_members;
DROP POLICY IF EXISTS "Users can manage stages" ON public.stages;
DROP POLICY IF EXISTS "Users can manage tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can manage subtasks" ON public.subtasks;
DROP POLICY IF EXISTS "Users can manage comments" ON public.comments;
DROP POLICY IF EXISTS "Users can manage own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can manage task tags" ON public.task_tags;
DROP POLICY IF EXISTS "Users can manage subtask tags" ON public.subtask_tags;

-- ============================================================
-- RLS POLICIES (each one drops-then-creates → fully re-runnable)
-- ============================================================

-- ---- users ----
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (public.can_view_user(id));

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (id = auth.uid());

-- ---- projects ----
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;
CREATE POLICY "Users can view accessible projects"
  ON public.projects FOR SELECT
  USING (public.is_project_member(id));

DROP POLICY IF EXISTS "Owners can insert projects" ON public.projects;
CREATE POLICY "Owners can insert projects"
  ON public.projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can update projects" ON public.projects;
CREATE POLICY "Owners can update projects"
  ON public.projects FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can delete projects" ON public.projects;
CREATE POLICY "Owners can delete projects"
  ON public.projects FOR DELETE
  USING (owner_id = auth.uid());

-- ---- project_members ----
DROP POLICY IF EXISTS "Users can view own membership" ON public.project_members;
CREATE POLICY "Users can view own membership"
  ON public.project_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

-- SECURITY: a non-owner may add ONLY themselves and ONLY when a matching
-- invitation exists (pending, unexpired, same email, same role). Previously any
-- signed-in user who knew a project UUID could self-insert as 'editor'.
-- NOTE: the correlated columns MUST be table-qualified (project_members.*)
-- because project_invitations also has project_id and role columns.
DROP POLICY IF EXISTS "Users can insert membership or invite themselves" ON public.project_members;
DROP POLICY IF EXISTS "Members added by owner or via valid invitation" ON public.project_members;
CREATE POLICY "Members added by owner or via valid invitation"
  ON public.project_members FOR INSERT
  WITH CHECK (
    -- (1) Project owner may add ANY member at ANY role.
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
    )
    OR
    -- (2) A non-owner may insert ONLY their own row, ONLY when a matching
    --     invitation is pending, not expired, addressed to their email
    --     (case-insensitive), and at the SAME role (no self-granting editor).
    (
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

DROP POLICY IF EXISTS "Users can update own membership or owners can manage members" ON public.project_members;
CREATE POLICY "Users can update own membership or owners can manage members"
  ON public.project_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own membership or owners can manage members" ON public.project_members;
CREATE POLICY "Users can delete own membership or owners can manage members"
  ON public.project_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

-- SECURITY: RLS can't compare OLD vs NEW, so the UPDATE policy above lets a
-- member target their own row (needed for personal priority_rank) but can't stop
-- them flipping role viewer->editor. This BEFORE UPDATE trigger forbids a
-- non-owner from changing role / user_id / project_id, while leaving
-- priority_rank self-updates working. Owners may change anything.
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

-- Defense in depth (the end-of-file REVOKE loop also covers this); triggers
-- fire regardless of EXECUTE grants, so no GRANT is needed.
REVOKE EXECUTE ON FUNCTION public.enforce_member_update_rules() FROM PUBLIC, anon, authenticated;

-- ---- project_invitations ----
DROP POLICY IF EXISTS "Owners and invitees can view invitations" ON public.project_invitations;
CREATE POLICY "Owners and invitees can view invitations"
  ON public.project_invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
    OR lower(email) = lower(coalesce(auth.email(), ''))
  );

DROP POLICY IF EXISTS "Owners can insert invitations" ON public.project_invitations;
CREATE POLICY "Owners can insert invitations"
  ON public.project_invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update invitations" ON public.project_invitations;
CREATE POLICY "Owners can update invitations"
  ON public.project_invitations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete invitations" ON public.project_invitations;
CREATE POLICY "Owners can delete invitations"
  ON public.project_invitations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.owner_id = auth.uid()
    )
  );

-- ---- stages ----
DROP POLICY IF EXISTS "Users can view stages in accessible projects" ON public.stages;
CREATE POLICY "Users can view stages in accessible projects"
  ON public.stages FOR SELECT
  USING (public.is_project_member(project_id));

DROP POLICY IF EXISTS "Editors can manage stages" ON public.stages;
CREATE POLICY "Editors can manage stages"
  ON public.stages FOR INSERT
  WITH CHECK (public.can_edit_project(project_id));

DROP POLICY IF EXISTS "Editors can update stages" ON public.stages;
CREATE POLICY "Editors can update stages"
  ON public.stages FOR UPDATE
  USING (public.can_edit_project(project_id))
  WITH CHECK (public.can_edit_project(project_id));

DROP POLICY IF EXISTS "Editors can delete stages" ON public.stages;
CREATE POLICY "Editors can delete stages"
  ON public.stages FOR DELETE
  USING (public.can_edit_project(project_id));

-- ---- tasks ----
DROP POLICY IF EXISTS "Users can view tasks in accessible projects" ON public.tasks;
CREATE POLICY "Users can view tasks in accessible projects"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stages s
      WHERE s.id = stage_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can insert tasks" ON public.tasks;
CREATE POLICY "Editors can insert tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stages s
      WHERE s.id = stage_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can update tasks" ON public.tasks;
CREATE POLICY "Editors can update tasks"
  ON public.tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stages s
      WHERE s.id = stage_id AND public.can_edit_project(s.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stages s
      WHERE s.id = stage_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can delete tasks" ON public.tasks;
CREATE POLICY "Editors can delete tasks"
  ON public.tasks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stages s
      WHERE s.id = stage_id AND public.can_edit_project(s.project_id)
    )
  );

-- ---- subtasks ----
DROP POLICY IF EXISTS "Users can view subtasks in accessible projects" ON public.subtasks;
CREATE POLICY "Users can view subtasks in accessible projects"
  ON public.subtasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can insert subtasks" ON public.subtasks;
CREATE POLICY "Editors can insert subtasks"
  ON public.subtasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can update subtasks" ON public.subtasks;
CREATE POLICY "Editors can update subtasks"
  ON public.subtasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can delete subtasks" ON public.subtasks;
CREATE POLICY "Editors can delete subtasks"
  ON public.subtasks FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

-- ---- comments ----
DROP POLICY IF EXISTS "Users can view comments in accessible projects" ON public.comments;
CREATE POLICY "Users can view comments in accessible projects"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Members can add comments" ON public.comments;
CREATE POLICY "Members can add comments"
  ON public.comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Comment authors or editors can update comments" ON public.comments;
CREATE POLICY "Comment authors or editors can update comments"
  ON public.comments FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Comment authors or editors can delete comments" ON public.comments;
CREATE POLICY "Comment authors or editors can delete comments"
  ON public.comments FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

-- ---- tags ----
DROP POLICY IF EXISTS "Users can view own tags" ON public.tags;
CREATE POLICY "Users can view own tags"
  ON public.tags FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage own tags" ON public.tags;
CREATE POLICY "Users can manage own tags"
  ON public.tags FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own tags" ON public.tags;
CREATE POLICY "Users can update own tags"
  ON public.tags FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own tags" ON public.tags;
CREATE POLICY "Users can delete own tags"
  ON public.tags FOR DELETE
  USING (user_id = auth.uid());

-- ---- task_tags ----
DROP POLICY IF EXISTS "Users can view task tags in accessible projects" ON public.task_tags;
CREATE POLICY "Users can view task tags in accessible projects"
  ON public.task_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can manage task tags" ON public.task_tags;
CREATE POLICY "Editors can manage task tags"
  ON public.task_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can delete task tags" ON public.task_tags;
CREATE POLICY "Editors can delete task tags"
  ON public.task_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.stages s ON s.id = t.stage_id
      WHERE t.id = task_id AND public.can_edit_project(s.project_id)
    )
  );

-- ---- subtask_tags ----
DROP POLICY IF EXISTS "Users can view subtask tags in accessible projects" ON public.subtask_tags;
CREATE POLICY "Users can view subtask tags in accessible projects"
  ON public.subtask_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.subtasks st
      JOIN public.tasks t ON t.id = st.task_id
      JOIN public.stages s ON s.id = t.stage_id
      WHERE st.id = subtask_id AND public.is_project_member(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can manage subtask tags" ON public.subtask_tags;
CREATE POLICY "Editors can manage subtask tags"
  ON public.subtask_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.subtasks st
      JOIN public.tasks t ON t.id = st.task_id
      JOIN public.stages s ON s.id = t.stage_id
      WHERE st.id = subtask_id AND public.can_edit_project(s.project_id)
    )
  );

DROP POLICY IF EXISTS "Editors can delete subtask tags" ON public.subtask_tags;
CREATE POLICY "Editors can delete subtask tags"
  ON public.subtask_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.subtasks st
      JOIN public.tasks t ON t.id = st.task_id
      JOIN public.stages s ON s.id = t.stage_id
      WHERE st.id = subtask_id AND public.can_edit_project(s.project_id)
    )
  );

-- ---- notifications ----
DROP POLICY IF EXISTS "Users can view notifications for themselves" ON public.notifications;
CREATE POLICY "Users can view notifications for themselves"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert personal notifications or project members can notify collaborators" ON public.notifications;
CREATE POLICY "Users can insert personal notifications or project members can notify collaborators"
  ON public.notifications FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = project_id AND public.is_project_member(p.id)
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = project_id AND p.owner_id = user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = project_id AND pm.user_id = user_id
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can update their notifications" ON public.notifications;
CREATE POLICY "Users can update their notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their notifications" ON public.notifications;
CREATE POLICY "Users can delete their notifications"
  ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- ---- today_items ----
DROP POLICY IF EXISTS "Users can view their today items" ON public.today_items;
CREATE POLICY "Users can view their today items"
  ON public.today_items FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their today items" ON public.today_items;
CREATE POLICY "Users can manage their today items"
  ON public.today_items FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their today items" ON public.today_items;
CREATE POLICY "Users can update their today items"
  ON public.today_items FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their today items" ON public.today_items;
CREATE POLICY "Users can delete their today items"
  ON public.today_items FOR DELETE
  USING (user_id = auth.uid());

-- ---- notification_settings ----
DROP POLICY IF EXISTS "Users can view their notification settings" ON public.notification_settings;
CREATE POLICY "Users can view their notification settings"
  ON public.notification_settings FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their notification settings" ON public.notification_settings;
CREATE POLICY "Users can manage their notification settings"
  ON public.notification_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their notification settings" ON public.notification_settings;
CREATE POLICY "Users can update their notification settings"
  ON public.notification_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their notification settings" ON public.notification_settings;
CREATE POLICY "Users can delete their notification settings"
  ON public.notification_settings FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- TRIGGERS & FUNCTIONS FOR AUTOMATIC TIMESTAMP UPDATES
--
-- Both functions wrap their propagating UPDATE in an exception guard so that
-- deleting a parent (e.g. a whole project) can NEVER fail because of a child's
-- AFTER DELETE trigger firing mid-cascade. If the parent is already gone, the
-- update is simply skipped.
-- ============================================================

-- When a Subtask or Comment changes, bump the parent Task.
CREATE OR REPLACE FUNCTION public.handle_task_child_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_task_id UUID;
  modifier_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'subtasks' THEN
    IF (TG_OP = 'DELETE') THEN
       target_task_id := OLD.task_id;
       modifier_id := OLD.modified_by;
    ELSE
       target_task_id := NEW.task_id;
       modifier_id := NEW.modified_by;
    END IF;
  ELSIF TG_TABLE_NAME = 'comments' THEN
    IF (TG_OP = 'DELETE') THEN
       target_task_id := OLD.task_id;
       modifier_id := OLD.user_id;
    ELSE
       target_task_id := NEW.task_id;
       modifier_id := NEW.user_id;
    END IF;
  END IF;

  IF target_task_id IS NOT NULL THEN
    BEGIN
      UPDATE public.tasks
      SET updated_at = NOW(),
          modified_by = modifier_id
      WHERE id = target_task_id;
    EXCEPTION WHEN OTHERS THEN
      -- Parent task may be mid-deletion during a cascade; ignore.
      NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- When a Task or Stage changes, bump the parent Project.
CREATE OR REPLACE FUNCTION public.handle_project_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_id_val UUID;
  user_id_val UUID := null;
BEGIN
  IF TG_TABLE_NAME = 'stages' THEN
    IF (TG_OP = 'DELETE') THEN
       project_id_val := OLD.project_id;
    ELSE
       project_id_val := NEW.project_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF (TG_OP = 'DELETE') THEN
       SELECT project_id INTO project_id_val FROM public.stages WHERE id = OLD.stage_id;
       user_id_val := OLD.modified_by;
    ELSE
       SELECT project_id INTO project_id_val FROM public.stages WHERE id = NEW.stage_id;
       user_id_val := NEW.modified_by;
    END IF;
  END IF;

  IF project_id_val IS NOT NULL THEN
    BEGIN
      UPDATE public.projects
      SET updated_at = NOW(),
          modified_by = COALESCE(user_id_val, modified_by)
      WHERE id = project_id_val;
    EXCEPTION WHEN OTHERS THEN
      -- Parent project may be mid-deletion during a cascade; ignore.
      NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate triggers (drop first so this is re-runnable)
DROP TRIGGER IF EXISTS on_task_change ON public.tasks;
DROP TRIGGER IF EXISTS on_subtask_change ON public.subtasks;
DROP TRIGGER IF EXISTS on_subtask_update_task ON public.subtasks;
DROP TRIGGER IF EXISTS on_comment_update_task ON public.comments;
DROP TRIGGER IF EXISTS on_stage_change ON public.stages;

-- 1. Tasks -> Projects
CREATE TRIGGER on_task_change
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE PROCEDURE public.handle_project_updated_at();

-- 1b. Stages -> Projects
CREATE TRIGGER on_stage_change
  AFTER INSERT OR UPDATE OR DELETE ON public.stages
  FOR EACH ROW EXECUTE PROCEDURE public.handle_project_updated_at();

-- 2. Subtasks -> Tasks
CREATE TRIGGER on_subtask_update_task
  AFTER INSERT OR UPDATE OR DELETE ON public.subtasks
  FOR EACH ROW EXECUTE PROCEDURE public.handle_task_child_change();

-- 3. Comments -> Tasks
CREATE TRIGGER on_comment_update_task
  AFTER INSERT OR UPDATE OR DELETE ON public.comments
  FOR EACH ROW EXECUTE PROCEDURE public.handle_task_child_change();

-- ============================================================
-- HARDEN SECURITY DEFINER FUNCTIONS (Security Advisor warnings)
--
-- By default Postgres grants EXECUTE on every function to PUBLIC, so any role
-- (incl. anon) can call our SECURITY DEFINER functions directly. Lock that down:
--   1) Revoke EXECUTE on ALL public SECURITY DEFINER functions from
--      PUBLIC / anon / authenticated.
--   2) Re-grant EXECUTE to `authenticated` ONLY for the RLS helper functions,
--      because RLS policies evaluate them as the querying (authenticated) role —
--      without this grant every query to the protected tables would fail with
--      "permission denied for function ...".
--
-- Trigger functions need NO grant: triggers fire regardless of the caller's
-- EXECUTE privilege. After running this, the only remaining advisor warnings
-- are "Signed-In Users Can Execute" for the 3 helpers below, which is by design
-- (each only ever acts on auth.uid(), so there is no privilege escalation).
-- ============================================================
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef          -- SECURITY DEFINER functions only
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;
END;
$$;

-- RLS helper functions must stay callable by signed-in users (policies use them).
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_user(uuid) TO authenticated;
