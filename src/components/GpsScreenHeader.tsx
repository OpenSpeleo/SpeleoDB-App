/**
 * GpsScreenHeader -- shared header for the full-screen GPS tools (the GPS Track
 * Recording screen and the High-Accuracy GPS Point screen) so both share the exact
 * same layout: a back button on the top-left, a centered page title, and an
 * optional right-hand slot (used by the recording screen for its ready/recording
 * status tag).
 *
 * See docs/gps-tracks.md.
 */

import React from 'react';

export interface GpsScreenHeaderProps {
  title: string;
  onBack: () => void;
  /** Accessible label for the back button (defaults to "Back"). */
  backLabel?: string;
  backTestId?: string;
  /** Optional content pinned to the top-right (e.g. a status tag). */
  right?: React.ReactNode;
}

const GpsScreenHeader: React.FC<GpsScreenHeaderProps> = ({
  title,
  onBack,
  backLabel = 'Back',
  backTestId,
  right,
}) => (
  <div className="shrink-0 border-b border-slate-700/50 px-2 pt-2 pb-3">
    {/* Top row: back button (left) + optional status tag (right). */}
    <div className="flex min-h-9 items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        data-testid={backTestId}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-200
                   hover:bg-slate-700/50 hover:text-white transition-colors touch-manipulation"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      {right}
    </div>
    {/* Title sits below the back row, centered. */}
    <h2 className="mt-1 text-center text-xl font-semibold text-slate-100">{title}</h2>
  </div>
);

export default GpsScreenHeader;
