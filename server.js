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

// ========== SAUDACAO INTELIGENTE ==========
function getSaudacao() {
  const hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false });
  const h = parseInt(hora);
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

// ========== MENU E RESPOSTAS ==========
function getMenu() {
  return getSaudacao() + `! Seja bem-vindo(a). 

Sou *Adenilson Ribeiro*, profissional nas areas de Advocacia, Contabilidade, Pericia e Administracao Judicial.

Selecione o servico desejado:

1 Advocacia e Consultoria Juridica
2 Contabilidade e Impostos
3 Pericia Contabil e Judicial
4 IRPF - Imposto de Renda
5 Certidoes e Documentos
6 Agendar Consulta
7 Falar com Adenilson

Digite o *numero* da opcao ou descreva o que precisa.`;
}

const RESPONSES = {
  "1": `*Advocacia e Consultoria Juridica*

Areas de atuacao:
- Direito Civil e Empresarial
- Direito Trabalhista
- Direito Tributario
- Elaboracao de Contratos e Pareceres
- Consultoria Juridica Preventiva

OAB/MG 218.018

_Para agendar uma consulta, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*`,

  "2": `*Contabilidade e Impostos*

Servicos disponiveis:
- Abertura e Encerramento de Empresas
- Escrituracao Contabil e Fiscal
- Balancos e Demonstracoes Financeiras
- Obrigacoes Acessorias (SPED, DCTF, EFD)
- Planejamento Tributario
- MEI, Simples Nacional, Lucro Presumido e Real

CRC/MG 111.185

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*`,

  "3": `*Pericia Contabil e Judicial*

Formas de atuacao:
- Perito Judicial nomeado pelo Juizo
- Assistente Tecnico das partes
- Pericia Extrajudicial
- Elaboracao de Laudos Periciais Contabeis
- Calculos Judiciais e Trabalhistas

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*`,

  "4": `*IRPF - Imposto de Renda*

Servicos disponiveis:
- Declaracao Completa e Simplificada
- Retificacao de Declaracoes anteriores
- Regularizacao de Malha Fina
- Carne-Leao
- Apuracao de Ganho de Capital
- Planejamento para a proxima declaracao

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*`,

  "5": `*Certidoes e Documentos*

Emissao e assessoria:
- Certidao Negativa de Debitos (CND)
- Certidao de Regularidade Fiscal
- Certidao de Regularidade do FGTS
- Certidoes da Justica Federal e Estadual
- Documentacao para Licitacoes e Contratos

_Para agendar, digite_ *6*
_Para voltar ao menu principal, digite_ *menu*`,

  "6": `*Agendamento de Consulta*

Para agendar, envie as seguintes informacoes:

- Seu *nome completo*
- *Assunto* (advocacia, contabilidade, pericia ou IRPF)
- *Data e horario* de sua preferencia

*Atendimento:* segunda a sexta, das 8h as 18h
*Endereco:* Sao Cristovao - MG
*Telefone:* (37) 98807-5561
*Site:* www.adenilsonribeiro.top

Assim que receber seus dados, entrarei em contato para confirmar.`,

  "7": `*Atendimento Humano*

Sua mensagem foi encaminhada para *Adenilson Ribeiro*.
Responderemos o mais breve possivel.

*Horario de atendimento:* segunda a sexta, das 8h as 18h
*Telefone:* (37) 98807-5561
*Site:* www.adenilsonribeiro.top

Agradecemos o seu contato e a sua paciencia.`
};

const KEYWORDS = {
  menu: "menu", oi: "menu", ola: "menu", inicio: "menu",
  hi: "menu", hello: "menu", "bom dia": "menu", "boa tarde": "menu", "boa noite": "menu",
  obrigado: "menu", obrigada: "menu",
  advocacia: "1", advogado: "1", juridico: "1", direito: "1", processo: "1",
  contabilidade: "2", contador: "2", imposto: "2", impostos: "2", fiscal: "2", empresa: "2", mei: "2",
  pericia: "3", perito: "3", laudo: "3", calculo: "3",
  irpf: "4", "imposto de renda": "4", declaracao: "4", malha: "4", renda: "4",
  certidao: "5", cnd: "5", documento: "5", licitacao: "5",
  agendar: "6", agendamento: "6", consulta: "6", marcar: "6", horario: "6",
  atendente: "7", humano: "7", pessoa: "7", falar: "7", adenilson: "7"
};

