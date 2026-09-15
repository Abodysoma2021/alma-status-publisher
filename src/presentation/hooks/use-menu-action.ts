'use client';

import * as React from 'react';
import { useAlma } from '../providers/alma-provider';

/**
 * Subscribes a component to a native menu action (application menu,
 * dock menu, keyboard shortcuts). Also consumes a pending action that was
 * dispatched while the user was on another page — so ⌘N from anywhere
 * lands on the Scheduler with the create dialog open.
 */
export function useMenuAction(action: string, cb: () => void): void {
  const { registerMenuListener, takePendingAction } = useAlma();
  const cbRef = React.useRef(cb);
  React.useEffect(() => {
    cbRef.current = cb;
  });

  React.useEffect(() => {
    const handler = () => cbRef.current();
    const unregister = registerMenuListener(action, handler);
    if (takePendingAction(action) === action) handler();
    return unregister;
  }, [action, registerMenuListener, takePendingAction]);
}
