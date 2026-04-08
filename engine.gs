// ============================================================
//  engine.gs — Google Apps Script backend para Coroinhas
//
//  Planilhas utilizadas:
//    "Membros"        → Nome | Categoria
//    "Missas"         → ID | Data | Hora | Label
//    "Disponibilidade"→ Nome | Data | Hora | Timestamp
// ============================================================

var SHEET_MEMBROS    = "Membros";
var SHEET_MISSAS     = "Missas";
var SHEET_DISPONIBIL = "Disponibilidade";

// ── Helpers ──────────────────────────────────────────────────

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.appendRow(headers);
  }
  return sh;
}

/**
 * Converte um valor de célula do Google Sheets para string legível.
 *
 * Casos tratados:
 *   - Date com ano ≤ 1900  → formata apenas a hora: "HH:mm"
 *   - Date com ano normal  → formata a data: "dd/MM/yyyy"
 *   - String ISO (ex: "2026-04-12T03:00:00.000Z") → formata como data "dd/MM/yyyy"
 *   - String Date.toString() contendo "1899" (hora pura) → extrai "HH:mm"
 *   - Qualquer outro valor → converte para String normalmente
 */
function cellToString_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    var tz = Session.getScriptTimeZone();
    if (value.getFullYear() <= 1900) {
      return Utilities.formatDate(value, tz, "HH:mm");
    }
    return Utilities.formatDate(value, tz, "dd/MM/yyyy");
  }
  var s = String(value).trim();
  // ISO date string gravada como texto: "2026-04-12T03:00:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) {
    try {
      var d = new Date(s);
      if (!isNaN(d.getTime())) {
        var tz2 = Session.getScriptTimeZone();
        if (d.getFullYear() > 1900) {
          return Utilities.formatDate(d, tz2, "dd/MM/yyyy");
        }
        return Utilities.formatDate(d, tz2, "HH:mm");
      }
    } catch (e) {}
  }
  // Date.toString() com ano 1899 gravado como texto: "Sat Dec 30 1899 19:00:00 GMT-0306..."
  if (s.indexOf("1899") !== -1) {
    var m = s.match(/(\d{2}):(\d{2}):\d{2}/);
    if (m) return m[1] + ":" + m[2];
  }
  return s;
}

function jsonOk_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doGet ────────────────────────────────────────────────────

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  try {
    if (params.action === "listarMissas") return listarMissas_();
    if (params.nome)                      return verificarNome_(params.nome);
    return jsonOk_({ erro: "Ação não reconhecida" });
  } catch (err) {
    return jsonOk_({ erro: err.message });
  }
}

// ── doPost ───────────────────────────────────────────────────

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (x) { /* usa body vazio */ }
  try {
    switch (body.action) {
      case "cadastrarMembro":       return cadastrarMembro_(body);
      case "addMissa":              return addMissa_(body);
      case "removerMissa":          return removerMissa_(body);
      case "gerarEscala":           return gerarEscala_(body);
      case "salvarDisponibilidade": return salvarDisponibilidade_(body);
      case "limparDisponibilidade": return limparDisponibilidade_();
      default:
        return jsonOk_({ erro: "Ação desconhecida: " + body.action });
    }
  } catch (err) {
    return jsonOk_({ erro: err.message });
  }
}

// ── verificarNome ────────────────────────────────────────────

function verificarNome_(nome) {
  var sh = getOrCreateSheet_(SHEET_MEMBROS, ["Nome", "Categoria"]);
  var rows = sh.getDataRange().getValues();
  var nomeLower = nome.trim().toLowerCase();
  var existe = rows.slice(1).some(function(row) {
    return String(row[0]).trim().toLowerCase() === nomeLower;
  });
  var config = {};
  if (existe) {
    config.missas = getMissasArray_();
  }
  return jsonOk_({ existe: existe, config: config });
}

// ── cadastrarMembro ──────────────────────────────────────────

function cadastrarMembro_(body) {
  if (!body.nome) return jsonOk_({ erro: "Nome obrigatório" });
  var sh = getOrCreateSheet_(SHEET_MEMBROS, ["Nome", "Categoria"]);
  var nomeTrimmed = body.nome.trim();
  var nomeLower = nomeTrimmed.toLowerCase();
  var rows = sh.getDataRange().getValues();
  var jaExiste = rows.slice(1).some(function(row) {
    return String(row[0]).trim().toLowerCase() === nomeLower;
  });
  if (jaExiste) return jsonOk_({ ok: false, aviso: "Coroinha já cadastrado." });
  sh.appendRow([nomeTrimmed, body.cat || "Novato"]);
  return jsonOk_({ ok: true });
}

