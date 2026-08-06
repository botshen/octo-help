import { useId, type ReactNode } from 'react';

/**
 * One feature = one row: name, one-line状态, its own switch, and details that
 * stay folded until asked for.
 *
 * The panel used to be a stack of cards where some features had a switch, some
 * had a dropdown, some had nothing, and every setting was visible at once. That
 * scales badly — by the fifth feature it reads as one long undifferentiated
 * list. Making the shape uniform (and collapsed by default) means the panel
 * shows *what is on* at a glance, and the knobs only when you want them.
 *
 * The switch deliberately sits outside the expand button: nesting an
 * interactive control inside another is invalid, and it would make "turn this
 * off" and "show me the options" the same click target.
 */
export interface FeatureSectionProps {
  icon: string;
  /** Extra class on the icon chip, e.g. `is-pet`. */
  iconClass?: string;
  title: string;
  /** Collapsed one-liner: the current state, not a feature description. */
  summary: string;
  open: boolean;
  onToggleOpen: () => void;
  /** Omit for a section with no on/off state of its own. */
  enabled?: boolean;
  onToggleEnabled?: () => void;
  disabled?: boolean;
  /** Rendered only while open — details of an unopened section cost nothing. */
  children?: ReactNode;
}

export function FeatureSection({
  icon,
  iconClass = '',
  title,
  summary,
  open,
  onToggleOpen,
  enabled,
  onToggleEnabled,
  disabled = false,
  children,
}: FeatureSectionProps) {
  const bodyId = useId();
  const hasSwitch = enabled != null && onToggleEnabled != null;
  const off = hasSwitch && !enabled;

  return (
    <section className={`feature${open ? ' is-open' : ''}${off ? ' is-off' : ''}`}>
      <div className="feature-head">
        <button
          type="button"
          className="feature-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggleOpen}
        >
          <span className={`section-icon ${iconClass}`} aria-hidden="true">{icon}</span>
          <span className="feature-copy">
            <strong>{title}</strong>
            <small>{summary}</small>
          </span>
          <span className="feature-chevron" aria-hidden="true">›</span>
        </button>
        {hasSwitch && (
          <button
            type="button"
            role="switch"
            aria-label={title}
            aria-checked={enabled}
            className={`switch${enabled ? ' switch-on' : ''}`}
            disabled={disabled}
            onClick={onToggleEnabled}
          >
            <span className="switch-knob" />
          </button>
        )}
      </div>
      {open && (
        <div className="feature-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

export default FeatureSection;
