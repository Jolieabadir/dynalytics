/**
 * DoneButton component.
 * 
 * Button that triggers the thank you modal.
 * Reusable across different screens.
 */

function DoneButton({ onClick }) {
  return (
    <button onClick={onClick} className="done-btn">
      Done
    </button>
  );
}

export default DoneButton;
