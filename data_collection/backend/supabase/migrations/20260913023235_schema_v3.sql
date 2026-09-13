-- =============================================================================
-- Schema v3 - climbing labeling platform
--
-- Per-user scoping, holds with normalized bounding boxes, slot-based
-- environments, and R2 object keys in place of local filesystem paths.
--
-- !! DESTRUCTIVE !!
-- This migration DROPS the labeling tables before recreating them. It assumes a
-- Supabase project dedicated to this application. Do NOT run it against a
-- project shared with other apps - confirm the linked project ref first with
--   supabase projects list
-- There is no data-preservation step: the brief specified a fresh schema.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop old labeling tables (children first)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.frame_tags CASCADE;
DROP TABLE IF EXISTS public.outcomes CASCADE;
DROP TABLE IF EXISTS public.environments CASCADE;
DROP TABLE IF EXISTS public.moves CASCADE;
DROP TABLE IF EXISTS public.holds CASCADE;
DROP TABLE IF EXISTS public.videos CASCADE;
DROP TABLE IF EXISTS public.schema_version CASCADE;

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------
CREATE TABLE public.videos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid        NOT NULL,
    filename        text        NOT NULL,
    fps             real        NOT NULL,
    total_frames    integer     NOT NULL,
    duration_ms     real        NOT NULL,
    -- Null until the browser finishes its direct-to-R2 upload and calls
    -- /api/videos/{id}/confirm-upload.
    r2_video_key    text,
    r2_pose_csv_key text,
    -- Null until an export has been produced.
    r2_export_key   text,
    uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_videos_user ON public.videos (user_id, uploaded_at DESC);

