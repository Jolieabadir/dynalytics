-- ============================================================================
-- Add intrinsic video dimensions to videos
-- ============================================================================
--
-- Why: pose landmarks are stored in the pose CSV as PIXEL coordinates at the
-- video's source resolution, while hold bounding boxes are stored normalized to
-- 0-1 (see public.holds). Comparing the two requires the frame size, and until
-- now nothing recorded it — so a stored pose CSV could not be related to a
-- stored hold box after the fact.
--
-- The browser measures these at extraction time and now sends them with
-- register. Keeping them here means any later consumer (export, analysis, a
-- re-render) can convert between the two coordinate spaces without the original
-- video file.
--
-- Deliberately additive and nullable: rows written before this migration have
-- no dimensions and must stay valid. Readers must treat NULL as "unknown" and
-- skip normalization rather than assume a default.
--
-- Note this does NOT bump schema_version. database.check_schema() requires an
-- exact match against SCHEMA_VERSION, so bumping would refuse to start the API
-- against any database that has not yet had this file applied. The change is
-- purely additive and nullable, so a v3 reader is unaffected by it.

ALTER TABLE public.videos
    ADD COLUMN IF NOT EXISTS width  integer CHECK (width  IS NULL OR width  > 0),
    ADD COLUMN IF NOT EXISTS height integer CHECK (height IS NULL OR height > 0);

COMMENT ON COLUMN public.videos.width IS
    'Intrinsic video width in pixels (videoWidth). NULL for rows registered before this column existed.';
COMMENT ON COLUMN public.videos.height IS
    'Intrinsic video height in pixels (videoHeight). NULL for rows registered before this column existed.';

-- RLS is enabled on public.videos and its four policies are row-scoped by
-- user_id, not column-scoped, so new columns are covered by the existing
-- policies and need no further grants.
