import React, { useMemo } from 'react';
import { IonModal, IonContent } from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { parseGeolocationError } from '../utils/geolocationError';
import type { GeolocationErrorInfo } from '../utils/geolocationError';

interface GeolocationErrorModalProps {
  error: unknown | null;
  onDismiss: () => void;
}

const iconColorClasses: Record<GeolocationErrorInfo['iconColor'], string> = {
  amber: 'bg-amber-500/20 text-amber-400',
  blue: 'bg-blue-500/20 text-blue-400',
  red: 'bg-red-500/20 text-red-300',
};

const WarningIcon: React.FC = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const ClockIcon: React.FC = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const ErrorIcon: React.FC = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
  </svg>
);

function iconForColor(color: GeolocationErrorInfo['iconColor']): React.ReactNode {
  switch (color) {
    case 'amber':
      return <WarningIcon />;
    case 'blue':
      return <ClockIcon />;
    case 'red':
      return <ErrorIcon />;
  }
}

const GeolocationErrorModal: React.FC<GeolocationErrorModalProps> = ({ error, onDismiss }) => {
  const info = useMemo(
    () => (error != null ? parseGeolocationError(error, Capacitor.getPlatform()) : null),
    [error],
  );

  if (!info) return null;

  return (
    <IonModal isOpen={error != null} onDidDismiss={onDismiss}>
      <IonContent className="ion-padding">
        <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
          <div className="mb-6">
            <span
              className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-4 ${iconColorClasses[info.iconColor]}`}
            >
              {iconForColor(info.iconColor)}
            </span>
            <h2 className="text-xl font-semibold text-slate-100 mb-2">{info.title}</h2>
            <p className="text-slate-400 text-sm">{info.description}</p>
            <p className="text-slate-500 text-xs mt-3">{info.instructions}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="app-btn app-btn--secondary w-full"
          >
            OK
          </button>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default GeolocationErrorModal;
