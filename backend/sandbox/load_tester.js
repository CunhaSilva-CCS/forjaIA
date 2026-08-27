const chaos = require('./chaos');

function inferTestPath(files = [], baseUrl) {
  const joined = (files || []).map((f) => `${f.path}\n${f.content || ''}`).join('\n');
  if (/\/api\/health/.test(joined) && /\/api\/query/.test(joined)) {
    return { path: '/api/health', method: 'GET', body: null };
  }
  if (/\/api\/auth\/login/.test(joined) || /authController/.test(joined)) {
    return { path: '/api/auth/login', method: 'POST', body: { email: 'load@test.com', password: 'password' } };
  }
  if (/\/api\/tasks/.test(joined)) {
    return { path: '/api/tasks', method: 'GET', body: null };
  }
  return { path: '/', method: 'GET', body: null };
}

module.exports = {
  run: async (sandboxConfig, orchestrator, files = []) => {
    if (!sandboxConfig?.baseUrl) {
      throw new Error('Config da sandbox sem baseUrl — prepareSandbox precisa iniciar o runner');
    }

    orchestrator.log('devops', 'Iniciando teste de carga concorrente (injeção de caos no cliente)...', 'info');

    const baseUrl = sandboxConfig.baseUrl.replace(/\/$/, '');
    const durationMs = 3000;
    const concurrency = 20;
    const route = inferTestPath(files, baseUrl);

    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    const latencies = [];

    const startTime = Date.now();
    const endTime = startTime + durationMs;

    orchestrator.log('devops', `Alvo de carga: ${route.method} ${baseUrl}${route.path}`, 'info');

    async function worker() {
      while (Date.now() < endTime) {
        if (orchestrator.getSignal?.()?.aborted) break;
        const reqStart = Date.now();
        let success = false;

        try {
          const delay = chaos.getLatencyModifier();
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
          if (chaos.shouldDropPacket()) throw new Error('Chaos packet drop');

          const res = await fetch(`${baseUrl}${route.path}`, {
            method: route.method,
            headers: { 'Content-Type': 'application/json' },
            body: route.body ? JSON.stringify(route.body) : undefined,
            signal: AbortSignal.timeout(1500)
          });
          if (res.status < 500) success = true;
        } catch {
          success = false;
        }

        latencies.push(Date.now() - reqStart);
        totalRequests++;
        if (success) successfulRequests++;
        else failedRequests++;
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

    const actualDurationSeconds = Math.max((Date.now() - startTime) / 1000, 0.001);
    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      rps: Math.round(totalRequests / actualDurationSeconds),
      avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      successRate: totalRequests ? Math.round((successfulRequests / totalRequests) * 100) : 0,
      target: `${route.method} ${route.path}`,
      chaosMode: chaos.getMode()
    };
  }
};