-- ---------------------------------------------------------------------------
-- holds
-- ---------------------------------------------------------------------------
CREATE TABLE public.holds (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    video_id   bigint      NOT NULL REFERENCES public.videos (id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL,
    -- Normalized to the frame: fractions of width/height, 0-1.
    bbox_x     real        NOT NULL CHECK (bbox_x >= 0 AND bbox_x <= 1),
    bbox_y     real        NOT NULL CHECK (bbox_y >= 0 AND bbox_y <= 1),
    bbox_w     real        NOT NULL CHECK (bbox_w >= 0 AND bbox_w <= 1),
    bbox_h     real        NOT NULL CHECK (bbox_h >= 0 AND bbox_h <= 1),
    source     text        NOT NULL CHECK (source IN ('detected', 'manual')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_holds_video ON public.holds (video_id);
CREATE INDEX idx_holds_user ON public.holds (user_id);

-- ---------------------------------------------------------------------------
-- moves (Lens 2: Strategy)
-- ---------------------------------------------------------------------------
CREATE TABLE public.moves (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    video_id           bigint      NOT NULL REFERENCES public.videos (id) ON DELETE CASCADE,
    user_id            uuid        NOT NULL,
    frame_start        integer     NOT NULL,
    frame_end          integer     NOT NULL,
    timestamp_start_ms real        NOT NULL,
    timestamp_end_ms   real        NOT NULL,
    approach           text        NOT NULL,
    move_tags          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    size               text        NOT NULL,
    form_quality       integer     NOT NULL CHECK (form_quality BETWEEN 1 AND 5),
    effort_level       integer     NOT NULL CHECK (effort_level BETWEEN 0 AND 10),
    confidence         text,
    description        text        NOT NULL DEFAULT '',
    labeled_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_moves_video ON public.moves (video_id);
CREATE INDEX idx_moves_user ON public.moves (user_id);

-- ---------------------------------------------------------------------------
-- environments (Lens 1: Environment)
--
-- Four optional hold slots: start_left, start_right, end, foot. Each carries a
-- nullable reference into holds plus its own type and quality list, so
-- no-hands, one-hand and no-feet moves all express cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE public.environments (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    move_id                  bigint NOT NULL UNIQUE REFERENCES public.moves (id) ON DELETE CASCADE,
    user_id                  uuid   NOT NULL,
    wall_angle               text   NOT NULL,

    start_left_hold_id       bigint REFERENCES public.holds (id) ON DELETE SET NULL,
    start_left_hold_type     text,
    start_left_hold_quality  jsonb  NOT NULL DEFAULT '[]'::jsonb,

    start_right_hold_id      bigint REFERENCES public.holds (id) ON DELETE SET NULL,
    start_right_hold_type    text,
    start_right_hold_quality jsonb  NOT NULL DEFAULT '[]'::jsonb,

    end_hold_id              bigint REFERENCES public.holds (id) ON DELETE SET NULL,
    end_hold_type            text,
    end_hold_quality         jsonb  NOT NULL DEFAULT '[]'::jsonb,

    -- Foot slot is optional by design.
    foot_hold_id             bigint REFERENCES public.holds (id) ON DELETE SET NULL,
    foot_hold_type           text,
    foot_hold_quality        jsonb  NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX idx_environments_move ON public.environments (move_id);
CREATE INDEX idx_environments_user ON public.environments (user_id);

-- ---------------------------------------------------------------------------
-- outcomes (Lens 3: Outcome)
-- ---------------------------------------------------------------------------
CREATE TABLE public.outcomes (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    move_id      bigint NOT NULL UNIQUE REFERENCES public.moves (id) ON DELETE CASCADE,
    user_id      uuid   NOT NULL,
    result       text   NOT NULL,
    reach_detail text   NOT NULL,
    confidence   text
);

CREATE INDEX idx_outcomes_move ON public.outcomes (move_id);
CREATE INDEX idx_outcomes_user ON public.outcomes (user_id);

-- ---------------------------------------------------------------------------
-- frame_tags (Sensation)
-- ---------------------------------------------------------------------------
CREATE TABLE public.frame_tags (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    move_id      bigint      NOT NULL REFERENCES public.moves (id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL,
    frame_number integer     NOT NULL,
    timestamp_ms real        NOT NULL,
    tag_type     text        NOT NULL,
    side         text        CHECK (side IS NULL OR side IN ('left', 'right')),
    level        integer     CHECK (level IS NULL OR level BETWEEN 0 AND 10),
    locations    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    note         text        NOT NULL DEFAULT '',
    tagged_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_frame_tags_move ON public.frame_tags (move_id);
CREATE INDEX idx_frame_tags_user ON public.frame_tags (user_id);

-- ---------------------------------------------------------------------------
-- schema_version
-- ---------------------------------------------------------------------------
CREATE TABLE public.schema_version (
    version    integer     NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_version (version) VALUES (3);

-- =============================================================================
-- Row Level Security
--
-- The API connects over the Postgres role in DATABASE_URL, which bypasses RLS;
-- these policies are what protect the tables from direct PostgREST / anon-key
-- access using a user's own JWT. Per-user isolation in the API itself is
-- enforced separately by the user_id filter on every query.
-- =============================================================================

ALTER TABLE public.videos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moves          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.environments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frame_tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_version ENABLE ROW LEVEL SECURITY;

-- videos
CREATE POLICY videos_select ON public.videos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY videos_insert ON public.videos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY videos_update ON public.videos FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY videos_delete ON public.videos FOR DELETE USING (auth.uid() = user_id);

-- holds
CREATE POLICY holds_select ON public.holds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY holds_insert ON public.holds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY holds_update ON public.holds FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY holds_delete ON public.holds FOR DELETE USING (auth.uid() = user_id);

-- moves
CREATE POLICY moves_select ON public.moves FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY moves_insert ON public.moves FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY moves_update ON public.moves FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY moves_delete ON public.moves FOR DELETE USING (auth.uid() = user_id);

-- environments
CREATE POLICY environments_select ON public.environments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY environments_insert ON public.environments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY environments_update ON public.environments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY environments_delete ON public.environments FOR DELETE USING (auth.uid() = user_id);

-- outcomes
CREATE POLICY outcomes_select ON public.outcomes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY outcomes_insert ON public.outcomes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY outcomes_update ON public.outcomes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY outcomes_delete ON public.outcomes FOR DELETE USING (auth.uid() = user_id);

-- frame_tags
CREATE POLICY frame_tags_select ON public.frame_tags FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY frame_tags_insert ON public.frame_tags FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY frame_tags_update ON public.frame_tags FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY frame_tags_delete ON public.frame_tags FOR DELETE USING (auth.uid() = user_id);

-- schema_version: readable by any signed-in user, writable only by the
-- migration role (no policy grants write).
CREATE POLICY schema_version_select ON public.schema_version FOR SELECT USING (auth.role() = 'authenticated');
