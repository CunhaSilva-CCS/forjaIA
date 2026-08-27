import { Activity, Bug, Code2, FileText, Layers, RefreshCw, Settings, ShieldAlert, Terminal as TerminalIcon } from 'lucide-react';
import type { AppState } from '../hooks/useForjaApp';
import { TerminalTab } from './tabs/TerminalTab';
import { CodeTab } from './tabs/CodeTab';
import { SecurityTab } from './tabs/SecurityTab';
import { DiagnosisTab } from './tabs/DiagnosisTab';
import { MetricsTab } from './tabs/MetricsTab';
import { TokensTab } from './tabs/TokensTab';
import { AdrsTab } from './tabs/AdrsTab';
import { HistoryTab } from './tabs/HistoryTab';
import { ProjectsTab } from './tabs/ProjectsTab';
import { TeamTab } from './tabs/TeamTab';

const TABS = [
  ['terminal', TerminalIcon, 'Terminal'],
  ['code', Code2, 'Código'],
  ['security', ShieldAlert, 'Segurança'],
  ['diagnosis', Bug, 'Diagnóstico'],
  ['metrics', Activity, 'Métricas'],
  ['tokens', Layers, 'Tokens'],
  ['adrs', FileText, 'ADRs'],
  ['history', RefreshCw, 'Histórico'],
  ['projects', Settings, 'Projetos'],
  ['team', Settings, 'Equipe']
] as const;

export function WorkspaceTabs({ s }: { s: AppState }) {
  return (
    <div className="col-center forge-panel">
      <div className="tabs">
        {TABS.map(([id, Icon, label]) => (
          <button key={id} className={s.currentTab === id ? 'active' : ''} onClick={() => s.setCurrentTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {s.currentTab === 'terminal' && <TerminalTab s={s} />}
        {s.currentTab === 'code' && <CodeTab s={s} />}
        {s.currentTab === 'security' && <SecurityTab s={s} />}
        {s.currentTab === 'diagnosis' && <DiagnosisTab s={s} />}
        {s.currentTab === 'metrics' && <MetricsTab s={s} />}
        {s.currentTab === 'tokens' && <TokensTab s={s} />}
        {s.currentTab === 'adrs' && <AdrsTab s={s} />}
        {s.currentTab === 'history' && <HistoryTab s={s} />}
        {s.currentTab === 'projects' && <ProjectsTab s={s} />}
        {s.currentTab === 'team' && <TeamTab s={s} />}
      </div>
    </div>
  );
}
