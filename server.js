const http = require("http");
const https = require("https");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, "auth_info");
const CLIENTES_FILE = path.join(__dirname, "clientes.json");
var broadcastStatus = { running: false, sent: 0, failed: 0, total: 0, ultimaMsg: "", iniciadoEm: null, terminadoEm: null, erros: [] };

function carregarClientes() {
  try {
    if (fs.existsSync(CLIENTES_FILE)) {
      var data = JSON.parse(fs.readFileSync(CLIENTES_FILE, "utf-8"));
      return (data.clientes || []).filter(function(c) { return c.ativo !== false; });
    }
  } catch (e) { console.log("[clientes.json] erro:", e.message); }
  return [];
}

async function dispararBroadcast(mensagem, senha) {
  if (broadcastStatus.running) return { ok: false, erro: "Ja existe um disparo em andamento" };
  if (senha !== "adr2026") return { ok: false, erro: "Senha invalida" };
  if (!sock || !sock.user) return { ok: false, erro: "WhatsApp desconectado" };
  var clientes = carregarClientes();
  if (!clientes.length) return { ok: false, erro: "Nenhum cliente ativo" };

  broadcastStatus = { running: true, sent: 0, failed: 0, total: clientes.length, ultimaMsg: mensagem.substring(0,80), iniciadoEm: new Date().toISOString(), terminadoEm: null, erros: [] };

  (async function() {
    for (var i = 0; i < clientes.length; i++) {
      var cli = clientes[i];
      var jid = cli.numero + "@s.whatsapp.net";
      var texto = mensagem
        .replace(/\{nome\}/g, cli.nome || "")
        .replace(/\{empresa\}/g, cli.empresa || "")
        .replace(/\{regime\}/g, cli.regime || "");
      try {
        await sock.sendMessage(jid, { text: texto });
        broadcastStatus.sent++;
        console.log("[BROADCAST] enviado para " + cli.nome + " (" + cli.numero + ")");
      } catch (e) {
        broadcastStatus.failed++;
        broadcastStatus.erros.push({ nome: cli.nome, erro: String(e && e.message || e) });
        console.log("[BROADCAST] FALHA " + cli.nome + ": " + (e && e.message));
      }
      if (i < clientes.length - 1) {
        var delay = 20000 + Math.floor(Math.random() * 20000);
        await new Promise(function(r){ setTimeout(r, delay); });
      }
    }
    broadcastStatus.running = false;
    broadcastStatus.terminadoEm = new Date().toISOString();
    console.log("[BROADCAST] concluido. enviados=" + broadcastStatus.sent + " falhas=" + broadcastStatus.failed);
  })();

  return { ok: true, msg: "Disparo iniciado para " + clientes.length + " clientes. Acompanhe em /admin/broadcast-status" };
}
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const PROTOCOLS_FILE = path.join(__dirname, "protocolos.json");

// ========== SISTEMA DE PROTOCOLOS ==========
function loadProtocols() {
  try {
    if (fs.existsSync(PROTOCOLS_FILE)) return JSON.parse(fs.readFileSync(PROTOCOLS_FILE, "utf8"));
  } catch (e) {}
  return { counter: 0, sessions: {} };
}