// ── Missas ───────────────────────────────────────────────────

function getMissasArray_() {
  var sh = getOrCreateSheet_(SHEET_MISSAS, ["ID", "Data", "Hora", "Label"]);
  var rows = sh.getDataRange().getValues();
  return rows.slice(1)
    .map(function(row) {
      return {
        id:    String(row[0]),
        data:  cellToString_(row[1]),
        hora:  cellToString_(row[2]),
        label: String(row[3] || "")
      };
    })
    .filter(function(m) { return m.id; });
}

function listarMissas_() {
  return jsonOk_({ missas: getMissasArray_() });
}

function addMissa_(body) {
  if (!body.data) return jsonOk_({ erro: "Data obrigatória" });
  var sh = getOrCreateSheet_(SHEET_MISSAS, ["ID", "Data", "Hora", "Label"]);
  var id = "M_" + new Date().getTime();
  sh.appendRow([id, body.data, body.hora || "", body.label || ""]);
  return jsonOk_({ ok: true, id: id });
}

function removerMissa_(body) {
  if (!body.id) return jsonOk_({ erro: "ID obrigatório" });
  var sh = getOrCreateSheet_(SHEET_MISSAS, ["ID", "Data", "Hora", "Label"]);
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(body.id)) {
      sh.deleteRow(i + 1);
      break;
    }
  }
  return jsonOk_({ ok: true });
}

// ── Disponibilidade ──────────────────────────────────────────

function salvarDisponibilidade_(body) {
  if (!body.nome || !body.selecoes) return jsonOk_({ erro: "Dados incompletos" });
  var sh = getOrCreateSheet_(SHEET_DISPONIBIL, ["Nome", "Data", "Hora", "Timestamp"]);
  var tz = Session.getScriptTimeZone();
  var ts = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");
  var nome = String(body.nome).trim();
  body.selecoes.forEach(function(sel) {
    sh.appendRow([nome, sel.data, sel.hora, ts]);
  });
  return jsonOk_({ ok: true });
}

function limparDisponibilidade_() {
  var sh = getOrCreateSheet_(SHEET_DISPONIBIL, ["Nome", "Data", "Hora", "Timestamp"]);
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, sh.getMaxColumns()).clearContent();
  }
  return jsonOk_({ ok: true });
}

// ── gerarEscala ──────────────────────────────────────────────

function gerarEscala_(body) {
  if (!body.missaId) return jsonOk_({ erro: "missaId obrigatório" });

  // Localiza a missa pelo ID
  var shMissas = getOrCreateSheet_(SHEET_MISSAS, ["ID", "Data", "Hora", "Label"]);
  var missaRows = shMissas.getDataRange().getValues();
  var missa = null;
  for (var i = 1; i < missaRows.length; i++) {
    if (String(missaRows[i][0]) === String(body.missaId)) {
      missa = {
        data: cellToString_(missaRows[i][1]),
        hora: cellToString_(missaRows[i][2])
      };
      break;
    }
  }
  if (!missa) return jsonOk_({ erro: "Missa não encontrada" });

  // Coleta disponíveis para a missa (data + hora)
  var shDispo = getOrCreateSheet_(SHEET_DISPONIBIL, ["Nome", "Data", "Hora", "Timestamp"]);
  var dispoRows = shDispo.getDataRange().getValues();
  var disponiveis = [];
  for (var j = 1; j < dispoRows.length; j++) {
    var rowNome = String(dispoRows[j][0]).trim();
    var rowData = cellToString_(dispoRows[j][1]);
    var rowHora = cellToString_(dispoRows[j][2]);
    if (rowData === missa.data && rowHora === missa.hora && rowNome) {
      if (disponiveis.indexOf(rowNome) === -1) disponiveis.push(rowNome);
    }
  }

  // Embaralha (shuffle Fisher-Yates)
  for (var k = disponiveis.length - 1; k > 0; k--) {
    var r = Math.floor(Math.random() * (k + 1));
    var tmp = disponiveis[k];
    disponiveis[k] = disponiveis[r];
    disponiveis[r] = tmp;
  }

  var obs = disponiveis.length === 0
    ? "Nenhum coroinha disponível para esta missa."
    : "";

  return jsonOk_({ escala: disponiveis, obs: obs });
}
