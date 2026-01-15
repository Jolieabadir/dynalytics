/**
 * MovesList component.
 * 
 * Displays all completed moves for the current video.
 */
import { useEffect } from 'react';
import useStore from '../store/useStore';
import { getMoves, deleteMove } from '../api/client';

function MovesList() {
  const { currentVideo, moves, setMoves, setCurrentMove, setMode } = useStore();

  // Load moves when video changes
  useEffect(() => {
    const loadMoves = async () => {
      if (!currentVideo) return;
      
      try {
        const movesData = await getMoves(currentVideo.id);
        setMoves(movesData);
      } catch (error) {
        console.error('Failed to load moves:', error);
      }
    };
    
    loadMoves();
  }, [currentVideo, setMoves]);

  const handleAddFrameTags = (move) => {
    setCurrentMove(move);
    setMode('tagging');
  };

  const handleDelete = async (moveId) => {
    if (!window.confirm('Delete this move? Frame tags will also be deleted.')) {
      return;
    }

    try {
      await deleteMove(moveId);
      // Reload moves
      const movesData = await getMoves(currentVideo.id);
      setMoves(movesData);
    } catch (error) {
      console.error('Failed to delete move:', error);
      alert('Failed to delete move');
    }
  };

  if (!currentVideo) return null;

  return (
    <div className="moves-list">
      <h3>Completed Moves</h3>
      
      {moves.length === 0 ? (
        <p className="no-moves">
          No moves created yet. Mark start/end frames to create a move.
        </p>
      ) : (
        <div className="moves-container">
          {moves.map((move) => (
            <MoveCard
              key={move.id}
              move={move}
              onAddTags={handleAddFrameTags}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual move card component
function MoveCard({ move, onAddTags, onDelete }) {
  const formatMoveType = (type) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatDuration = (startMs, endMs) => {
    const durationSec = (endMs - startMs) / 1000;
    return durationSec.toFixed(2);
  };

  const renderQuality = (quality) => {
    return (
      <div className="quality-stars">
        {[1, 2, 3, 4, 5].map(level => (
          <span
            key={level}
            className={`star ${level <= quality ? 'filled' : ''}`}
          >
            ●
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="move-card">
      <div className="move-header">
        <h4>{formatMoveType(move.move_type)}</h4>
        <div className="move-actions">
          <button
            onClick={() => onAddTags(move)}
            className="btn-tag"
            title="Add frame tags"
          >
            Tag Frames
          </button>
          <button
            onClick={() => onDelete(move.id)}
            className="btn-delete"
            title="Delete move"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="move-details">
        <div className="detail-row">
          <span className="label">Frames:</span>
          <span>{move.frame_start} - {move.frame_end}</span>
          <span className="duration">
            ({formatDuration(move.timestamp_start_ms, move.timestamp_end_ms)}s)
          </span>
        </div>

        <div className="detail-row">
          <span className="label">Quality:</span>
          {renderQuality(move.form_quality)}
        </div>

        <div className="detail-row">
          <span className="label">Effort:</span>
          <span className="effort-level">{move.effort_level}/10</span>
        </div>

        {move.tags && move.tags.length > 0 && (
          <div className="detail-row">
            <span className="label">Tags:</span>
            <div className="move-tags">
              {move.tags.map((tag, idx) => (
                <span key={idx} className="tag-badge">
                  {tag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {move.description && (
          <div className="move-description">
            <span className="label">Notes:</span>
            <p>{move.description}</p>
          </div>
        )}

        {move.frame_tag_count > 0 && (
          <div className="frame-tags-count">
            📍 {move.frame_tag_count} frame tag{move.frame_tag_count !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

export default MovesList;
