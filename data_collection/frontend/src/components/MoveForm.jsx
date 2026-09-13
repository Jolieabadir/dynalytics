/**
 * MoveForm — the labeling panel.
 *
 * Two structural changes from the modal it replaces:
 *
 * 1. It is a right-side panel, not a full-screen overlay. The labeler can see
 *    the movement, the skeleton, and the scrub bar while deciding what to call
 *    it — which is exactly when they need to look at it.
 * 2. Environment is four named hold slots (start-left, start-right, end, foot)
 *    rather than "reaching" and "non-reaching" hands, matching schema v3.
 *
 * Every option carries an "i" with a plain-language definition from
 * /api/config. Nothing requires reading them.
 *
 * All taxonomy comes from /api/config — no hardcoded values.
 */
import { useState, useEffect } from 'react';
import useStore, { HOLD_SLOT_KEYS } from '../store/useStore';
import { fpsOf, frameToTime, frameToMs } from '../utils/frames';
import { optionLabel, optionDescription } from '../utils/taxonomy';
import { suggestHoldSlots } from '../services/holdAssignment';
import InfoTip from './InfoTip';
import { createMove, createEnvironment, createOutcome, deleteMove } from '../api/client';

// Form quality anchor text. Not taxonomy — these are scale anchors for a
// 1-5 rating, and the backend stores the number.
const FORM_QUALITY_LABELS = {
  1: 'Failed',
  2: 'Clear compensation',
  3: 'Acceptable',
  4: 'Efficient/repeatable',
  5: 'Excellent, repeatable under greater demand',
};

const EMPTY_SLOT = { hold_id: null, hold_type: '', hold_quality: [], suggested: false };

const SLOT_ORDER = HOLD_SLOT_KEYS;

/** Slots that must be filled for a normal move. `foot` is optional by design. */
const REQUIRED_SLOTS = ['start_left', 'start_right', 'end'];

