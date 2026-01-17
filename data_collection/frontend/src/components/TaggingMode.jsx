/**
 * TaggingMode component.
 * 
 * Frame tagging interface for adding sensation tags within a move.
 * Shows cropped/looping video with tag buttons, body part selector, and intensity slider.
 */
import { useRef, useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { getFrameTags, createFrameTag, deleteFrameTag } from '../api/client';
import ThankYouModal from './ThankYouModal';
import DoneButton from './DoneButton';

// Tag type definitions with colors
const TAG_TYPES = [
  { id: 'sharp_pain', label: 'Sharp Pain', color: '#ef4444', emoji: '🔴' },
  { id: 'dull_pain', label: 'Dull Pain', color: '#f97316', emoji: '🟠' },
  { id: 'pop', label: 'Pop', color: '#a855f7', emoji: '🟣' },
  { id: 'unstable', label: 'Unstable', color: '#eab308', emoji: '🟡' },
  { id: 'stretch_awkward', label: 'Stretch/Awkward', color: '#ec4899', emoji: '🩷' },
  { id: 'strong_controlled', label: 'Strong/Controlled', color: '#22c55e', emoji: '🟢' },
  { id: 'weak', label: 'Weak', color: '#6b7280', emoji: '⚫' },
  { id: 'pumped', label: 'Pumped', color: '#3b82f6', emoji: '🔵' },
  { id: 'fatigue', label: 'Fatigue', color: '#92400e', emoji: '🟤' },
];

// Body parts list
const BODY_PARTS = [
  { group: 'Left Side', parts: ['Left Shoulder', 'Left Elbow', 'Left Wrist', 'Left Finger', 'Left Hip', 'Left Knee', 'Left Ankle'] },
  { group: 'Right Side', parts: ['Right Shoulder', 'Right Elbow', 'Right Wrist', 'Right Finger', 'Right Hip', 'Right Knee', 'Right Ankle'] },
  { group: 'Core/Back', parts: ['Lower Back', 'Upper Back', 'Core', 'Neck'] },
];

function TaggingMode() {
  const videoRef = useRef(null);
  const {
    currentVideo,
    currentMove,
    currentFrame,
    frameTags,
    setCurrentFrame,
    setFrameTags,
    addFrameTag,
    removeFrameTag,
    setMode,
    setCurrentMove,
  } = useStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTagType, setSelectedTagType] = useState(null);
  const [selectedBodyPart, setSelectedBodyPart] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [note, setNote] = useState('');
  const [showTagForm, setShowTagForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showThankYou, setShowThankYou] = useState(false);

  const fps = currentVideo?.fps || 30;

  // Load existing frame tags when component mounts
  useEffect(() => {
    const loadTags = async () => {
      if (!currentMove) return;
      
      try {
        const tags = await getFrameTags(currentMove.id);
        setFrameTags(tags);
      } catch (err) {
        console.error('Failed to load frame tags:', err);
      }
    };
    
    loadTags();
  }, [currentMove, setFrameTags]);

  // Set initial frame to move start
  useEffect(() => {
    if (currentMove && videoRef.current) {
      const startTime = currentMove.frame_start / fps;
      videoRef.current.currentTime = startTime;
      setCurrentFrame(currentMove.frame_start);
    }
  }, [currentMove, fps, setCurrentFrame]);

  // Update frame counter as video plays
  useEffect(() => {
    if (!videoRef.current) return;

    const updateFrame = () => {
      const frame = Math.floor(videoRef.current.currentTime * fps);
      setCurrentFrame(frame);
      
      // Loop within move boundaries
      if (currentMove && frame >= currentMove.frame_end) {
        const startTime = currentMove.frame_start / fps;
        videoRef.current.currentTime = startTime;
      }
    };

    const video = videoRef.current;
    video.addEventListener('timeupdate', updateFrame);
    
    return () => video.removeEventListener('timeupdate', updateFrame);
  }, [fps, currentMove, setCurrentFrame]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          seekToFrame(currentFrame - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekToFrame(currentFrame + 1);
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'Escape':
          if (showTagForm) {
            setShowTagForm(false);
            setSelectedTagType(null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentFrame, showTagForm]);

  const seekToFrame = (frame) => {
    if (!videoRef.current || !currentMove) return;
    
    // Clamp to move boundaries
    const clampedFrame = Math.max(currentMove.frame_start, Math.min(frame, currentMove.frame_end));
    const time = clampedFrame / fps;
    videoRef.current.currentTime = time;
    setCurrentFrame(clampedFrame);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTagButtonClick = (tagType) => {
    setSelectedTagType(tagType);
    setShowTagForm(true);
    setSelectedBodyPart('');
    setIntensity(5);
    setNote('');
    setError(null);
    
    // Pause video when tagging
    if (videoRef.current && isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSaveTag = async () => {
    if (!selectedBodyPart) {
      setError('Please select a body part');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tagData = {
        move_id: currentMove.id,
        frame_number: currentFrame,
        timestamp_ms: (currentFrame / fps) * 1000,
        tag_type: selectedTagType.id,
        level: intensity,
        locations: [selectedBodyPart],
        note: note.trim(),
      };

      const newTag = await createFrameTag(tagData);
      addFrameTag(newTag);
      
      // Reset form
      setShowTagForm(false);
      setSelectedTagType(null);
      setSelectedBodyPart('');
      setIntensity(5);
      setNote('');
    } catch (err) {
      console.error('Failed to create tag:', err);
      setError('Failed to save tag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTag = async (tagId) => {
    if (!window.confirm('Delete this tag?')) return;

    try {
      await deleteFrameTag(tagId);
      removeFrameTag(tagId);
    } catch (err) {
      console.error('Failed to delete tag:', err);
      alert('Failed to delete tag');
    }
  };

  // Save & Next Move - go back to define mode to create another move
  const handleNextMove = () => {
    setMode('define');
    setCurrentMove(null);
    setFrameTags([]);
  };

  const formatMoveType = (type) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getTagColor = (tagType) => {
    const tag = TAG_TYPES.find(t => t.id === tagType);
    return tag?.color || '#888';
  };

  const getTagLabel = (tagType) => {
    const tag = TAG_TYPES.find(t => t.id === tagType);
    return tag?.label || tagType;
  };

  if (!currentMove || !currentVideo) {
    return (
      <div className="tagging-mode">
        <p>No move selected.</p>
        <button onClick={handleNextMove}>Back to Define Mode</button>
      </div>
    );
  }

  const moveFrameCount = currentMove.frame_end - currentMove.frame_start;
  const currentMoveFrame = currentFrame - currentMove.frame_start;

  return (
    <div className="tagging-mode">
      {/* Header */}
      <div className="tagging-header">
        <div className="header-buttons">
          <button onClick={handleNextMove} className="back-btn save-next-btn">
            Save & Next Move →
          </button>
          <DoneButton onClick={() => setShowThankYou(true)} />
        </div>
        <div className="move-info">
          <h2>Tagging: {formatMoveType(currentMove.move_type)}</h2>
          <span className="frame-range">
            Frames {currentMove.frame_start} - {currentMove.frame_end}
          </span>
        </div>
      </div>

      <div className="tagging-content">
        {/* Video Section */}
        <div className="tagging-video-section">
          <div className="video-container">
            <video
              ref={videoRef}
              src={`http://localhost:8000/videos/${currentVideo.filename}`}
              loop
            />
          </div>

          {/* Video Controls */}
          <div className="video-controls">
            <button onClick={() => seekToFrame(currentFrame - 10)}>⏮ -10</button>
            <button onClick={() => seekToFrame(currentFrame - 1)}>◀</button>
            <button onClick={togglePlay} className="play-btn">
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={() => seekToFrame(currentFrame + 1)}>▶▶</button>
            <button onClick={() => seekToFrame(currentFrame + 10)}>+10 ⏭</button>
          </div>

          {/* Frame Info */}
          <div className="frame-info">
            <span>Frame: {currentFrame}</span>
            <span>Move Frame: {currentMoveFrame + 1} / {moveFrameCount}</span>
            <span>({(currentFrame / fps).toFixed(2)}s)</span>
          </div>

          {/* Timeline */}
          <div className="tagging-timeline">
            <input
              type="range"
              min={currentMove.frame_start}
              max={currentMove.frame_end}
              value={currentFrame}
              onChange={(e) => seekToFrame(parseInt(e.target.value))}
              className="timeline-slider"
            />
            
            {/* Tag markers on timeline */}
            {frameTags.map((tag) => (
              <div
                key={tag.id}
                className="tag-marker"
                style={{
                  left: `${((tag.frame_number - currentMove.frame_start) / moveFrameCount) * 100}%`,
                  backgroundColor: getTagColor(tag.tag_type),
                }}
                title={`${getTagLabel(tag.tag_type)} - Frame ${tag.frame_number}`}
              />
            ))}
          </div>
        </div>

        {/* Tag Buttons Section */}
        <div className="tagging-controls-section">
          <h3>Add Tag at Frame {currentFrame}</h3>
          
          <div className="tag-buttons-grid">
            {TAG_TYPES.map((tagType) => (
              <button
                key={tagType.id}
                onClick={() => handleTagButtonClick(tagType)}
                className={`tag-button ${selectedTagType?.id === tagType.id ? 'selected' : ''}`}
                style={{ 
                  '--tag-color': tagType.color,
                  borderColor: tagType.color,
                }}
              >
                <span className="tag-emoji">{tagType.emoji}</span>
                <span className="tag-label">{tagType.label}</span>
              </button>
            ))}
          </div>

          {/* Tag Form (appears when tag button clicked) */}
          {showTagForm && selectedTagType && (
            <div className="tag-form">
              <div className="tag-form-header">
                <span 
                  className="selected-tag-badge"
                  style={{ backgroundColor: selectedTagType.color }}
                >
                  {selectedTagType.emoji} {selectedTagType.label}
                </span>
                <span className="at-frame">at Frame {currentFrame}</span>
              </div>

              {/* Body Part Selector */}
              <div className="form-group">
                <label>Body Part *</label>
                <select
                  value={selectedBodyPart}
                  onChange={(e) => setSelectedBodyPart(e.target.value)}
                  className="body-part-select"
                >
                  <option value="">Select body part...</option>
                  {BODY_PARTS.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.parts.map((part) => (
                        <option key={part} value={part}>{part}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Intensity Slider */}
              <div className="form-group">
                <label>Intensity: {intensity}/10</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={intensity}
                  onChange={(e) => setIntensity(parseInt(e.target.value))}
                  className="intensity-slider"
                />
                <div className="intensity-labels">
                  <span>Mild</span>
                  <span>Moderate</span>
                  <span>Severe</span>
                </div>
              </div>

              {/* Note */}
              <div className="form-group">
                <label>Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Additional details..."
                  className="note-input"
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              {/* Form Actions */}
              <div className="form-actions">
                <button
                  onClick={() => {
                    setShowTagForm(false);
                    setSelectedTagType(null);
                  }}
                  className="cancel-btn"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTag}
                  className="save-btn"
                  disabled={loading || !selectedBodyPart}
                >
                  {loading ? 'Saving...' : 'Save Tag'}
                </button>
              </div>
            </div>
          )}

          {/* Existing Tags List */}
          <div className="existing-tags">
            <h4>Tags on this Move ({frameTags.length})</h4>
            {frameTags.length === 0 ? (
              <p className="no-tags">No tags yet. Click a tag button above to add one.</p>
            ) : (
              <div className="tags-list">
                {frameTags.map((tag) => (
                  <div key={tag.id} className="tag-item">
                    <div 
                      className="tag-color-dot"
                      style={{ backgroundColor: getTagColor(tag.tag_type) }}
                    />
                    <div className="tag-details">
                      <div className="tag-main">
                        <strong>{getTagLabel(tag.tag_type)}</strong>
                        <span className="tag-frame">Frame {tag.frame_number}</span>
                      </div>
                      <div className="tag-meta">
                        <span>{tag.locations?.join(', ')}</span>
                        <span className="tag-level">{tag.level}/10</span>
                      </div>
                      {tag.note && <div className="tag-note">{tag.note}</div>}
                    </div>
                    <button
                      onClick={() => handleDeleteTag(tag.id)}
                      className="delete-tag-btn"
                      title="Delete tag"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Thank You Modal */}
      <ThankYouModal show={showThankYou} onClose={() => setShowThankYou(false)} />
    </div>
  );
}

export default TaggingMode;