// ========== RESPOSTA PADRAO (SEM IA) ==========
function getFallback() {
  return `Obrigado pela sua mensagem.

Nao consegui identificar o servico desejado. Por favor, digite o *numero* de uma das opcoes abaixo:

1 Advocacia e Consultoria Juridica
2 Contabilidade e Impostos
3 Pericia Contabil e Judicial
4 IRPF - Imposto de Renda
5 Certidoes e Documentos
6 Agendar Consulta
7 Falar com Adenilson

Ou descreva o que precisa com mais detalhes.`;
}

// ========== INTELIGENCIA ARTIFICIAL (GROQ - GRATUITO) ==========
const SYSTEM_PROMPT = "Voce e o assistente virtual de Adenilson Ribeiro, profissional nas areas de Advocacia (OAB/MG 218.018), Contabilidade (CRC/MG 111.185), Pericia Judicial e Extrajudicial, e Administracao Judicial. Regras: Responda sempre em portugues brasileiro correto e formal, mas acolhedor. Seja breve e objetivo (maximo 3 paragrafos curtos). Use *negrito* para destaques importantes (formato WhatsApp). Nao invente informacoes juridicas ou contabeis especificas. Quando o assunto exigir analise detalhada, oriente o cliente a agendar uma consulta. Sempre que possivel, direcione para agendar consulta (opcao 6) ou falar com Adenilson (opcao 7). Horario de atendimento: segunda a sexta, das 8h as 18h. Endereco: Sao Cristovao - MG. Telefone: (37) 98807-5561. Site: www.adenilsonribeiro.top. Nao forneca precos nem valores de honorarios. Se o cliente perguntar algo fora das areas de atuacao, responda educadamente que o escritorio atua nas areas mencionadas e sugira que descreva melhor sua necessidade.";

const conversationHistory = new Map();
const HISTORY_TTL = 30 * 60 * 1000;

function getHistory(from) {
  const entry = conversationHistory.get(from);
  if (entry && (Date.now() - entry.lastUpdate) < HISTORY_TTL) {
    return entry.messages;
  }
  conversationHistory.set(from, { messages: [], lastUpdate: Date.now() });
  return [];
}

function addToHistory(from, role, content) {
  const entry = conversationHistory.get(from) || { messages: [], lastUpdate: Date.now() };
  entry.messages.push({ role, content });
  if (entry.messages.length > 10) entry.messages = entry.messages.slice(-10);
  entry.lastUpdate = Date.now();
  conversationHistory.set(from, entry);
}

function askAI(userMessage, from) {
  return new Promise((resolve, reject) => {
    const history = getHistory(from);
    addToHistory(from, "user", userMessage);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
    ];
    const postData = JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });
    const options = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            const aiResponse = json.choices[0].message.content;
            addToHistory(from, "assistant", aiResponse);
            resolve(aiResponse);
          } else {
            console.error("Resposta inesperada da IA:", data);
            reject(new Error("Resposta invalida da IA"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Timeout na requisicao da IA"));
    });
    req.write(postData);
    req.end();
  });
}

// ========== QR CODE STATE ==========
let latestQR = null;
let connectionStatus = "disconnected";
let sock = null;

// ========== DEDUPLICATION ==========
const processedMessages = new Set();
const MSG_CACHE_TTL = 120000;
function wasProcessed(msgId) {
  if (processedMessages.has(msgId)) return true;
  processedMessages.add(msgId);
  setTimeout(() => processedMessages.delete(msgId), MSG_CACHE_TTL);
  return false;
}

