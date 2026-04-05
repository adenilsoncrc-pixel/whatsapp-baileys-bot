const http = require("http");
const https = require("https");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, "auth_info");
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

📲 Siga no Instagram: instagram.com/adenilsonribeiro.top`;

// ========== MENU E RESPOSTAS ==========
function getMenu() {
  return getSaudacao() + `! Seja bem-vindo(a). 😊

Sou *Adenilson Ribeiro* e este é o meu *Escritório Digital*, com atuação nas áreas de Advocacia, Contabilidade, Perícia, Administração Judicial e Diligências.

📋 *Selecione o serviço desejado:*

1️⃣ Advocacia e Consultoria Jurídica
2️⃣ Contabilidade e Impostos
3️⃣ Perícia Contábil e Judicial
4️⃣ IRPF – Imposto de Renda
5️⃣ Certidões e Documentos
6️⃣ Agendar Consulta
7️⃣ Falar com Adenilson
8️⃣ Diligências para Empresas e Profissionais

Digite o *número* da opção ou descreva o que precisa.
Você também pode fazer perguntas livremente que nossa IA responderá.

_Para encerrar o atendimento, digite_ *0* _ou_ *encerrar*` + FOOTER;
}

const RESPONSES = {
  "1": `⚖️ *Advocacia e Consultoria Jurídica*

Áreas de atuação:
• Direito Civil e Empresarial
• Direito Trabalhista
• Direito Tributário
• Elaboração de Contratos e Pareceres
• Consultoria Jurídica Preventiva

📌 OAB/MG 218.018

_Para agendar uma consulta, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "2": `📊 *Contabilidade e Impostos*

Serviços disponíveis:
• Abertura e Encerramento de Empresas
• Escrituração Contábil e Fiscal
• Balanços e Demonstrações Financeiras
• Obrigações Acessórias (SPED, DCTF, EFD)
• Planejamento Tributário
• MEI, Simples Nacional, Lucro Presumido e Real

📌 CRC/MG 111.185

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "3": `🔍 *Perícia Contábil e Judicial*

Formas de atuação:
• Perito Judicial nomeado pelo Juízo
• Assistente Técnico das partes
• Perícia Extrajudicial
• Elaboração de Laudos Periciais Contábeis
• Cálculos Judiciais e Trabalhistas

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "4": `💰 *IRPF – Imposto de Renda*

Serviços disponíveis:
• Declaração Completa e Simplificada
• Retificação de Declarações anteriores
• Regularização de Malha Fina
• Carnê-Leão
• Apuração de Ganho de Capital
• Planejamento para a próxima declaração

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "5": `📄 *Certidões e Documentos*

Emissão e assessoria:
• Certidão Negativa de Débitos (CND)
• Certidão de Regularidade Fiscal
• Certidão de Regularidade do FGTS
• Certidões da Justiça Federal e Estadual
• Documentação para Licitações e Contratos

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER,

  "6": `📅 *Agendamento de Consulta*

Para agendar, envie as seguintes informações:

• Seu *nome completo*
• *Assunto* (advocacia, contabilidade, perícia ou IRPF)
• *Data e horário* de sua preferência

🕐 *Atendimento:* segunda a sexta, das 8h às 18h
💻 *Modalidade:* atendimento online (todo o Brasil)
📞 *Telefone/WhatsApp:* (37) 98807-5561
🌐 *Site:* www.adenilsonribeiro.top

Assim que receber seus dados, entrarei em contato para confirmar.` + FOOTER,

  "7": `📞 *Atendimento Humano*

Sua mensagem foi encaminhada para *Adenilson Ribeiro*.
Responderemos o mais breve possível.

🕐 *Horário de atendimento:* segunda a sexta, das 8h às 18h
📞 *Telefone:* (37) 98807-5561
🌐 *Site:* www.adenilsonribeiro.top

Agradecemos o seu contato e a sua paciência.` + FOOTER,

  "8": `📍 *Diligências para Empresas e Profissionais*

Serviços disponíveis:
• Diligências em Órgãos Públicos (Receita Federal, INSS, Juntas Comerciais)
• Protocolo e Acompanhamento de Processos
• Obtenção de Certidões e Documentos
• Representação junto a Órgãos Reguladores
• Diligências Cartórias e Judiciais
• Atendimento para Empresas e Profissionais de todo o Brasil

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*` + FOOTER
};

const KEYWORDS = {
  menu: "menu", oi: "menu", ola: "menu", "olá": "menu", inicio: "menu", "início": "menu",
  hi: "menu", hello: "menu", "bom dia": "menu", "boa tarde": "menu", "boa noite": "menu",
  advocacia: "1", advogado: "1", juridico: "1", "jurídico": "1",
  contabilidade: "2", contador: "2", contabil: "2", "contábil": "2", mei: "2",
  pericia: "3", "perícia": "3", perito: "3", laudo: "3",
  irpf: "4", "imposto de renda": "4", declaracao: "4", "declaração": "4", "malha fina": "4",
  certidao: "5", "certidão": "5", cnd: "5", licitacao: "5", "licitação": "5",
  agendar: "6", agendamento: "6", "marcar consulta": "6", "marcar horário": "6",
  atendente: "7", "falar com adenilson": "7", "falar com alguem": "7", "falar com alguém": "7",
  "diligência": "8", "diligências": "8", diligencia: "8", diligencias: "8"
};

