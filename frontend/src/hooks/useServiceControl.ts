import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

export type ServiceStatus = {
  online: boolean;
  host: string;
  port: number;
  pids: number[];
  watch: { enabled: boolean; pid: number | null };
  control?: { watchRunning: boolean; mode: string };
} | null;

/**
 * Estado e ações do painel de controle do serviço local (start/stop/restart/watch).
 * Faz polling de status a cada 15s. Depende de showToast (feedback) e refreshMeta
 * (recarregar metadados após um restart/stop, já que o backend pode ter subido de novo).
 */
export function useServiceControl(showToast: (msg: string) => void, refreshMeta: () => Promise<void>) {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>(null);
  const [serviceBusy, setServiceBusy] = useState(false);

  const refreshServiceStatus = useCallback(async () => {
    try {
      const st = await api.services.status();
      setServiceStatus(st);
    } catch {
      setServiceStatus(null);
    }
  }, []);

  const runServiceAction = useCallback(
    async (action: 'start' | 'stop' | 'restart' | 'watch') => {
      setServiceBusy(true);
      try {
        const res = await api.services.action(action);
        showToast(res.message || `Ação ${action} enviada`);
        if (action === 'restart' || action === 'stop') {
          showToast('Aguarde o serviço voltar…');
          setTimeout(() => {
            void refreshServiceStatus();
            void refreshMeta();
          }, 5000);
        } else {
          await refreshServiceStatus();
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : `Falha em ${action}`);
      } finally {
        setServiceBusy(false);
      }
    },
    [refreshMeta, refreshServiceStatus, showToast]
  );

  useEffect(() => {
    void refreshServiceStatus();
    const id = window.setInterval(() => void refreshServiceStatus(), 15000);
    return () => window.clearInterval(id);
  }, [refreshServiceStatus]);

  return { serviceStatus, serviceBusy, refreshServiceStatus, runServiceAction };
}