// ========== BAILEYS CONNECTION ==========
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "silent" }),
    browser: ["ADR Contabilidade", "Chrome", "1.0.0"],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      connectionStatus = "waiting_qr";
      console.log("QR Code gerado - acesse a pagina web para escanear");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Conexao fechada. Status: " + statusCode + ". Reconectar: " + shouldReconnect);
      connectionStatus = "disconnected";
      
      if (shouldReconnect) {
        setTimeout(() => startBot(), 5000);
      } else {
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true });
        }
        latestQR = null;
        setTimeout(() => startBot(), 3000);
      }
    }

    if (connection === "open") {
      connectionStatus = "connected";
      latestQR = null;
      console.log("Bot conectado ao WhatsApp com sucesso!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.remoteJid.endsWith("@g.us")) continue;

      const msgId = msg.key.id;
      if (wasProcessed(msgId)) {
        console.log("Mensagem duplicada ignorada: " + msgId);
        continue;
      }

      const msgTimestamp = msg.messageTimestamp;
      if (msgTimestamp && (Date.now() / 1000 - msgTimestamp) > 60) {
        console.log("Mensagem antiga ignorada: " + msgId);
        continue;
      }

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || "";

      if (!text) continue;

      const from = msg.key.remoteJid;
      const cleanText = text.trim().toLowerCase();
      console.log("<< De " + from + ": " + cleanText);

      let response = null;

      const numKey = cleanText.replace(/[^0-9]/g, "");
      if (RESPONSES[numKey]) {
        response = RESPONSES[numKey];
      }

      if (!response) {
        for (const [keyword, optionKey] of Object.entries(KEYWORDS)) {
          if (cleanText.includes(keyword)) {
            if (optionKey === "menu") {
              response = getMenu();
            } else {
              response = RESPONSES[optionKey];
            }
            break;
          }
        }
      }

      if (!response) {
        if (GROQ_API_KEY) {
          try {
            response = await askAI(cleanText, from);
          } catch (err) {
            console.error("Erro na IA:", err.message);
            response = getFallback();
          }
        } else {
          response = getFallback();
        }
      }

      try {
        await sock.sendMessage(from, { text: response });
        console.log(">> Enviado para " + from);
      } catch (err) {
        console.error("Erro ao enviar para " + from + ":", err.message);
      }

      if (numKey === "7" || cleanText.includes("atendente") || cleanText.includes("humano")) {
        try {
          const clientNumber = from.replace("@s.whatsapp.net", "");
          await sock.sendMessage("5537999521810@s.whatsapp.net", {
            text: "*Novo cliente solicitou atendente!*\n\nNumero: +" + clientNumber + "\nMensagem: " + text + "\nHorario: " + new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          });
        } catch (e) {
          console.error("Erro ao notificar:", e.message);
        }
      }
    }
  });
}

// ========== HTTP SERVER ==========
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);

  if (url.pathname === "/" || url.pathname === "/qr") {
    if (connectionStatus === "connected") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ADR Bot - Conectado</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;background:#e8f5e9;}h1{color:#2e7d32;}p{font-size:18px;}</style></head><body><h1>Bot Conectado!</h1><p>O bot esta funcionando no WhatsApp.</p><p>Numero: (37) 98807-5561</p><p>IA: ' + (GROQ_API_KEY ? 'Ativada' : 'Desativada') + '</p><p><small>Ultima atualizacao: ' + new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + '</small></p><script>setTimeout(function(){location.reload()}, 30000);</script></body></html>');
    }

    if (latestQR) {
      try {
        const qrDataUrl = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ADR Bot - Conectar</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:20px;background:#fff3e0;}h1{color:#e65100;}img{border:3px solid #333;border-radius:10px;margin:20px;}.steps{text-align:left;max-width:400px;margin:0 auto;background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1);}.steps li{margin:10px 0;font-size:16px;}</style></head><body><h1>Conectar WhatsApp ao Bot</h1><p><strong>Escaneie o QR Code abaixo com seu WhatsApp Business App:</strong></p><img src="' + qrDataUrl + '" alt="QR Code" /><div class="steps"><ol><li>Abra o <strong>WhatsApp Business</strong> no celular (37) 98807-5561</li><li>Toque em <strong>Menu</strong> (3 pontinhos) > <strong>Dispositivos conectados</strong></li><li>Toque em <strong>Conectar dispositivo</strong></li><li>Escaneie este QR Code</li></ol></div><p><small>O QR Code atualiza automaticamente.</small></p><script>setTimeout(function(){location.reload()}, 20000);</script></body></html>');
      } catch (err) {
        res.writeHead(500);
        return res.end("Erro ao gerar QR Code");
      }
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ADR Bot - Aguardando</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;background:#e3f2fd;}h1{color:#1565c0;}</style></head><body><h1>Aguardando QR Code...</h1><p>O bot esta iniciando. O QR Code aparecera em instantes.</p><script>setTimeout(function(){location.reload()}, 5000);</script></body></html>');
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: connectionStatus, ai: GROQ_API_KEY ? "active" : "disabled", time: new Date().toISOString() }));
  }

  if (url.pathname === "/webhook") {
    if (req.method === "GET") {
      const params = url.searchParams;
      const mode = params.get("hub.mode");
      const token = params.get("hub.verify_token");
      const challenge = params.get("hub.challenge");
      if (mode === "subscribe" && token === "adr_contabil_webhook_2026") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end(challenge);
      }
    }
    res.writeHead(200);
    return res.end("OK");
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
  console.log("IA Groq: " + (GROQ_API_KEY ? "ATIVADA" : "DESATIVADA - configure GROQ_API_KEY"));
  startBot();
});
