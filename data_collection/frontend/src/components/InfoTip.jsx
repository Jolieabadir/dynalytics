/**
 * InfoTip — the "i" beside an option label.
 *
 * Rule from the brief: definitions must be available everywhere and required
 * nowhere. So this is a small, low-contrast marker that reveals its text on
 * hover and on keyboard focus, and renders nothing at all when the config has
 * no definition for that option — rather than an empty bubble.
 *
 * Hover and pin are tracked separately on purpose. If one flag did both, a
 * mouse user would hover (opening it), click (toggling it shut) and see the
 * definition vanish under the cursor. So: hover and focus reveal it, a click
 * pins it open for touch devices where there is no hover, and a second click
 * unpins.
 *
 * The text also goes on `title` and `aria-label`, so it survives for anyone who
 * never hovers long enough for the styled bubble, and for screen readers.
 */
import { useId, useState } from 'react';

function InfoTip({ text }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();

  if (!text) return null;

  const open = hovered || pinned;

  return (
    <span className="infotip-wrap">
      <button
        type="button"
        className="infotip-trigger"
        aria-label={`What does this mean? ${text}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        title={text}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => {
          setHovered(false);
          setPinned(false);
        }}
        // Never submit the form this sits inside.
        onClick={(e) => {
          e.preventDefault();
          setPinned((v) => !v);
        }}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="infotip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}

export default InfoTip;