function saveProtocols(data) {
  try { fs.writeFileSync(PROTOCOLS_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

function getProtocol(from) {
  var data = loadProtocols();
  var today = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("");
  // Se já tem sessão aberta hoje e não está encerrada, incrementa
  if (data.sessions[from] && data.sessions[from].date === today && data.sessions[from].status !== "encerrado") {
    data.sessions[from].msgCount++;
    saveProtocols(data);
    return data.sessions[from];
  }
  // Se encerrou ou é novo dia, cria novo protocolo
  data.counter++;
  var protocol = today + "-" + String(data.counter).padStart(5, "0");
  data.sessions[from] = {
    protocol: protocol,
    date: today,
    msgCount: 1,
    status: "aberto",
    startTime: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    endTime: null,
    rating: null,
    feedback: null
  };
  saveProtocols(data);
  return data.sessions[from];
}

function closeProtocol(from) {
  var data = loadProtocols();
  if (data.sessions[from] && data.sessions[from].status === "aberto") {
    data.sessions[from].status = "aguardando_avaliacao";
    saveProtocols(data);
    return data.sessions[from];
  }
  return null;
}

function rateProtocol(from, rating) {
  var data = loadProtocols();
  if (data.sessions[from] && data.sessions[from].status === "aguardando_avaliacao") {
    data.sessions[from].rating = rating;
    data.sessions[from].status = "encerrado";
    data.sessions[from].endTime = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    saveProtocols(data);
    return data.sessions[from];
  }
  return null;
}
function getProtocolStats() {
  var data = loadProtocols();
  var today = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("");
  var todayCount = 0;
  var totalMsgs = 0;
  var abertos = 0;
  var encerrados = 0;
  var totalRating = 0;
  var ratingCount = 0;
  var entries = Object.entries(data.sessions);
  for (var i = 0; i < entries.length; i++) {
    var s = entries[i][1];
    if (s.date === today) { todayCount++; totalMsgs += s.msgCount; }
    if (s.status === "aberto" || s.status === "aguardando_avaliacao") abertos++;
    if (s.status === "encerrado") encerrados++;
    if (s.rating) { totalRating += s.rating; ratingCount++; }
  }
  var avgRating = ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : "--";
  return { total: data.counter, today: todayCount, todayMsgs: totalMsgs, abertos: abertos, encerrados: encerrados, avgRating: avgRating, ratingCount: ratingCount };
}

// ========== SAUDAÇÃO INTELIGENTE ==========
function getSaudacao() {
  const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false });
  const h = parseInt(hora);
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

// ========== RODAPÉ ==========
const FOOTER = `

📧 contato@adenilsonribeiro.top
📲 Siga no Instagram: instagram.com/adenilsonribeiro.top`;

// ========== MENU E RESPOSTAS ==========
function getMenu() {
  return getSaudacao() + `! Seja bem-vindo(a). 😊

Sou *Adenilson Ribeiro* e este é o meu *Escritório de Contabilidade, Perícia, Administração Judicial, Diligências e Psicanálise*.

📋 *Selecione o serviço desejado:*

1️⃣ Contabilidade e Impostos
2️⃣ Perícia Contábil e Judicial
3️⃣ IRPF – Imposto de Renda
4️⃣ Certidões e Documentos
5️⃣ Agendar Consulta
6️⃣ Falar com Adenilson
7️⃣ Diligências para Empresas e Profissionais
8️⃣ Administração Judicial
9️⃣ Psicanálise — Atendimento Clínico

Digite o *número* da opção ou descreva o que precisa.
Você também pode fazer perguntas livremente que nossa IA responderá.

_Para encerrar o atendimento, digite_ *0* _ou_ *encerrar*` + FOOTER;
}
const RESPONSES = {
  "1": `📊 *Contabilidade e Impostos*

Serviços disponíveis:
• Abertura e Encerramento de Empresas
• Escrituração Contábil e Fiscal
• Balanços e Demonstrações Financeiras
• Obrigações Acessórias (SPED, DCTF, EFD)
• Planejamento Tributário
• MEI, Simples Nacional, Lucro Presumido e Real

📌 CRC/MG 111.185

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "2": `🔍 *Perícia Contábil e Judicial*

Formas de atuação:
• Perito Judicial nomeado pelo Juízo
• Assistente Técnico das partes
• Perícia Extrajudicial
• Elaboração de Laudos Periciais Contábeis
• Cálculos Judiciais e Trabalhistas

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "3": `💰 *IRPF – Imposto de Renda*

Serviços disponíveis:
• Declaração Completa e Simplificada
• Retificação de Declarações anteriores
• Regularização de Malha Fina
• Carnê-Leão
• Apuração de Ganho de Capital
• Planejamento para a próxima declaração

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "4": `📄 *Certidões e Documentos*

Emissão e assessoria:
• Certidão Negativa de Débitos (CND)
• Certidão de Regularidade Fiscal
• Certidão de Regularidade do FGTS
• Certidões da Justiça Federal e Estadual
• Documentação para Licitações e Contratos

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "5": `📅 *Agendamento de Consulta*

Para agendar, envie as seguintes informações:

• Seu *nome completo*
• *Assunto* (contabilidade, perícia, IRPF, certidões ou diligências)
• *Data e horário* de sua preferência

🕐 *Atendimento:* segunda a sexta, das 8h às 18h
💻 *Modalidade:* atendimento online (todo o Brasil)
📞 *Telefone/WhatsApp:* (37) 98807-5561
📧 *E-mail:* contato@adenilsonribeiro.top
🌐 *Site:* www.adenilsonribeiro.top

Assim que receber seus dados, entrarei em contato para confirmar.` + FOOTER,

  "6": `📞 *Atendimento Humano*

Sua mensagem foi encaminhada para *Adenilson Ribeiro*.
Responderemos o mais breve possível.

🕐 *Horário de atendimento:* segunda a sexta, das 8h às 18h
📞 *Telefone:* (37) 98807-5561
📧 *E-mail:* contato@adenilsonribeiro.top
🌐 *Site:* www.adenilsonribeiro.top

Agradecemos o seu contato e a sua paciência.` + FOOTER,

  "7": `📍 *Diligências para Empresas e Profissionais*

Serviços disponíveis:
• Diligências em Órgãos Públicos (Receita Federal, INSS, Juntas Comerciais)
• Protocolo e Acompanhamento de Processos
• Obtenção de Certidões e Documentos
• Representação junto a Órgãos Reguladores
• Diligências Cartórias e Judiciais
• Atendimento para Empresas e Profissionais de todo o Brasil

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "8": `⚖️ *Administração Judicial*

Atuação como Administrador Judicial em:
• Recuperação Judicial de Empresas
• Processos de Falência
• Gestão de Massa Falida
• Elaboração de Relatórios e Prestação de Contas
• Verificação e Habilitação de Créditos
• Assembleia de Credores

_Para agendar, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "9": `🧠 *Psicanálise — Atendimento Clínico*

Modalidades de atendimento:
• Análise Individual (adultos e adolescentes)
• Escuta Clínica em Momentos de Crise
• Ansiedade, Depressão e Sofrimento Psíquico
• Questões Existenciais e Relações Familiares
• Atendimento Online (todo o Brasil)
• Sigilo profissional absoluto

_Para agendar uma sessão, digite_ *5*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER
};

const KEYWORDS = {
  menu: "menu", oi: "menu", ola: "menu", "olá": "menu", inicio: "menu", "início": "menu",
  hi: "menu", hello: "menu", "bom dia": "menu", "boa tarde": "menu", "boa noite": "menu",
  contabilidade: "1", contador: "1", contabil: "1", "contábil": "1", mei: "1",
  pericia: "2", "perícia": "2", perito: "2", laudo: "2",
  irpf: "3", "imposto de renda": "3", declaracao: "3", "declaração": "3", "malha fina": "3", imposto: "3", declarar: "3", renda: "3",
  certidao: "4", "certidão": "4", cnd: "4", licitacao: "4", "licitação": "4",
  agendar: "5", agendamento: "5", "marcar consulta": "5", "marcar horário": "5",
  atendente: "6", "falar com adenilson": "6", "falar com alguem": "6", "falar com alguém": "6",
  "diligência": "7", "diligências": "7", diligencia: "7", diligencias: "7",
  "administração judicial": "8", "administrador judicial": "8", falencia: "8", "falência": "8", "recuperação judicial": "8", recuperacao: "8",
  psicanalise: "9", "psicanálise": "9", psicanalista: "9", terapia: "9", analise: "9", "análise clínica": "9", ansiedade: "9", "depressão": "9", depressao: "9", escuta: "9", clínica: "9", clinica: "9"
};

// ========== RESPOSTA PADRÃO (SEM IA) ==========
function getFallback() {
  return `Obrigado pela sua mensagem.

Não consegui identificar o serviço desejado. Por favor, digite o *número* de uma das opções abaixo:

1️⃣ Contabilidade e Impostos
2️⃣ Perícia Contábil e Judicial
3️⃣ IRPF – Imposto de Renda
4️⃣ Certidões e Documentos
5️⃣ Agendar Consulta
6️⃣ Falar com Adenilson
7️⃣ Diligências
8️⃣ Administração Judicial
9️⃣ Psicanálise

Ou descreva o que precisa com mais detalhes.` + FOOTER;
}

// ========== INTELIGÊNCIA ARTIFICIAL (GROQ) ==========
const SYSTEM_PROMPT = "Você é o assistente virtual do Escritório de Adenilson Ribeiro. Adenilson é um profissional individual (não tem equipe) que atua nas áreas de Contabilidade (CRC/MG 111.185), Perícia Contábil Judicial e Extrajudicial, Administração Judicial (Recuperação Judicial e Falências), Diligências e Psicanálise (atendimento clínico). Regras: 1) Responda sempre em português brasileiro correto e formal, mas acolhedor. 2) Seja MUITO breve e direto — máximo 3 frases curtas. Não repita informações de contato nem dados do escritório em toda resposta. 3) Use *negrito* para destaques. 4) Nunca diga 'nossa equipe' — use 'eu' ou 'Adenilson Ribeiro'. 5) NÃO ofereça consultoria jurídica ou advocacia — se o cliente pedir assessoria jurídica, oriente a procurar canal específico da advocacia. 6) Para psicanálise: acolha com sensibilidade, nunca faça diagnósticos nem interpretações clínicas por mensagem — sempre oriente a agendar sessão (opção 5). Nunca minimize sofrimento psíquico. Se houver sinal de crise grave (ideiação suicida, violência), oriente imediatamente CVV 188 ou emergência 192. 7) Não invente informações contábeis específicas. 8) Quando o assunto exigir análise detalhada, oriente a agendar consulta (opção 5). 9) NÃO repita a apresentação do escritório em cada mensagem. 10) Responda de forma útil e direta, sem enrolação. 11) NÃO inclua telefone, email ou site na resposta — o rodapé já tem essas informações. 12) Se a mensagem for casual (oi, obrigado, ok, etc.), responda naturalmente. Dados: Horário segunda a sexta 8h-18h, atendimento online todo o Brasil, prazo até 24h. Honorários tratados de forma personalizada. Se o cliente perguntar sobre advocacia ou serviços jurídicos, responda educadamente que este canal não atende advocacia.";

const conversationHistory = new Map();

function getHistory(from) {
  var entry = conversationHistory.get(from);
  if (entry && (Date.now() - entry.ts) < 1800000) return entry.msgs;
  conversationHistory.set(from, { msgs: [], ts: Date.now() });
  return [];
}

function addHistory(from, role, content) {
  var entry = conversationHistory.get(from) || { msgs: [], ts: Date.now() };
  entry.msgs.push({ role: role, content: content });
  if (entry.msgs.length > 10) entry.msgs = entry.msgs.slice(-10);
  entry.ts = Date.now();
  conversationHistory.set(from, entry);
}

function askAI(userMsg, from) {
  return new Promise(function(resolve, reject) {
    var hist = getHistory(from);
    addHistory(from, "user", userMsg);
    var body = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: SYSTEM_PROMPT }].concat(hist),
      max_tokens: 500,
      temperature: 0.7
    });
    var req = https.request({
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY }
    }, function(res) {
      var data = "";
      res.on("data", function(c) { data += c; });
      res.on("end", function() {
        try {
          var j = JSON.parse(data);
          if (j.choices && j.choices[0]) {
            var r = j.choices[0].message.content;
            addHistory(from, "assistant", r);
            resolve(r + FOOTER);
          } else { reject(new Error("Resposta inválida")); }
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// ========== STATE ==========
var latestQR = null;
var connectionStatus = "disconnected";
var sock = null;
var processed = new Set();
var lastResponse = new Map(); // Anti-flood: rastreia última resposta por remetente
var humanTakeover = new Map(); // Pausa humana: quando Adenilson responde, bot para por 2h
var botSentMessages = new Set(); // IDs de mensagens enviadas pelo bot (para distinguir de manuais)

// ========== PAUSA HUMANA ==========
function isHumanTakeover(jid) {
  var ts = humanTakeover.get(jid);
  if (ts && (Date.now() - ts) < 7200000) return true;
  if (ts) humanTakeover.delete(jid);
  return false;
}

// ========== REMOVER ACENTOS (para comparação de palavras-chave) ==========
function removeAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ========== ENVIO SEGURO (rastreia mensagens do bot) ==========
async function botSend(to, content) {
  try {
    var sent = await sock.sendMessage(to, content);
    if (sent && sent.key && sent.key.id) {
      botSentMessages.add(sent.key.id);
      setTimeout(function() { botSentMessages.delete(sent.key.id); }, 120000);
    }
    return sent;
  } catch (e) {
    console.error("Erro envio:", e.message);
    return null;
  }
}

// ========== LISTA DE CONTATOS IGNORADOS (bot NÃO responde) ==========
// Adicione números no formato: 55DDDNUMERO@s.whatsapp.net
const IGNORED_CONTACTS = new Set([
  "5531921179190@s.whatsapp.net",  // Elaine (Contadora & Perita)
  "5537841466460@s.whatsapp.net",  // Juliana (restrito)
  "5537842641280@s.whatsapp.net",  // Gabriella (restrito)
  "5537915808260@s.whatsapp.net",  // ALIF Mecânico (pessoal)
  "187939782938841@lid",            // Gabriella (formato @lid)
  "51174535348326@lid",             // Juliana (formato @lid)
]);

// Comando admin para adicionar/remover contatos ignorados em tempo real
// !ignorar 5531999999999 — adiciona
// !desigmorar 5531999999999 — remove
// !ignorados — lista todos

function wasSeen(id) {
  if (processed.has(id)) return true;
  processed.add(id);
  setTimeout(function() { processed.delete(id); }, 120000);
  return false;
}

function isFlood(from) {
  var now = Date.now();
  var last = lastResponse.get(from);
  if (last && (now - last) < 3000) return true; // 3 segundos entre respostas ao mesmo remetente
  lastResponse.set(from, now);
  return false;
}

// ========== BOT ==========
async function startBot() {
  var auth = await useMultiFileAuthState(AUTH_DIR);
  var ver = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version: ver.version, auth: auth.state, printQRInTerminal: false,
    logger: pino({ level: "silent" }), browser: ["Ubuntu", "Chrome", "120.0.0.0"],
    connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0, keepAliveIntervalMs: 30000, markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", auth.saveCreds);

  sock.ev.on("connection.update", function(u) {
    if (u.qr) { latestQR = u.qr; connectionStatus = "waiting_qr"; }
    if (u.connection === "close") {
      connectionStatus = "disconnected";
      var sc = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : null;
      if (sc !== DisconnectReason.loggedOut) { setTimeout(startBot, 5000); }
      else { if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true }); latestQR = null; setTimeout(startBot, 3000); }
    }
    if (u.connection === "open") { connectionStatus = "connected"; latestQR = null; console.log("Bot conectado!"); }
  });

  sock.ev.on("messages.upsert", async function(ev) {
    if (ev.type !== "notify") return;
    for (var i = 0; i < ev.messages.length; i++) {
      var msg = ev.messages[i];
      // Detectar mensagem manual do Adenilson (fromMe) para ativar pausa humana
      if (msg.key.fromMe) {
        if (msg.key.remoteJid !== "status@broadcast" && !msg.key.remoteJid.endsWith("@g.us")) {
          // Só ativar pausa se NÃO foi o bot que enviou
          var isAdminJid = (msg.key.remoteJid === "5537999521810@s.whatsapp.net" || msg.key.remoteJid === "553799952181@s.whatsapp.net");
          if (!botSentMessages.has(msg.key.id) && !isAdminJid) {
            humanTakeover.set(msg.key.remoteJid, Date.now());
            console.log("PAUSA HUMANA ativada: " + msg.key.remoteJid + " (2h)");
          }
        }
        continue;
      }
      if (msg.key.remoteJid === "status@broadcast" || msg.key.remoteJid.endsWith("@g.us")) continue;
      if (wasSeen(msg.key.id)) continue;
      if (msg.messageTimestamp && (Date.now() / 1000 - msg.messageTimestamp) > 60) continue;
      if (isFlood(msg.key.remoteJid)) continue;

      // Pausa humana: se Adenilson respondeu manualmente, bot não interfere (2h)
      if (isHumanTakeover(msg.key.remoteJid)) continue;

      var text = "";
      if (msg.message) text = msg.message.conversation || (msg.message.extendedTextMessage ? msg.message.extendedTextMessage.text : "") || "";
      if (!text) continue;

      var from = msg.key.remoteJid;
      var clean = text.trim().toLowerCase();
      // Normalizar comandos: remover espaço depois do ! (ex: "! ignorados" → "!ignorados")
      if (clean.startsWith("!")) clean = "!" + clean.substring(1).trim();

      // Permitir comandos admin (!) mesmo de números ignorados
      // Aceitar variações do número pessoal (com/sem 9 extra)
      var isAdmin = (from === "5537999521810@s.whatsapp.net" || from === "553799952181@s.whatsapp.net" || from === "553799952181@s.whatsapp.net");
      
      // Log para debug de comandos admin
      if (clean.startsWith("!")) { console.log("CMD: from=" + from + " clean=" + clean + " isAdmin=" + isAdmin); }
      var isAdminCmd = isAdmin && clean.startsWith("!");

      // Ignorar contatos da lista (parceiros, família, etc.) — exceto comandos admin
      // Suporta tanto @s.whatsapp.net quanto @lid (novo formato Linked ID do WhatsApp)
      var fromBare = from.split("@")[0];
      var isIgnored = IGNORED_CONTACTS.has(from)
                   || IGNORED_CONTACTS.has(fromBare)
                   || IGNORED_CONTACTS.has(fromBare + "@s.whatsapp.net")
                   || IGNORED_CONTACTS.has(fromBare + "@lid");
      // Log para descobrir novos JIDs @lid
      if (from.indexOf("@lid") !== -1) {
        console.log("[LID] JID=" + from + " ignored=" + isIgnored + " msg=" + clean.substring(0, 30));
      }
      if (isIgnored && !isAdminCmd) continue;
      var response = null;

      // Verificar se está aguardando avaliação
      var dataCheck = loadProtocols();
      var sessionCheck = dataCheck.sessions[from];
      if (sessionCheck && sessionCheck.status === "aguardando_avaliacao") {
        var nota = parseInt(clean);
        if (nota >= 1 && nota <= 5) {
          var rated = rateProtocol(from, nota);
          var estrelas = "⭐".repeat(nota);
          response = `${estrelas}

✅ *Protocolo ${rated.protocol} encerrado com sucesso.*

Muito obrigado pela sua avaliação! Sua opinião é fundamental para melhorarmos nosso atendimento.

Se precisar de algo mais, é só enviar uma nova mensagem.` + FOOTER;
          await botSend(from, { text: response });
          continue;
        } else {
          response = `Por favor, digite uma nota de *1* a *5* para avaliar o atendimento:

1️⃣ Péssimo
2️⃣ Ruim
3️⃣ Regular
4️⃣ Bom
5️⃣ Excelente`;
          await botSend(from, { text: response });
          continue;
        }
        }

      // Registrar protocolo
      var proto = getProtocol(from);

      // Comandos admin: gerenciar contatos ignorados
      if (isAdmin) {
        if (clean.startsWith("!ignorar ")) {
          var num = clean.replace("!ignorar ", "").replace(/[^0-9]/g, "");
          if (num) { IGNORED_CONTACTS.add(num + "@s.whatsapp.net"); response = `✅ Número ${num} adicionado à lista de ignorados. O bot não responderá mais a esse contato.`; }
          else { response = "Use: !ignorar 5531999999999"; }
          await botSend(from, { text: response });
          continue;
        }
        if (clean.startsWith("!desigmorar ") || clean.startsWith("!designorar ")) {
          var num2 = clean.replace(/^!(desigmorar|designorar) /, "").replace(/[^0-9]/g, "");
          IGNORED_CONTACTS.delete(num2 + "@s.whatsapp.net");
          response = `✅ Número ${num2} removido da lista. O bot voltará a responder.`;
          await botSend(from, { text: response });
          continue;
        }
        if (clean === "!ignorados") {
          var lista = Array.from(IGNORED_CONTACTS).map(function(c) { return c.replace("@s.whatsapp.net", ""); });
          var NL = String.fromCharCode(10);
          response = "Contatos ignorados (" + lista.length + "):" + NL + NL + (lista.length > 0 ? lista.join(NL) : "Nenhum contato na lista.");
          await botSend(from, { text: response });
          continue;
        }
        // Comando admin: retomar bot para contato (cancelar pausa humana)
        if (clean.startsWith("!retomar ")) {
          var numR = clean.replace("!retomar ", "").replace(/[^0-9]/g, "");
          if (numR) {
            humanTakeover.delete(numR + "@s.whatsapp.net");
            response = "\u2705 Bot reativado para " + numR + ". O bot voltar\u00e1 a responder.";
          } else { response = "Use: !retomar 5531999999999"; }
          await botSend(from, { text: response });
          continue;
        }
        // Comando admin: listar contatos com pausa humana ativa
        if (clean === "!pausados") {
          var pausados = [];
          var agora = Date.now();
          humanTakeover.forEach(function(ts, jid) {
            if ((agora - ts) < 7200000) {
              var min = Math.round((agora - ts) / 60000);
              pausados.push(jid.replace("@s.whatsapp.net", "") + " (" + min + "min)");
            }
          });
          var NL2 = String.fromCharCode(10);
          response = "Contatos em pausa humana (" + pausados.length + "):" + NL2 + NL2 + (pausados.length > 0 ? pausados.join(NL2) : "Nenhum contato pausado.");
          await botSend(from, { text: response });
          continue;
        }
      }

      // Comando admin: relatório de protocolos
      if (clean === "!protocolos" && isAdmin) {
        var stats = getProtocolStats();
        response = `📊 *Relatório de Protocolos (ISO 9001)*

• Total de atendimentos: ${stats.total}
• Atendimentos hoje: ${stats.today}
• Mensagens hoje: ${stats.todayMsgs}
• Protocolos abertos: ${stats.abertos}
• Protocolos encerrados: ${stats.encerrados}
• Nota média de satisfação: ${stats.avgRating} (${stats.ratingCount} avaliações)`;
        await botSend(from, { text: response });
        continue;
      }

      // Comando admin: relatório de satisfação detalhado
      if (clean === "!satisfacao" && isAdmin) {
        var dataS = loadProtocols();
        var rated = Object.entries(dataS.sessions).filter(function(e) { return e[1].rating; });
        var txt = `📊 *Pesquisa de Satisfação (ISO 9001)*

`;
        if (rated.length === 0) {
          txt += "Nenhuma avaliação registrada ainda.";
        } else {
          var dist = [0,0,0,0,0];
          for (var r = 0; r < rated.length; r++) { dist[rated[r][1].rating - 1]++; }
          txt += `Total de avaliações: ${rated.length}

`;
          txt += `5️⃣ Excelente: ${dist[4]} (${(dist[4]/rated.length*100).toFixed(0)}%)
`;
          txt += `4️⃣ Bom: ${dist[3]} (${(dist[3]/rated.length*100).toFixed(0)}%)
`;
          txt += `3️⃣ Regular: ${dist[2]} (${(dist[2]/rated.length*100).toFixed(0)}%)
`;
          txt += `2️⃣ Ruim: ${dist[1]} (${(dist[1]/rated.length*100).toFixed(0)}%)
`;
          txt += `1️⃣ Péssimo: ${dist[0]} (${(dist[0]/rated.length*100).toFixed(0)}%)`;
        }
        await botSend(from, { text: txt });
        continue;
  }

      // Encerrar protocolo e pedir avaliação
      if (clean === "encerrar" || clean === "finalizar" || clean === "0" || clean === "fechar") {
        var closed = closeProtocol(from);
        if (closed) {
          response = `📋 *Protocolo ${closed.protocol}*

⏱️ Início: ${closed.startTime}
💬 Mensagens trocadas: ${closed.msgCount}

Para encerrar o atendimento, por favor avalie nosso serviço de *1* a *5*:

1️⃣ Péssimo
2️⃣ Ruim
3️⃣ Regular
4️⃣ Bom
5️⃣ Excelente

Sua avaliação é muito importante para a melhoria contínua dos nossos serviços.`;
          await botSend(from, { text: response });
          continue;
        }
      }

      var numKey = clean.replace(/[^0-9]/g, "");
      if (RESPONSES[numKey]) response = RESPONSES[numKey];

      if (!response) {
        var cleanNoAccent = removeAccents(clean);
        var kw = Object.entries(KEYWORDS);
        for (var k = 0; k < kw.length; k++) {
          var kwKey = kw[k][0];
          var kwNoAccent = removeAccents(kwKey);
          if (clean.includes(kwKey) || cleanNoAccent.includes(kwNoAccent)) {
            response = kw[k][1] === "menu" ? getMenu() : RESPONSES[kw[k][1]];
            break;
          }
        }
      }

      if (!response) {
        if (GROQ_API_KEY) {
          try { response = await askAI(clean, from); }
          catch (e) { response = getFallback(); }
        } else { response = getFallback(); }
      }

      // Adicionar protocolo na primeira mensagem do dia
      if (proto.msgCount === 1) {
        response = `📋 *Protocolo:* ${proto.protocol}

` + response;
      }

      await botSend(from, { text: response });

      if (numKey === "7" || clean.includes("atendente") || clean.includes("humano")) {
        var cn = from.replace("@s.whatsapp.net", "");
        await botSend("5537999521810@s.whatsapp.net", {
          text: `🔔 *Novo cliente solicitou atendente!*

Número: +${cn}
Protocolo: ${proto.protocol}
Mensagem: ${text}
Horário: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
        });
      }
    }
  });
            }

