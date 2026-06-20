import { useCallback, useState } from 'react';
import { useHistory } from 'react-router-dom';

import { useSpeleoDB } from '../context/useSpeleoDB';

export function useOfflineReconnect() {
  const history = useHistory();
  const { controller } = useSpeleoDB();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showReconnectFailedModal, setShowReconnectFailedModal] = useState(false);

  const attemptReconnect = useCallback(async () => {
    if (isReconnecting) return;
    setIsReconnecting(true);
    try {
      const result = await controller.attemptReconnect();
      if (result === 'unauthorized') {
        history.replace('/login');
        return;
      }
      if (result === 'network_error') {
        setShowReconnectFailedModal(true);
        return;
      }
      // 'ok': offline lock is cleared and the controller launches a project sync.
    } catch {
      // Treat unexpected failures like a failed reconnect: nothing changes.
      setShowReconnectFailedModal(true);
    } finally {
      setIsReconnecting(false);
    }
  }, [controller, history, isReconnecting]);

  return {
    isReconnecting,
    showReconnectFailedModal,
    setShowReconnectFailedModal,
    attemptReconnect,
  };
}