function MoveForm() {
  const {
    currentVideo,
    moveStart,
    moveEnd,
    setShowMoveForm,
    clearMoveSelection,
    addMove,
    previousEnvironment,
    setPreviousEnvironment,
    config,
    holdPickSlot,
    setHoldPickSlot,
    holds,
    csvData,
  } = useStore();

  // Lens 1: Environment
  const [wallAngle, setWallAngle] = useState('');
  const [slots, setSlots] = useState(() =>
    Object.fromEntries(SLOT_ORDER.map((s) => [s, { ...EMPTY_SLOT }]))
  );

  // Lens 2: Strategy
  const [approach, setApproach] = useState('');
  const [size, setSize] = useState('');
  const [moveTags, setMoveTags] = useState([]);
  const [formQuality, setFormQuality] = useState(3);
  const [effortLevel, setEffortLevel] = useState(5);
  const [description, setDescription] = useState('');

  // Lens 3: Outcome
  const [result, setResult] = useState('');
  const [reachDetail, setReachDetail] = useState('');
  const [confidence, setConfidence] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset on open, prefilling environment from the previous move.
  useEffect(() => {
    setWallAngle(previousEnvironment.wall_angle || '');
    setSlots(
      Object.fromEntries(
        SLOT_ORDER.map((slot) => [
          slot,
          {
            ...EMPTY_SLOT,
            hold_type: previousEnvironment[slot]?.hold_type || '',
            hold_quality: previousEnvironment[slot]?.hold_quality || [],
          },
        ])
      )
    );
    setApproach('');
    setSize('');
    setMoveTags([]);
    setFormQuality(3);
    setEffortLevel(5);
    setDescription('');
    setResult('');
    setReachDetail('');
    setConfidence('');
    setError(null);
    // previousEnvironment is a stable object between saves; re-running on every
    // identity change would wipe edits mid-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Auto-suggest a hold for each slot from the pose data.
   *
   * At the start frame the hands are on their starting holds; at the end frame
   * the reaching hand is on the target. Suggestions are marked `suggested` and
   * stay that way until the labeler touches the slot — so a wrong guess is
   * visible rather than silently adopted.
   *
   * Runs once per open. A slot the labeler has already filled is left alone.
   */
  useEffect(() => {
    if (!holds?.length || !csvData?.length) return;
    if (moveStart === null || moveEnd === null) return;

    const frameSize = {
      width: currentVideo?.width || currentVideo?.video_width,
      height: currentVideo?.height || currentVideo?.video_height,
    };
    // Without the original resolution the CSV's pixel coordinates cannot be
    // normalized, and every suggestion would be nonsense. Better none.
    if (!frameSize.width || !frameSize.height) return;

    const rowAt = (frame) =>
      csvData.find((r) => Number(r.frame_number) === frame) ?? null;

    const suggestion = suggestHoldSlots({
      holds,
      startRow: rowAt(moveStart),
      endRow: rowAt(moveEnd),
      frameSize,
    });

    setSlots((prev) => {
      const next = { ...prev };
      for (const slot of SLOT_ORDER) {
        const id = suggestion[slot];
        if (id != null && next[slot].hold_id == null && !next[slot].suggested) {
          next[slot] = { ...next[slot], hold_id: id, suggested: true };
        }
      }
      return next;
    });
    // Once per open: the suggestion is a starting point, not a live binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A hold picked on the video lands in whichever slot asked for it.
  useEffect(() => {
    if (!holdPickSlot) return;
    const assignedId = holdPickSlot.assignedHoldId;
    if (assignedId == null) return;

    setSlots((prev) => ({
      ...prev,
      [holdPickSlot.slot]: {
        ...prev[holdPickSlot.slot],
        hold_id: assignedId,
        suggested: false,
      },
    }));
    setHoldPickSlot(null);
  }, [holdPickSlot, setHoldPickSlot]);

  const handleClose = () => {
    setHoldPickSlot(null);
    setShowMoveForm(false);
  };

  const updateSlot = (slot, patch) =>
    setSlots((prev) => ({
      ...prev,
      // Any manual edit means the labeler has looked at it: no longer merely suggested.
      [slot]: { ...prev[slot], ...patch, suggested: false },
    }));

  const toggleSlotQuality = (slot, quality) =>
    setSlots((prev) => {
      const current = prev[slot].hold_quality || [];
      return {
        ...prev,
        [slot]: {
          ...prev[slot],
          hold_quality: current.includes(quality)
            ? current.filter((q) => q !== quality)
            : [...current, quality],
          suggested: false,
        },
      };
    });

  const clearSlot = (slot) =>
    setSlots((prev) => ({ ...prev, [slot]: { ...EMPTY_SLOT } }));

  const toggleMoveTag = (tag) => {
    setMoveTags((prev) => {
      const isSelected = prev.includes(tag);
      if (isSelected) return prev.filter((t) => t !== tag);

      let newTags = [...prev, tag];
      // no_hands and no_feet_on are mutually exclusive.
      if (tag === 'no_hands') newTags = newTags.filter((t) => t !== 'no_feet_on');
      if (tag === 'no_feet_on') newTags = newTags.filter((t) => t !== 'no_hands');
      return newTags;
    });
  };

  const noHandsSelected = moveTags.includes('no_hands');

  const handleSubmit = async () => {
    if (!currentVideo || moveStart === null || moveEnd === null) {
      setError('Invalid move boundaries');
      return;
    }
    if (!wallAngle) {
      setError('Please select Wall Angle');
      return;
    }
    // Hands off the wall means no hand holds to name.
    if (!noHandsSelected) {
      const missing = REQUIRED_SLOTS.filter((s) => !slots[s].hold_type);
      if (missing.length) {
        setError(
          `Please choose a hold type for: ${missing
            .map((s) => optionLabel(config, 'hold_slots', s))
            .join(', ')}`
        );
        return;
      }
    }
    if (!approach || !size) {
      setError('Please select Approach and Size');
      return;
    }
    if (!result || !reachDetail || !confidence) {
      setError('Please complete all Outcome fields');
      return;
    }

    setLoading(true);
    setError(null);
    let createdMove = null;

    try {
      const fps = fpsOf(currentVideo);

      const moveData = {
        video_id: currentVideo.id,
        frame_start: moveStart,
        frame_end: moveEnd,
        timestamp_start_ms: frameToMs(moveStart, fps),
        timestamp_end_ms: frameToMs(moveEnd, fps),
        approach,
        size,
        move_tags: moveTags,
        form_quality: formQuality,
        effort_level: effortLevel,
        confidence,
        description,
      };
      createdMove = await createMove(moveData);

      // Four named slots. An empty slot is sent as {} — that is how no-hands,
      // one-hand and no-feet moves are expressed.
      const slotPayload = Object.fromEntries(
        SLOT_ORDER.map((slot) => {
          const s = slots[slot];
          const isHandSlot = slot !== 'foot';
          if (noHandsSelected && isHandSlot) return [slot, {}];
          if (!s.hold_type && s.hold_id == null) return [slot, {}];
          return [
            slot,
            {
              hold_id: s.hold_id ?? null,
              hold_type: s.hold_type || null,
              hold_quality: s.hold_quality || [],
            },
          ];
        })
      );

      const envData = { move_id: createdMove.id, wall_angle: wallAngle, ...slotPayload };
      await createEnvironment(envData);

      await createOutcome({
        move_id: createdMove.id,
        result,
        reach_detail: reachDetail,
        confidence,
      });

      setPreviousEnvironment(envData);
      addMove(createdMove);
      clearMoveSelection();
      setHoldPickSlot(null);
      setShowMoveForm(false);
    } catch (err) {
      console.error('Failed to create move:', err);
      // Roll back a move whose environment or outcome failed, so a half-labeled
      // move never enters the list.
      if (createdMove) {
        try {
          await deleteMove(createdMove.id);
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
      }
      setError(err.response?.data?.detail || 'Failed to create move. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!config) {
    return (
      <aside className="move-form-panel">
        <div className="move-form-loading">Loading configuration…</div>
      </aside>
    );
  }

  const fps = fpsOf(currentVideo);
  const frameCount = moveEnd !== null && moveStart !== null ? moveEnd - moveStart : 0;
  const duration =
    moveEnd !== null && moveStart !== null
      ? frameToTime(frameCount, fps).toFixed(2)
      : '0.00';

  /** One radio group, every option with its definition. */
  const radioGroup = (taxonomyKey, name, value, onChange, options) => (
    <div className="radio-group">
      {(options ?? config[taxonomyKey] ?? []).map((opt) => (
        <label key={opt} className="radio-label">
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          <span>{optionLabel(config, taxonomyKey, opt)}</span>
          <InfoTip text={optionDescription(config, taxonomyKey, opt)} />
        </label>
      ))}
    </div>
  );

  return (
    <aside className="move-form-panel" data-testid="move-form-panel">
      <div className="move-form-header">
        <h2>Label Move</h2>
        <button onClick={handleClose} className="close-btn" aria-label="Close labeling panel">
          ✕
        </button>
      </div>

      <div className="move-form-content">
        <div className="move-info">
          <p>
            Frames: {moveStart} – {moveEnd} ({frameCount} frames, {duration}s)
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}

        {/* ---------- Lens 1: Environment ---------- */}
        <div className="lens-section">
          <h3 className="lens-title">🏔️ Environment</h3>

          <div className="form-field">
            <label className="form-label">Wall Angle</label>
            {radioGroup('wall_angles', 'wall_angle', wallAngle, setWallAngle)}
          </div>

          {noHandsSelected && (
            <p className="field-disabled-note">
              Hand holds are disabled — “No Hands” is tagged for this move.
            </p>
          )}

          {SLOT_ORDER.map((slot) => {
            const isHandSlot = slot !== 'foot';
            if (noHandsSelected && isHandSlot) return null;
            const s = slots[slot];
            const picking = holdPickSlot?.slot === slot;

            return (
              <fieldset key={slot} className="hold-slot" data-testid={`hold-slot-${slot}`}>
                <legend className="hold-slot-legend">
                  {optionLabel(config, 'hold_slots', slot)}
                  {slot === 'foot' && <span className="optional-flag"> (optional)</span>}
                  <InfoTip text={optionDescription(config, 'hold_slots', slot)} />
                  {s.suggested && (
                    <span className="suggested-flag" title="Auto-suggested from the pose data — confirm or change it">
                      suggested
                    </span>
                  )}
                </legend>

                <div className="hold-slot-pick">
                  <button
                    type="button"
                    className={`pick-on-video-btn ${picking ? 'active' : ''}`}
                    onClick={() =>
                      setHoldPickSlot(picking ? null : { slot, assignedHoldId: null })
                    }
                  >
                    {picking ? 'Click a box on the video…' : 'Pick on video'}
                  </button>
                  {s.hold_id != null && (
                    <span className="picked-hold">
                      Hold #{s.hold_id}
                      <button
                        type="button"
                        className="unpick-btn"
                        onClick={() => updateSlot(slot, { hold_id: null })}
                        aria-label={`Unassign the hold from ${slot}`}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>

                <div className="form-field">
                  <label className="form-label">Hold Type</label>
                  <div className="radio-group">
                    {(config.hold_types ?? []).map((type) => (
                      <label key={type} className="radio-label">
                        <input
                          type="radio"
                          name={`${slot}_hold_type`}
                          value={type}
                          checked={s.hold_type === type}
                          onChange={() => updateSlot(slot, { hold_type: type })}
                        />
                        <span>{optionLabel(config, 'hold_types', type)}</span>
                        <InfoTip text={optionDescription(config, 'hold_types', type)} />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Hold Quality</label>
                  <div className="checkbox-group">
                    {(config.hold_qualities ?? []).map((quality) => (
                      <label key={quality} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={(s.hold_quality || []).includes(quality)}
                          onChange={() => toggleSlotQuality(slot, quality)}
                        />
                        <span>{optionLabel(config, 'hold_qualities', quality)}</span>
                        <InfoTip text={optionDescription(config, 'hold_qualities', quality)} />
                      </label>
                    ))}
                  </div>
                </div>

                <button type="button" className="clear-slot-btn" onClick={() => clearSlot(slot)}>
                  Clear this slot
                </button>
              </fieldset>
            );
          })}
        </div>

        {/* ---------- Lens 2: Strategy ---------- */}
        <div className="lens-section">
          <h3 className="lens-title">🎯 Strategy</h3>

          <div className="form-field">
            <label className="form-label">Approach</label>
            {radioGroup('approaches', 'approach', approach, setApproach)}
          </div>

          <div className="form-field">
            <label className="form-label">
              Size
              <InfoTip text="How big the movement is — not the size of the hold." />
            </label>
            {radioGroup('sizes', 'size', size, setSize)}
          </div>

          <div className="form-field">
            <label className="form-label">Move Tags (multi-select)</label>
            <div className="tags-group">
              {(config.move_tags ?? []).map((tag) => {
                const blocked =
                  (tag === 'no_feet_on' && moveTags.includes('no_hands')) ||
                  (tag === 'no_hands' && moveTags.includes('no_feet_on'));
                return (
                  <span key={tag} className="tag-with-info">
                    <button
                      type="button"
                      onClick={() => toggleMoveTag(tag)}
                      className={`tag-btn ${moveTags.includes(tag) ? 'active' : ''} ${
                        blocked ? 'disabled-mutual' : ''
                      }`}
                      disabled={blocked}
                    >
                      {optionLabel(config, 'move_tags', tag)}
                    </button>
                    <InfoTip text={optionDescription(config, 'move_tags', tag)} />
                  </span>
                );
              })}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Form Quality</label>
            <div className="quality-buttons">
              {[1, 2, 3, 4, 5].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setFormQuality(q)}
                  className={`quality-btn ${formQuality === q ? 'active' : ''}`}
                  title={FORM_QUALITY_LABELS[q]}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="quality-description">{FORM_QUALITY_LABELS[formQuality]}</div>
          </div>

          <div className="form-field">
            <label className="form-label">Effort Level: {effortLevel}/10</label>
            <input
              type="range"
              min="0"
              max="10"
              value={effortLevel}
              onChange={(e) => setEffortLevel(Number(e.target.value))}
              className="effort-slider"
            />
            <div className="effort-labels">
              <span>Easy</span>
              <span>Max Effort</span>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Add notes about this move…"
              className="description-textarea"
              rows="2"
            />
          </div>
        </div>

        {/* ---------- Lens 3: Outcome ---------- */}
        <div className="lens-section">
          <h3 className="lens-title">📊 Outcome</h3>

          <div className="form-field">
            <label className="form-label">Result</label>
            {radioGroup('results', 'result', result, setResult)}
          </div>

          <div className="form-field">
            <label className="form-label">Reach Detail</label>
            {radioGroup('reach_details', 'reach_detail', reachDetail, setReachDetail)}
          </div>

          <div className="form-field">
            <label className="form-label">
              Confidence
              <InfoTip text="How confident you are in the labels you just gave — not how confident the climber looked." />
            </label>
            {radioGroup('confidence_levels', 'confidence', confidence, setConfidence)}
          </div>
        </div>
      </div>

      <div className="move-form-footer">
        <button onClick={handleClose} className="btn-secondary">
          Cancel
        </button>
        <button onClick={handleSubmit} className="btn-primary" disabled={loading}>
          {loading ? 'Saving…' : 'Save Move'}
        </button>
      </div>
    </aside>
  );
}

export default MoveForm;
