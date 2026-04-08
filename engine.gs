// ============================================================
//  engine.gs — Google Apps Script backend para Coroinhas
//
//  Planilhas utilizadas:
//    "Membros"        → Nome | Categoria
//    "Missas"         → ID | Data | Hora | Label
//    "Disponibilidade"→ Data | Hora | Nome | Timestamp
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
 * O problema: quando uma célula contém apenas horário (sem data), o Sheets
 * armazena um número serial fracionário (0 a 1) e o GAS o envolve num Date
 * cujo ano é 1899. Ao serializar diretamente para JSON esse Date vira
 * "1899-12-30T22:06:28.000Z" — que é o bug visível na planilha.
 *
 * A correção:
 *   - Date com ano ≤ 1900  → formata apenas a hora: "HH:mm"
 *   - Date com ano normal  → formata a data: "dd/MM/yyyy"
 *   - Qualquer outro valor → converte para String normalmente
 */
function cellToString_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    var tz = Session.getScriptTimeZone();
    if (value.getFullYear() <= 1900) {
      // Valor de hora pura (serial de planilha sem data)
      return Utilities.formatDate(value, tz, "HH:mm");
    }
    return Utilities.formatDate(value, tz, "dd/MM/yyyy");
  }
  return String(value);
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
  sh.appendRow([body.nome.trim(), body.cat || "Novato"]);
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
  var sh = getOrCreateSheet_(SHEET_DISPONIBIL, ["Data", "Hora", "Nome", "Timestamp"]);
  var tz = Session.getScriptTimeZone();
  var ts = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");
  var nome = String(body.nome).trim();
  body.selecoes.forEach(function(sel) {
    sh.appendRow([sel.data, sel.hora, nome, ts]);
  });
  return jsonOk_({ ok: true });
}

function limparDisponibilidade_() {
  var sh = getOrCreateSheet_(SHEET_DISPONIBIL, ["Data", "Hora", "Nome", "Timestamp"]);
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.deleteRows(2, lastRow - 1);
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
  var shDispo = getOrCreateSheet_(SHEET_DISPONIBIL, ["Data", "Hora", "Nome", "Timestamp"]);
  var dispoRows = shDispo.getDataRange().getValues();
  var disponiveis = [];
  for (var j = 1; j < dispoRows.length; j++) {
    var rowData = cellToString_(dispoRows[j][0]);
    var rowHora = cellToString_(dispoRows[j][1]);
    var rowNome = String(dispoRows[j][2]).trim();
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
