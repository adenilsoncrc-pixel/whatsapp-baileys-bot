const http = require("http");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, "auth_info");

// ========== MENU E RESPOSTAS ==========
const MENU = `Olá! Seja bem-vindo(a) à *A.D.R. Contabilidade e Perícias Contábeis*.

Sou *ADENILSON DIAS RIBEIRO*, profissional habilitado nas áreas:

⚖️ *Advocacia* – OAB/MG 218018
📊 *Contabilidade* – CRC/MG 111185
🔍 *Perícia Judicial e Extrajudicial*
💼 *Administração Judicial*

Como posso ajudá-lo(a)? Escolha uma opção:

1️⃣ Advocacia e Consultoria Jurídica
2️⃣ Contabilidade e Impostos
3️⃣ Perícia Contábil / Judicial
4️⃣ IRPF - Imposto de Renda
5️⃣ Certidões e Documentos
6️⃣ Agendamento de Consulta
7️⃣ Falar com atendente

Ou descreva sua necessidade que tentaremos ajudar!`;

const RESPONSES = {
  "1": `⚖️ *Advocacia e Consultoria Jurídica*

Oferecemos serviços em:
• Direito Civil e Empresarial
• Direito Trabalhista
• Direito Tributário
• Contratos e Pareceres
• Consultoria Preventiva

OAB/MG 218018

Para agendar uma consulta, digite *6*
Para voltar ao menu, digite *menu*`,

  "2": `📊 *Contabilidade e Impostos*

Serviços contábeis:
• Abertura e Encerramento de Empresas
• Escrituração Contábil e Fiscal
• Balanços e Demonstrações
• Obrigações Acessórias (SPED, DCTF, etc.)
• Planejamento Tributário
• MEI, Simples Nacional, Lucro Presumido

CRC/MG 111185

Para agendar, digite *6*
Para voltar ao menu, digite *menu*`,

  "3": `🔍 *Perícia Contábil / Judicial*

Atuação como:
• Perito Judicial nomeado pelo Juízo
• Perito Assistente (assistente técnico)
• Perícia Extrajudicial
• Laudo Pericial Contábil
• Cálculos Judiciais e Trabalhistas

Para agendar, digite *6*
Para voltar ao menu, digite *menu*`,

  "4": `💰 *IRPF - Imposto de Renda*

Serviços de IRPF:
• Declaração Completa e Simplificada
• Retificação de Declarações
• Malha Fina - Regularização
• Carnê-Leão
• Ganho de Capital
• Planejamento para próxima declaração

Para agendar, digite *6*
Para voltar ao menu, digite *menu*`,

  "5": `📄 *Certidões e Documentos*

Emitimos e auxiliamos com:
• Certidão Negativa de Débitos (CND)
• Certidão de Regularidade Fiscal
• Certidão FGTS
• Certidão da Justiça Federal/Estadual
• Documentos para Licitações

Para agendar, digite *6*
Para voltar ao menu, digite *menu*`,

  "6": `📅 *Agendamento de Consulta*

Para agendar, informe:
• Seu *nome completo*
• *Assunto* da consulta (advocacia, contabilidade, perícia, IRPF)
• *Dia e horário* de preferência

🕒 *Horário de atendimento:*
Segunda a Sexta: 8h às 18h

📍 *Localização:* São Cristóvão - MG

Ou ligue: (37) 98807-5561

Retornaremos o mais breve possível!`,

  "7": `📞 *Falar com Atendente*

Vou encaminhar você para atendimento humano.
Por favor, aguarde que responderemos em breve.

Horário: Segunda a Sexta, 8h às 18h
Telefone: (37) 98807-5561

Obrigado pela paciência!`
};

const KEYWORDS = {
  menu: "menu", oi: "menu", ola: "menu", olá: "menu", inicio: "menu",
  hi: "menu", hello: "menu", "bom dia": "menu", "boa tarde": "menu", "boa noite": "menu",
  advocacia: "1", advogado: "1", juridico: "1", jurídico: "1",
  contabilidade: "2", contador: "2", imposto: "2", impostos: "2", fiscal: "2",
  pericia: "3", perícia: "3", perito: "3", laudo: "3", calculo: "3",
  irpf: "4", "imposto de renda": "4", declaracao: "4", declaração: "4", malha: "4",
  certidao: "5", certidão: "5", cnd: "5", documento: "5",
  agendar: "6", agendamento: "6", consulta: "6", marcar: "6",
  atendente: "7", humano: "7", pessoa: "7", falar: "7"
};

