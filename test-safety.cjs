// Testes isolados: não conectam ao WhatsApp e não enviam mensagens.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const code = fs.readFileSync(__dirname + "/server.js", "utf8");
const context = vm.createContext({});
const start = code.indexOf("const IGNORED_CONTACTS =");
const end = code.indexOf("// Comando admin para", start);
assert(start >= 0 && end > start);
vm.runInContext(code.slice(start, end), context);
let count = 0;
for (const jid of [
  "553784264128@s.whatsapp.net", "5537984264128@s.whatsapp.net",
  "187939782938841@lid", "187939782938841:12@lid",
  "553784146646@s.whatsapp.net", "5537984146646@s.whatsapp.net",
  "51174535348326@lid", "51174535348326:8@lid"
]) {
  assert.equal(context.isIgnoredJid(jid), true);
  assert.equal(context.isAllowedIncomingKey({remoteJid: jid}), false);
  count += 2;
}
for (const jid of ["553788244336@s.whatsapp.net", "242884729114795@lid"]) {
  assert.equal(context.isAllowedIncomingKey({remoteJid: jid}), true);
  count++;
}
for (const jid of ["status@broadcast", "123@g.us", "123@newsletter", "123@broadcast", ""]) {
  assert.equal(context.isAllowedIncomingKey({remoteJid: jid}), false);
  count++;
}
assert.equal(context.isAllowedIncomingKey({
  remoteJid: "999000111@lid",
  remoteJidAlt: "553784264128@s.whatsapp.net"
}), false);
assert.equal(context.isIgnoredJid("999000111@lid"), true);
count += 2;
// O interceptador de saída deve impedir a chamada real para contatos protegidos.
const guardStart = code.indexOf("  var _origSendMessage =");
const guardEnd = code.indexOf('  sock.ev.on("creds.update"', guardStart);
assert(guardStart > 0 && guardEnd > guardStart);
let sends = 0;
context.console = {log() {}, error() {}};
context.cacheSentMessage = () => {};
context.sock = {sendMessage: async () => { sends++; return {key: {id: "simulado"}}; }};
vm.runInContext(code.slice(guardStart, guardEnd), context);
(async () => {
  await context.sock.sendMessage("187939782938841@lid", {text: "SIMULAÇÃO"});
  await context.sock.sendMessage("553784146646@s.whatsapp.net", {text: "SIMULAÇÃO"});
  assert.equal(sends, 0);
  await context.sock.sendMessage("553788244336@s.whatsapp.net", {text: "SIMULAÇÃO"});
  assert.equal(sends, 1);
  context.isIgnoredJid = () => { throw new Error("falha simulada"); };
  await assert.rejects(context.sock.sendMessage("553788244336@s.whatsapp.net", {}));
  assert.equal(sends, 1);
  // Recuperação só atua no socket atual, conectado e aguardando o fim do lote.
  const recoverStart = code.indexOf("function recoverStartupBuffer(");
  const recoverEnd = code.indexOf("\nvar sock = null;", recoverStart);
  assert(recoverStart >= 0 && recoverEnd > recoverStart);
  vm.runInContext(code.slice(recoverStart, recoverEnd), context);
  let flushes = 0;
  const socket = {ev: {isBuffering: () => true, flush: () => {flushes++;}}};
  context.sock = socket;
  context.connectionStatus = "connected";
  context.pendingNotificationsReceived = false;
  context.startupBufferRecoveries = 0;
  assert.equal(context.recoverStartupBuffer(socket), true);
  assert.equal(flushes, 1);
  assert.equal(context.recoverStartupBuffer({ev: socket.ev}), false);
  context.pendingNotificationsReceived = true;
  assert.equal(context.recoverStartupBuffer(socket), false);
  context.pendingNotificationsReceived = false;
  context.connectionStatus = "disconnected";
  assert.equal(context.recoverStartupBuffer(socket), false);
  assert.equal(flushes, 1);
  console.log(`${count + 10} verificações aprovadas; nenhum acesso à rede.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
