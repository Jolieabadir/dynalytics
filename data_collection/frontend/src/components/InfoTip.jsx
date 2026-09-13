/**
 * InfoTip — the "i" beside an option label.
 *
 * Rule from the brief: definitions must be available everywhere and required
 * nowhere. So this is a small, low-contrast marker that reveals its text on
 * hover and on keyboard focus, and it renders nothing at all when the config
 * has no definition for that option — rather than an empty tooltip.
 *
 * The text also goes on `title`, so it survives for anyone who never hovers
 * long enough for the styled bubble, and for screen readers via aria-label.
 */
import { useId, useState } from 'react';

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!text) return null;

  return (
    <span className="infotip-wrap">
      <button
        type="button"
        className="infotip-trigger"
        aria-label={`What does this mean? ${text}`}
        aria-describedby={open ? id : undefined}
        title={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // A tooltip trigger should never submit the form it sits inside.
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
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
