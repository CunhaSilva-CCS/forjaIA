const fs = require('fs');
const path = require('path');
const { composeSystemPrompt, announceThinking, loadStyleRules } = require('../lib/seniorEngineer');

// Códigos fonte offline de altíssima qualidade (mock funcional e seguro)
const MOCK_CODES = {
  auth: {
    'package.json': `{
  "name": "auth-api",
  "version": "1.0.0",
  "description": "API de Autenticação Segura gerada pelo Agente Sênior",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node test.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3"
  }
}`,
    'server.js': `const express = require('express');
const cors = require('cors');
const db = require('./db');
const authController = require('./controllers/authController');

const app = express();
app.use(cors());
app.use(express.json());

// Rotas públicas
app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);

// Rota protegida de teste
const authMiddleware = require('./middlewares/authMiddleware');
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Middleware de tratamento global de erros (Segurança e Estabilidade)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Ocorreu um erro interno de segurança no servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Servidor Auth API rodando na porta \${PORT}\`);
});

module.exports = app;`,
    'db.js': `// Banco de dados em memória simplificado para demonstração rica e segura
const users = [];

module.exports = {
  users,
  findUserByEmail: async (email) => {
    return users.find(u => u.email === email);
  },
  addUser: async (user) => {
    users.push(user);
    return user;
  }
};`,
    'controllers/authController.js': `const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_change_me';

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Sanitização e Validação básica contra injeções
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: 'Todos os campos são obrigatórios!' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'A senha deve conter no mínimo 6 caracteres!' });
    }

    const existingUser = await db.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Este e-mail já está cadastrado!' });
    }

    // Hash seguro com sal
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    await db.addUser(newUser);

    res.status(201).json({
      success: true,
      message: 'Usuário cadastrado com sucesso!',
      user: { id: newUser.id, name: newUser.name, email: newUser.email }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios!' });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas!' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas!' });
    }

    // Assinatura JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};`,
    'middlewares/authMiddleware.js': `const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_change_me';

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token não fornecido ou formato inválido!' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido ou expirado!' });
  }
};`
  },
  crud: {
    'package.json': `{
  "name": "task-api",
  "version": "1.0.0",
  "description": "API CRUD de Tarefas gerada pelo Agente Sênior",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node test.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5"
  }
}`,
    'server.js': `const express = require('express');
const cors = require('cors');
const taskController = require('./controllers/taskController');

const app = express();
app.use(cors());
app.use(express.json());

// Rotas CRUD
app.get('/api/tasks', taskController.getAll);
app.post('/api/tasks', taskController.create);
app.put('/api/tasks/:id', taskController.update);
app.delete('/api/tasks/:id', taskController.delete);

// Tratamento de Erros
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Erro no servidor!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Servidor CRUD API rodando na porta \${PORT}\`);
});

module.exports = app;`,
    'db.js': `// Persistência em memória estruturada
const tasks = [
  { id: '1', title: 'Aprender Docker', description: 'Isolar aplicações em containers', completed: false, createdAt: new Date().toISOString() }
];

module.exports = {
  tasks,
  findAll: async () => tasks,
  findById: async (id) => tasks.find(t => t.id === id),
  create: async (task) => {
    tasks.push(task);
    return task;
  },
  update: async (id, updatedFields) => {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...updatedFields, updatedAt: new Date().toISOString() };
    return tasks[idx];
  },
  delete: async (id) => {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    return true;
  }
};`,
    'controllers/taskController.js': `const db = require('../db');

exports.getAll = async (req, res) => {
  const tasks = await db.findAll();
  res.json({ success: true, tasks });
};

exports.create = async (req, res) => {
  try {
    const { title, description } = req.body;

    // Validação estrita
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ success: false, error: 'Título é obrigatório!' });
    }

    const newTask = {
      id: Date.now().toString(),
      title: title.trim(),
      description: description || '',
      completed: false,
      createdAt: new Date().toISOString()
    };

    await db.create(newTask);
    res.status(201).json({ success: true, task: newTask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, completed } = req.body;

    const task = await db.findById(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Tarefa não encontrada!' });
    }

    const updated = await db.update(id, {
      title: title !== undefined ? title : task.title,
      description: description !== undefined ? description : task.description,
      completed: completed !== undefined ? !!completed : task.completed
    });

    res.json({ success: true, task: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.delete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Tarefa não encontrada!' });
    }
    res.json({ success: true, message: 'Tarefa deletada com sucesso!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};`
  }
};


const config = require('../lib/config');
const { generateJson } = require('../lib/llm');

function buildMockFiles(prompt, plan) {
  const lower = prompt.toLowerCase();
  let templateKey = 'default';
  if (lower.includes('auth') || lower.includes('login') || lower.includes('token') || lower.includes('senha')) templateKey = 'auth';
  else if (lower.includes('crud') || lower.includes('tarefa') || lower.includes('todo') || lower.includes('list') || lower.includes('api')) templateKey = 'crud';
  const template = MOCK_CODES[templateKey] || MOCK_CODES.auth;
  return plan.files.map((file) => {
    const filePath = file.path;
    let content = '// Generated stub';
    if (template[filePath]) content = template[filePath];
    else {
      const baseName = path.basename(filePath);
      for (const [k, v] of Object.entries(template)) {
        if (k.endsWith(baseName)) { content = v; break; }
      }
    }
    return { name: file.name, path: filePath, content };
  });
}

function normalizeFiles(files) {
  return (files || []).map((f) => {
    const filePath = f.path || f.filePath || f.filepath || f.filename || f.name;
    if (!filePath) return null;
    return {
      name: f.name || path.basename(filePath),
      path: filePath,
      content: typeof f.content === 'string' ? f.content : '// empty'
    };
  }).filter(Boolean);
}

module.exports = {
  execute: async (prompt, plan, runConfig, orchestrator) => {
    orchestrator.throwIfAborted();
    announceThinking(orchestrator, 'coder');
    const styleRules = loadStyleRules(runConfig);
    orchestrator.log('coder', `Aplicando ${styleRules.length} regras de engenharia sênior.`, 'info');

    const system = composeSystemPrompt(
      'coder',
      `Implemente TODOS os arquivos planejados com conteúdo completo, seguro e executável.
Arquivos planejados: ${JSON.stringify(plan.files)}.
Retorne APENAS JSON estrito:
{ "files": [{"path": "caminho/do/arquivo", "content": "código completo"}] }
Nunca grave segredos de produção no código; use process.env.`,
      runConfig
    );

    try {
      const result = await generateJson({
        system,
        user: 'Requisito: ' + prompt + '\nCrie todos os arquivos planejados com conteúdo completo de nível produção.',
        runConfig,
        signal: orchestrator.getSignal()
      });
      if (result.tokens) {
        orchestrator.recordTokens(result.tokens, {
          provider: result.provider,
          model: result.model
        });
      }
      const files = normalizeFiles(result.data.files);
      if (!files.length) throw new Error('O LLM não retornou arquivos');
      orchestrator.log('coder', 'Código gerado via ' + result.provider + '.', 'success');
      return { files };
    } catch (err) {
      if (!config.allowMocks) {
        throw new Error('Falha no LLM do Codificador (mocks desligados): ' + err.message);
      }
      orchestrator.log('coder', 'Falha no LLM (' + err.message + '); usando código mock offline.', 'warning');
      return { files: buildMockFiles(prompt, plan) };
    }
  }
};
