// ============================================================
// Google Apps Script — Coroinhas (backend)
//
// INSTRUÇÕES DE CONFIGURAÇÃO:
// 1. Abra sua Planilha Google e copie o ID da URL:
//    https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit
// 2. Cole o ID na variável SPREADSHEET_ID abaixo.
// 3. No editor do Apps Script: Implantar > Nova implantação
//    - Tipo: App da Web
//    - Executar como: Eu
//    - Quem tem acesso: Qualquer pessoa
// 4. Autorize as permissões quando solicitado.
// 5. Copie a URL gerada e cole em admin.html (const API) e
//    em indexcoroinha.html (var URL_API).
// ============================================================

var SPREADSHEET_ID = "SEU_ID_DA_PLANILHA_AQUI";

// ── Auxiliares ────────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doGet ─────────────────────────────────────────────────────

function doGet(e) {
  try {
    var params = e.parameter || {};

    if (params.action === "listarMissas") {
      return listarMissas();
    }

    if (params.nome) {
      return verificarNome(params.nome);
    }

    return jsonResponse({ ok: true, msg: "API Coroinhas ativa." });
  } catch (err) {
    return jsonResponse({ ok: false, erro: err.message });
  }
}

// ── doPost ────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "cadastrarMembro")       return cadastrarMembro(body);
    if (action === "addMissa")              return addMissa(body);
    if (action === "removerMissa")          return removerMissa(body);
    if (action === "gerarEscala")           return gerarEscala(body);
    if (action === "limparDisponibilidade") return limparDisponibilidade();
    if (action === "salvarDisponibilidade") return salvarDisponibilidade(body);

    return jsonResponse({ ok: false, erro: "Ação desconhecida: " + action });
  } catch (err) {
    return jsonResponse({ ok: false, erro: err.message });
  }
}

// ── verificarNome ─────────────────────────────────────────────
// GET ?nome=João
// Retorna { existe: true/false, config: { missas: [...] } }

function verificarNome(nome) {
  var ss = getSpreadsheet();
  var membros = getOrCreateSheet(ss, "Membros", ["Nome", "Categoria"]);
  var dados = membros.getDataRange().getValues();

  var nomeNorm = nome.trim().toLowerCase();
  var existe = dados.slice(1).some(function(row) {
    return row[0] && row[0].toString().trim().toLowerCase() === nomeNorm;
  });

  if (!existe) {
    return jsonResponse({ existe: false });
  }

  var missasSheet = getOrCreateSheet(ss, "Missas", ["ID", "Data", "Hora", "Label"]);
  var missasDados = missasSheet.getDataRange().getValues();
  var missas = missasDados.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        id:    r[0].toString(),
        data:  r[1],
        hora:  r[2] ? r[2].toString() : "",
        label: r[3] ? r[3].toString() : ""
      };
    });

  return jsonResponse({ existe: true, config: { missas: missas } });
}

// ── listarMissas ──────────────────────────────────────────────
// GET ?action=listarMissas
// Retorna { missas: [{id, data, hora, label}, ...] }

function listarMissas() {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Missas", ["ID", "Data", "Hora", "Label"]);
  var dados = sheet.getDataRange().getValues();

  var missas = dados.slice(1)
    .filter(function(r) { return r[0]; })
    .map(function(r) {
      return {
        id:    r[0].toString(),
        data:  r[1],
        hora:  r[2] ? r[2].toString() : "",
        label: r[3] ? r[3].toString() : ""
      };
    });

  return jsonResponse({ missas: missas });
}

// ── cadastrarMembro ───────────────────────────────────────────
// POST { action: "cadastrarMembro", nome, cat }

function cadastrarMembro(body) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Membros", ["Nome", "Categoria"]);
  sheet.appendRow([body.nome, body.cat || ""]);
  return jsonResponse({ ok: true, msg: "Membro cadastrado: " + body.nome });
}

// ── addMissa ──────────────────────────────────────────────────
// POST { action: "addMissa", data, hora, label }

function addMissa(body) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Missas", ["ID", "Data", "Hora", "Label"]);
  var id = Utilities.getUuid();
  sheet.appendRow([id, body.data, body.hora, body.label || ""]);
  return jsonResponse({ ok: true, id: id });
}

// ── removerMissa ──────────────────────────────────────────────
// POST { action: "removerMissa", id }

function removerMissa(body) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Missas", ["ID", "Data", "Hora", "Label"]);
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (dados[i][0].toString() === body.id.toString()) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true });
    }
  }
  return jsonResponse({ ok: false, erro: "Missa não encontrada." });
}

// ── salvarDisponibilidade ─────────────────────────────────────
// POST { action: "salvarDisponibilidade", nome, selecoes: [{data, hora}] }

function salvarDisponibilidade(body) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Disponibilidade", ["Nome", "Data", "Hora"]);

  // Remove respostas anteriores do mesmo membro
  var dados = sheet.getDataRange().getValues();
  var nomeNorm = body.nome.trim().toLowerCase();
  for (var i = dados.length - 1; i >= 1; i--) {
    if (dados[i][0] && dados[i][0].toString().trim().toLowerCase() === nomeNorm) {
      sheet.deleteRow(i + 1);
    }
  }

  // Registra as novas seleções
  (body.selecoes || []).forEach(function(s) {
    sheet.appendRow([body.nome, s.data, s.hora]);
  });

  return jsonResponse({ ok: true });
}

// ── limparDisponibilidade ─────────────────────────────────────
// POST { action: "limparDisponibilidade" }

function limparDisponibilidade() {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet(ss, "Disponibilidade", ["Nome", "Data", "Hora"]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  return jsonResponse({ ok: true });
}

// ── gerarEscala ───────────────────────────────────────────────
// POST { action: "gerarEscala", missaId }
// Retorna { escala: ["Nome1", "Nome2", ...], obs: "..." }

function gerarEscala(body) {
  var ss = getSpreadsheet();
  var missaId = body.missaId.toString();

  // Localiza a missa
  var missasSheet = getOrCreateSheet(ss, "Missas", ["ID", "Data", "Hora", "Label"]);
  var missasDados = missasSheet.getDataRange().getValues();
  var missa = null;
  for (var i = 1; i < missasDados.length; i++) {
    if (missasDados[i][0].toString() === missaId) {
      missa = { id: missasDados[i][0], data: missasDados[i][1].toString().trim(), hora: missasDados[i][2] };
      break;
    }
  }

  if (!missa) {
    return jsonResponse({ ok: false, erro: "Missa não encontrada: " + missaId });
  }

  // Busca coroinhas disponíveis para a data dessa missa
  var dispoSheet = getOrCreateSheet(ss, "Disponibilidade", ["Nome", "Data", "Hora"]);
  var dispoDados = dispoSheet.getDataRange().getValues();

  var disponiveis = dispoDados.slice(1)
    .filter(function(r) {
      return r[0] && r[1] && r[1].toString().trim() === missa.data;
    })
    .map(function(r) { return r[0].toString().trim(); });

  // Remove duplicatas (caso alguém tenha múltiplas entradas)
  disponiveis = disponiveis.filter(function(v, i, arr) { return arr.indexOf(v) === i; });

  // Embaralha a lista (sorteio)
  for (var j = disponiveis.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var tmp = disponiveis[j];
    disponiveis[j] = disponiveis[k];
    disponiveis[k] = tmp;
  }

  var obs = disponiveis.length === 0
    ? "Nenhum coroinha confirmou disponibilidade para esta missa."
    : disponiveis.length + " coroinha(s) disponível(is).";

  return jsonResponse({ escala: disponiveis, obs: obs });
}