// ========== RESPOSTA PADRÃO (SEM IA) ==========
function getFallback() {
  return `Obrigado pela sua mensagem.

Não consegui identificar o serviço desejado. Por favor, digite o *número* de uma das opções abaixo:

1️⃣ Advocacia e Consultoria Jurídica
2️⃣ Contabilidade e Impostos
3️⃣ Perícia Contábil e Judicial
4️⃣ IRPF – Imposto de Renda
5️⃣ Certidões e Documentos
6️⃣ Agendar Consulta
7️⃣ Falar com Adenilson
8️⃣ Diligências

Ou descreva o que precisa com mais detalhes.` + FOOTER;
}

// ========== INTELIGÊNCIA ARTIFICIAL (GROQ) ==========
const SYSTEM_PROMPT = "Você é o assistente virtual do Escritório Digital Adenilson Ribeiro. Adenilson é um profissional individual (não tem equipe) que atua nas áreas de Advocacia (OAB/MG 218.018), Contabilidade (CRC/MG 111.185), Perícia Judicial e Extrajudicial, Administração Judicial e Diligências para Empresas e Profissionais. Regras: Responda sempre em português brasileiro correto e formal, mas acolhedor. Seja breve e objetivo (máximo 2 parágrafos curtos). Use *negrito* para destaques (formato WhatsApp, sempre abrir e fechar com um único asterisco, exemplo: *texto*). Nunca diga 'nossa equipe' — use 'eu' ou 'Adenilson Ribeiro'. Não invente informações jurídicas ou contábeis específicas. Quando o assunto exigir análise detalhada, oriente a agendar consulta (opção 6). Horário: segunda a sexta, 8h às 18h. Prazo de resposta: até 24 horas. Atendimento online para todo o Brasil. Telefone: (37) 98807-5561. Site: www.adenilsonribeiro.top. Instagram: instagram.com/adenilsonribeiro.top. Não forneça preços nem honorários — diga que são tratados de forma personalizada e sugira agendar consulta. Se o cliente perguntar algo fora das áreas de atuação, diga educadamente que o escritório atua nas áreas mencionadas.";

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
    version: ver.version, auth: auth.state, printQRInTerminal: true,
    logger: pino({ level: "silent" }), browser: ["ADR Contabilidade", "Chrome", "1.0.0"],
    connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0, keepAliveIntervalMs: 30000, markOnlineOnConnect: true
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
      if (msg.key.fromMe || msg.key.remoteJid === "status@broadcast" || msg.key.remoteJid.endsWith("@g.us")) continue;
      if (wasSeen(msg.key.id)) continue;
      if (msg.messageTimestamp && (Date.now() / 1000 - msg.messageTimestamp) > 60) continue;
      if (isFlood(msg.key.remoteJid)) continue;

      var text = "";
      if (msg.message) text = msg.message.conversation || (msg.message.extendedTextMessage ? msg.message.extendedTextMessage.text : "") || "";
      if (!text) continue;

      var from = msg.key.remoteJid;
      var clean = text.trim().toLowerCase();
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
          try { await sock.sendMessage(from, { text: response }); } catch (e) {}
          continue;
        } else {
          response = `Por favor, digite uma nota de *1* a *5* para avaliar o atendimento:

1️⃣ Péssimo
2️⃣ Ruim
3️⃣ Regular
4️⃣ Bom
5️⃣ Excelente`;
          try { await sock.sendMessage(from, { text: response }); } catch (e) {}
          continue;
        }
      }

      // Registrar protocolo
      var proto = getProtocol(from);

      // Comando admin: relatório de protocolos
      if (clean === "!protocolos" && from === "5537988075561@s.whatsapp.net") {
        var stats = getProtocolStats();
        response = `📊 *Relatório de Protocolos (ISO 9001)*

• Total de atendimentos: ${stats.total}
• Atendimentos hoje: ${stats.today}
• Mensagens hoje: ${stats.todayMsgs}
• Protocolos abertos: ${stats.abertos}
• Protocolos encerrados: ${stats.encerrados}
• Nota média de satisfação: ${stats.avgRating} (${stats.ratingCount} avaliações)`;
        try { await sock.sendMessage(from, { text: response }); } catch (e) {}
        continue;
      }

      // Comando admin: relatório de satisfação detalhado
      if (clean === "!satisfacao" && from === "5537988075561@s.whatsapp.net") {
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
        try { await sock.sendMessage(from, { text: txt }); } catch (e) {}
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
          try { await sock.sendMessage(from, { text: response }); } catch (e) {}
          continue;
        }
      }

      var numKey = clean.replace(/[^0-9]/g, "");
      if (RESPONSES[numKey]) response = RESPONSES[numKey];

      if (!response) {
        var kw = Object.entries(KEYWORDS);
        for (var k = 0; k < kw.length; k++) {
          if (clean.includes(kw[k][0])) { response = kw[k][1] === "menu" ? getMenu() : RESPONSES[kw[k][1]]; break; }
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

      try { await sock.sendMessage(from, { text: response }); } catch (e) { console.error("Erro:", e.message); }

      if (numKey === "7" || clean.includes("atendente") || clean.includes("humano")) {
        try {
          var cn = from.replace("@s.whatsapp.net", "");
          await sock.sendMessage("5537999521810@s.whatsapp.net", {
            text: `🔔 *Novo cliente solicitou atendente!*

Número: +${cn}
Protocolo: ${proto.protocol}
Mensagem: ${text}
Horário: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          });
        } catch (e) {}
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
