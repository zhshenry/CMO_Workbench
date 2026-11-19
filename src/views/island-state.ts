import { useEffect, useRef, useState } from 'react';
import type { IslandSettingsPatch, IslandState } from '../../shared/island-contracts';
import { errorText } from '../ui/controls';

export function useIslandState() {
  const [state, setState] = useState<IslandState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const receive = (value: IslandState) => { if (alive) { setState(value); if (value.error) setError(value.error); } };
    const load = () => { void window.workbench.island.state().then(receive, e => { if (alive) setError(errorText(e)); }); };
    const off = window.workbench.island.onChanged(receive);
    const offError = window.workbench.island.onError(setError);
    load();
    window.addEventListener('focus', load);
    return () => { alive = false; off(); offError(); window.removeEventListener('focus', load); };
  }, []);
  return { state, setState, error, setError };
}

export function useIslandSettingsEditor() {
  const island = useIslandState();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    island.setError('');
    try { await action(); }
    catch (error) { island.setError(errorText(error)); }
    finally { saving.current = false; setBusy(false); }
  };
  const patch = (value: IslandSettingsPatch) => void run(async () => {
    island.setState(await window.workbench.island.patch(value));
  });
  return { ...island, busy, run, patch };
}