// ========== HTTP ==========
http.createServer(async function(req, res) {
  var url = new URL(req.url, "http://localhost:" + PORT);
  if (url.pathname === "/" || url.pathname === "/qr") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (connectionStatus === "connected") {
      return res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADR Bot</title><style>body{font-family:Arial;text-align:center;padding:40px;background:#e8f5e9}h1{color:#2e7d32}p{font-size:18px}</style></head><body><h1>✅ Bot Conectado!</h1><p>O bot está funcionando no WhatsApp.</p><p>(37) 98807-5561</p><p>IA: ' + (GROQ_API_KEY ? "Ativada" : "Desativada") + '</p><script>setTimeout(function(){location.reload()},30000)</script></body></html>');
    }
    if (latestQR) {
      try {
        var qr = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
        return res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar</title><style>body{font-family:Arial;text-align:center;padding:20px;background:#fff3e0}h1{color:#e65100}img{border:3px solid #333;border-radius:10px;margin:20px}</style></head><body><h1>📱 Conectar WhatsApp</h1><p><b>Escaneie o QR Code:</b></p><img src="' + qr + '"/><p>WhatsApp Business > Menu > Dispositivos conectados > Conectar</p><script>setTimeout(function(){location.reload()},20000)</script></body></html>');
      } catch (e) { res.writeHead(500); return res.end("Erro"); }
    }
    return res.end('<html><head><meta charset="utf-8"><title>ADR Bot</title><style>body{font-family:Arial;text-align:center;padding:40px;background:#e3f2fd}h1{color:#1565c0}</style></head><body><h1>⏳ Aguardando...</h1><p>O QR Code aparecerá em instantes.</p><script>setTimeout(function(){location.reload()},5000)</script></body></html>');
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    var stats = getProtocolStats();
    return res.end(JSON.stringify({ status: connectionStatus, ai: GROQ_API_KEY ? "active" : "disabled", protocolos_total: stats.total, protocolos_hoje: stats.today }));
  }
  if (url.pathname === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    var stats2 = getProtocolStats();
    var data = loadProtocols();
    return res.end(JSON.stringify({ total: stats2.total, hoje: stats2.today, mensagens_hoje: stats2.todayMsgs, sessoes: data.sessions }));
  }
  // ========== ADMIN WEB: gerenciar contatos ignorados ==========
  if (url.pathname === "/admin/ignorados") {
    var lista = Array.from(IGNORED_CONTACTS);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ total: lista.length, contatos: lista }, null, 2));
  }
  if (url.pathname === "/admin/ignorar") {
    var num = url.searchParams.get("num");
    if (num) {
      var cleanNum = num.replace(/[^0-9]/g, "");
      // Detectar se é @lid (input contém "lid") ou número de telefone normal
      var isLid = num.toLowerCase().indexOf("lid") !== -1;
      if (isLid) {
        IGNORED_CONTACTS.add(cleanNum + "@lid");
      } else {
        // Adicionar ambos formatos para máxima segurança
        IGNORED_CONTACTS.add(cleanNum + "@s.whatsapp.net");
        IGNORED_CONTACTS.add(cleanNum + "@lid");
      }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, adicionado: num }));
  }
  if (url.pathname === "/admin/designorar") {
    var num3 = url.searchParams.get("num");
    if (num3) {
      var cn3 = num3.replace(/[^0-9]/g, "");
      IGNORED_CONTACTS.delete(cn3 + "@s.whatsapp.net");
      IGNORED_CONTACTS.delete(cn3 + "@lid");
      IGNORED_CONTACTS.delete(cn3);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, removido: num3 }));
  }
  // ========== ADMIN WEB: pausa humana ==========
  if (url.pathname === "/admin/pausados") {
    var pausados = [];
    var agora = Date.now();
    humanTakeover.forEach(function(ts, jid) {
      if ((agora - ts) < 7200000) {
        var min = Math.round((agora - ts) / 60000);
        pausados.push({ numero: jid.replace("@s.whatsapp.net", ""), minutos: min });
      }
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ total: pausados.length, contatos: pausados }, null, 2));
  }
  if (url.pathname === "/admin/retomar") {
    var numRet = url.searchParams.get("num");
    if (numRet) { humanTakeover.delete(numRet.replace(/[^0-9]/g, "") + "@s.whatsapp.net"); }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, retomado: numRet }));
  }
  // ========== ENVIO INDIVIDUAL (form + POST) ==========
  if (url.pathname === "/admin/enviar-um") {
    var html = "<!DOCTYPE html><html><head><meta charset=UTF-8><title>Envio Individual</title>" +
      "<style>body{font-family:sans-serif;max-width:600px;margin:24px auto;padding:16px;background:#f7f7f9}h1{color:#0a5}input,textarea{width:100%;padding:10px;margin:6px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font-size:15px}textarea{min-height:200px}button{background:#0a5;color:#fff;padding:14px 24px;border:none;border-radius:6px;font-size:16px;cursor:pointer;margin-top:12px}</style></head><body>" +
      "<h1>📩 Enviar mensagem individual</h1>" +
      "<form method=POST action='/admin/enviar-um-exec'>" +
      "<label>Numero (formato 5537988244336):<input name=numero required></label>" +
      "<label>Mensagem:<textarea name=mensagem required></textarea></label>" +
      "<label>Senha:<input type=password name=senha required></label>" +
      "<button type=submit>📨 Enviar</button>" +
      "</form></body></html>";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }
  if (url.pathname === "/admin/enviar-um-exec" && req.method === "POST") {
    var body2 = "";
    req.on("data", function(chunk){ body2 += chunk.toString(); });
    req.on("end", async function() {
      var params = new URLSearchParams(body2);
      var numero = (params.get("numero") || "").replace(/[^0-9]/g, "");
      var mensagem = params.get("mensagem") || "";
      var senha = params.get("senha") || "";
      if (senha !== "adr2026") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<h1 style='color:red;font-family:sans-serif'>Senha invalida</h1>");
      }
      if (!sock || !sock.user) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<h1 style='color:red;font-family:sans-serif'>WhatsApp desconectado</h1>");
      }
      try {
        var jid = numero + "@s.whatsapp.net";
        await sock.sendMessage(jid, { text: mensagem });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h1 style='color:#0a5'>✅ Enviado!</h1><p>Para: " + numero + "</p><p><a href='/admin/enviar-um'>Enviar outra</a></p></body></html>");
      } catch (e) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h1 style='color:#c00'>❌ Falha</h1><p>" + String(e && e.message || e) + "</p></body></html>");
      }
    });
    return;
  }
  // ========== BROADCAST: formulario visual ==========
  if (url.pathname === "/admin/broadcast") {
    var clientes = carregarClientes();
    var listaHtml = clientes.map(function(c){ return "<li>" + c.nome + " - " + (c.empresa||"") + " (" + c.numero + ")</li>"; }).join("");
    var html = "<!DOCTYPE html><html lang=pt-BR><head><meta charset=UTF-8><title>ADR - Disparo em Massa</title>" +
      "<meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<style>body{font-family:system-ui,sans-serif;max-width:700px;margin:24px auto;padding:0 16px;background:#f7f7f9;color:#222}h1{color:#0a5}h2{margin-top:32px}textarea{width:100%;min-height:180px;padding:12px;font-size:15px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}input[type=password]{padding:10px;border:1px solid #ccc;border-radius:6px;width:200px}button{background:#0a5;color:#fff;border:none;padding:14px 28px;font-size:16px;border-radius:6px;cursor:pointer;margin-top:12px}button:hover{background:#083}.aviso{background:#fff8dc;border-left:4px solid #d90;padding:10px 14px;margin:16px 0;border-radius:4px}ul{background:#fff;padding:12px 12px 12px 32px;border-radius:6px}.exemplo{background:#eef;padding:10px;border-radius:4px;font-family:monospace;font-size:13px;white-space:pre-wrap}</style></head><body>" +
      "<h1>📢 Disparo em Massa - ADR Contabilidade</h1>" +
      "<div class=aviso><strong>⚠️ Cuidados:</strong><br>• Envie no maximo 1x por semana<br>• Nao envie ofertas ou spam<br>• Personalize com {nome}, {empresa} e {regime}<br>• Envio leva ~20-40s entre cada cliente (evita banimento)</div>" +
      "<h2>Clientes ativos (" + clientes.length + ")</h2><ul>" + listaHtml + "</ul>" +
      "<h2>Mensagem</h2>" +
      "<p>Variaveis disponiveis: <code>{nome}</code>, <code>{empresa}</code>, <code>{regime}</code></p>" +
      "<div class=exemplo>Exemplo:\nOla {nome}! Da {empresa}.\n\nLembramos que a data de vencimento do DAS ({regime}) do mes eh dia 20.\n\nATT, Adenilson Ribeiro - ADR Contabilidade</div>" +
      "<form method=POST action='/admin/broadcast-enviar' style='margin-top:16px'>" +
      "<textarea name=mensagem placeholder='Digite a mensagem aqui...' required></textarea><br>" +
      "<label>Senha: <input type=password name=senha required></label><br>" +
      "<button type=submit>🚀 DISPARAR PARA " + clientes.length + " CLIENTES</button>" +
      "</form>" +
      "<p style='margin-top:24px'><a href='/admin/broadcast-status'>Ver status do ultimo disparo</a></p>" +
      "</body></html>";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // ========== BROADCAST: executar ==========
  if (url.pathname === "/admin/broadcast-enviar" && req.method === "POST") {
    var body = "";
    req.on("data", function(chunk){ body += chunk.toString(); });
    req.on("end", async function() {
      var params = new URLSearchParams(body);
      var mensagem = params.get("mensagem") || "";
      var senha = params.get("senha") || "";
      var resultado = await dispararBroadcast(mensagem, senha);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      var cor = resultado.ok ? "#0a5" : "#c00";
      res.end("<html><body style='font-family:sans-serif;text-align:center;padding:40px'><h1 style='color:" + cor + "'>" + (resultado.ok ? "✅ Disparo iniciado" : "❌ Erro") + "</h1><p>" + (resultado.msg || resultado.erro) + "</p><p><a href='/admin/broadcast-status'>Acompanhar status</a> | <a href='/admin/broadcast'>Voltar</a></p></body></html>");
    });
    return;
  }

  // ========== BROADCAST: status ==========
  if (url.pathname === "/admin/broadcast-status") {
    var html = "<!DOCTYPE html><html><head><meta charset=UTF-8><title>Status</title>" +
      "<meta http-equiv=refresh content=5><style>body{font-family:sans-serif;max-width:600px;margin:24px auto;padding:16px}.stat{background:#eef;padding:16px;border-radius:6px;margin:10px 0}</style></head><body>" +
      "<h1>Status do Disparo</h1>" +
      "<div class=stat><strong>Rodando:</strong> " + (broadcastStatus.running ? "SIM" : "NAO") + "</div>" +
      "<div class=stat><strong>Enviados:</strong> " + broadcastStatus.sent + " / " + broadcastStatus.total + "</div>" +
      "<div class=stat><strong>Falhas:</strong> " + broadcastStatus.failed + "</div>" +
      "<div class=stat><strong>Iniciado:</strong> " + (broadcastStatus.iniciadoEm || "nunca") + "</div>" +
      "<div class=stat><strong>Terminado:</strong> " + (broadcastStatus.terminadoEm || "em andamento") + "</div>" +
      "<div class=stat><strong>Ultima mensagem:</strong> " + (broadcastStatus.ultimaMsg || "-") + "</div>" +
      (broadcastStatus.erros.length ? "<div class=stat><strong>Erros:</strong><ul>" + broadcastStatus.erros.map(function(e){return "<li>"+e.nome+": "+e.erro+"</li>";}).join("") + "</ul></div>" : "") +
      "<p><a href='/admin/broadcast'>Novo disparo</a></p>" +
      (broadcastStatus.running ? "<p style=color:#888>Atualizando a cada 5s...</p>" : "") +
      "</body></html>";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // ========== ADMIN: gerar codigo de pareamento (8 digitos) ==========
  if (url.pathname === "/admin/pairing-code") {
    (async function() {
      try {
        if (!sock || !sock.authState || sock.authState.creds.registered) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, erro: "Ja registrado ou socket indisponivel. Faca /admin/reset-session primeiro." }));
        }
        var numero = (url.searchParams.get("num") || "5537988075561").replace(/[^0-9]/g, "");
        var code = await sock.requestPairingCode(numero);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, numero: numero, codigo: code, msg: "No WhatsApp: Aparelhos conectados > Conectar um aparelho > Conectar com numero de telefone. Digite o codigo." }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, erro: String(e && e.message || e) }));
      }
    })();
    return;
  }
  // ========== ADMIN: reset completo da sessao WhatsApp ==========
  if (url.pathname === "/admin/reset-session") {
    try {
      // fecha socket ativo se houver
      try { if (sock && sock.end) sock.end(); } catch(e){}
      try { if (sock && sock.ws && sock.ws.close) sock.ws.close(); } catch(e){}
      // apaga arquivo por arquivo (folder pode estar em uso)
      var apagados = 0;
      if (fs.existsSync(AUTH_DIR)) {
        var arquivos = fs.readdirSync(AUTH_DIR);
        for (var i = 0; i < arquivos.length; i++) {
          try { fs.unlinkSync(path.join(AUTH_DIR, arquivos[i])); apagados++; } catch(e){}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, arquivos_apagados: apagados, msg: "Sessao limpa. Servidor sera reiniciado em 2s." }));
      setTimeout(function() { process.exit(0); }, 2000);
      return;
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, erro: String(e) }));
    }
  }
  if (url.pathname === "/webhook" && req.method === "GET") {
    var p = url.searchParams;
    if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === "adr_contabil_webhook_2026") {
      res.writeHead(200); return res.end(p.get("hub.challenge"));
    }
  }
  res.writeHead(200); res.end("OK");
}).listen(PORT, function() {
  console.log("Porta " + PORT + " | IA: " + (GROQ_API_KEY ? "ON" : "OFF"));
  startBot();

  // ========== KEEP ALIVE (impedir Render de dormir) ==========
  setInterval(function() {
    http.get("http://localhost:" + PORT + "/health", function(res) {
      var d = "";
      res.on("data", function(c) { d += c; });
      res.on("end", function() { console.log("Keep alive: " + d); });
    }).on("error", function() {});
  }, 840000); // 14 minutos
});
