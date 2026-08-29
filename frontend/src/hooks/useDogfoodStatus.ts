import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { DogfoodStatus } from '../types/agent';

/**
 * Estado do dogfooding automático agendado (ADR-035): consulta o crontab do SO + o último
 * relatório gravado em disco. Muda raramente (agendamento semanal), então o polling é bem mais
 * espaçado que o do serviço local (useServiceControl, a cada 15s).
 */
export function useDogfoodStatus() {
  const [dogfoodStatus, setDogfoodStatus] = useState<DogfoodStatus | null>(null);

  const refreshDogfoodStatus = useCallback(async () => {
    try {
      const status = await api.ops.dogfood();
      setDogfoodStatus(status);
    } catch {
      setDogfoodStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshDogfoodStatus();
    const id = window.setInterval(() => void refreshDogfoodStatus(), 60000);
    return () => window.clearInterval(id);
  }, [refreshDogfoodStatus]);

  return { dogfoodStatus, refreshDogfoodStatus };
}
