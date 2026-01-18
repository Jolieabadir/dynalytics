/**
 * DoneButton component.
 * 
 * Simple button that triggers the passed onClick handler.
 * The parent component handles the export logic.
 */

function DoneButton({ onClick, disabled }) {
  return (
    <button 
      onClick={onClick} 
      className="done-btn"
      disabled={disabled}
    >
      {disabled ? 'Exporting...' : 'Done'}
    </button>
  );
}

export default DoneButton;