// ========== QR CODE STATE ==========
let latestQR = null;
let connectionStatus = "disconnected";
let sock = null;

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
      console.log("QR Code gerado - acesse a página web para escanear");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexão fechada. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);
      connectionStatus = "disconnected";
      
      if (shouldReconnect) {
        setTimeout(() => startBot(), 5000);
      } else {
        // Logged out - clear auth and restart
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

  // Handle incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip own messages, broadcasts, status updates
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.remoteJid.endsWith("@g.us")) continue; // skip groups

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || "";

      if (!text) continue;

      const from = msg.key.remoteJid;
      const cleanText = text.trim().toLowerCase();
      console.log(`<< De ${from}: ${cleanText}`);

      let response = null;

      // Check exact number match
      const numKey = cleanText.replace(/[^0-9]/g, "");
      if (RESPONSES[numKey]) {
        response = RESPONSES[numKey];
      }

      // Check keyword match
      if (!response) {
        for (const [keyword, optionKey] of Object.entries(KEYWORDS)) {
          if (cleanText.includes(keyword)) {
            if (optionKey === "menu") {
              response = MENU;
            } else {
              response = RESPONSES[optionKey];
            }
            break;
          }
        }
      }

      // Default response
      if (!response) {
        response = `Obrigado pela sua mensagem!\n\nNão consegui identificar sua solicitação. Por favor, escolha uma opção:\n\n1️⃣ Advocacia e Consultoria Jurídica\n2️⃣ Contabilidade e Impostos\n3️⃣ Perícia Contábil / Judicial\n4️⃣ IRPF - Imposto de Renda\n5️⃣ Certidões e Documentos\n6️⃣ Agendamento de Consulta\n7️⃣ Falar com atendente\n\nOu descreva sua necessidade que tentaremos ajudar!`;
      }

      try {
        await sock.sendMessage(from, { text: response });
        console.log(`>> Enviado para ${from}`);
      } catch (err) {
        console.error(`Erro ao enviar para ${from}:`, err.message);
      }

      // Notify personal number when option 7 (atendente) is chosen
      if (numKey === "7" || cleanText.includes("atendente") || cleanText.includes("humano")) {
        try {
          const clientNumber = from.replace("@s.whatsapp.net", "");
          await sock.sendMessage("5537999521810@s.whatsapp.net", {
            text: `🔔 *Novo cliente solicitou atendente!*\n\nNúmero: +${clientNumber}\nMensagem: ${text}\nHorário: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          });
        } catch (e) {
          console.error("Erro ao notificar:", e.message);
        }
      }
    }
  });
}

// ========== HTTP SERVER (QR Code page + health) ==========
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // QR Code page
  if (url.pathname === "/" || url.pathname === "/qr") {
    if (connectionStatus === "connected") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>ADR Bot - Conectado</title>
        <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;background:#e8f5e9;}
        h1{color:#2e7d32;}p{font-size:18px;}</style></head>
        <body><h1>Bot Conectado!</h1>
        <p>O bot está funcionando no WhatsApp.</p>
        <p>Número: (37) 98807-5561</p>
        <p><small>Última atualização: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small></p>
        <script>setTimeout(()=>location.reload(), 30000);</script>
        </body></html>
      `);
    }

    if (latestQR) {
      try {
        const qrDataUrl = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ADR Bot - Conectar WhatsApp</title>
          <style>body{font-family:Arial,sans-serif;text-align:center;padding:20px;background:#fff3e0;}
          h1{color:#e65100;}img{border:3px solid #333;border-radius:10px;margin:20px;}
          .steps{text-align:left;max-width:400px;margin:0 auto;background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1);}
          .steps li{margin:10px 0;font-size:16px;}</style></head>
          <body>
          <h1>Conectar WhatsApp ao Bot</h1>
          <p><strong>Escaneie o QR Code abaixo com seu WhatsApp Business App:</strong></p>
          <img src="${qrDataUrl}" alt="QR Code" />
          <div class="steps">
            <ol>
              <li>Abra o <strong>WhatsApp Business</strong> no celular (37) 98807-5561</li>
              <li>Toque em <strong>Menu</strong> (3 pontinhos) > <strong>Dispositivos conectados</strong></li>
              <li>Toque em <strong>Conectar dispositivo</strong></li>
              <li>Escaneie este QR Code</li>
            </ol>
          </div>
          <p><small>O QR Code atualiza automaticamente. Recarregue se expirar.</small></p>
          <script>setTimeout(()=>location.reload(), 20000);</script>
          </body></html>
        `);
      } catch (err) {
        res.writeHead(500);
        return res.end("Erro ao gerar QR Code");
      }
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ADR Bot - Aguardando</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;background:#e3f2fd;}
      h1{color:#1565c0;}</style></head>
      <body><h1>Aguardando QR Code...</h1>
      <p>O bot está iniciando. O QR Code aparecerá em instantes.</p>
      <script>setTimeout(()=>location.reload(), 5000);</script>
      </body></html>
    `);
  }

  // Health check endpoint (keeps Render alive)
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: connectionStatus, time: new Date().toISOString() }));
  }

  // Webhook endpoint (keep for compatibility)
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
  console.log(`Servidor HTTP rodando na porta ${PORT}`);
  startBot();
});
