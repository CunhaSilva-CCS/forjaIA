import { Activity, AlertTriangle, CheckCircle, CloudLightning, Zap } from 'lucide-react';
import type { AppState } from '../../hooks/useForjaApp';

const CHAOS_MODE_LABELS: Record<string, string> = {
  'docker-fault-injection': 'fault injection real (tc netem + cota de CPU no container)',
  'client-side-fault-injection': 'simulação no cliente (sem container Docker disponível)',
  'injecao-falhas-cliente': 'simulação no cliente (sem container Docker disponível)'
};

export function MetricsTab({ s }: { s: AppState }) {
  return (
    <div>
      {s.performanceMetrics ? (
        <div className="metrics-grid">
          <div>
            <Zap size={16} /> RPS: {s.performanceMetrics.rps}
          </div>
          <div>
            <Activity size={16} /> Latência: {s.performanceMetrics.avgLatency}ms
          </div>
          <div>
            <CheckCircle size={16} /> Sucesso: {s.performanceMetrics.successRate}%
          </div>
          <div>
            <CloudLightning size={16} /> Requisições: {s.performanceMetrics.totalRequests}
          </div>
          {s.performanceMetrics.chaosMode && (
            <p className="muted">
              Caos: {CHAOS_MODE_LABELS[s.performanceMetrics.chaosMode] || s.performanceMetrics.chaosMode}
            </p>
          )}
        </div>
      ) : (
        <p className="muted">As métricas aparecem após a fase DevOps.</p>
      )}
      <div style={{ marginTop: 16 }}>
        {s.chaosEvents.map((c, i) => (
          <div key={i} className="log-line warning">
            <AlertTriangle size={12} /> {c.name}: {c.log}
          </div>
        ))}
      </div>
    </div>
  );
}
