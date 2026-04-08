/**
 * SISTEMA DE GESTÃO DE COROINHAS - MOTOR CENTRAL (Engine.gs)
 * Planilha: https://docs.google.com/spreadsheets/d/12HFM5p3DpX3eR23W8ER8EIogqKbBzPWnmD_AnF31nIE
 *
 * Abas necessárias na planilha:
 *   Membros        – A: Nome  | B: Categoria | C: Serviços
 *   Missas         – A: ID    | B: Data      | C: Hora     | D: Label
 *   Disponibilidade– A: Data  | B: Hora      | C: Nome     | D: Timestamp
 */

const SPREADSHEET_ID = "12HFM5p3DpX3eR23W8ER8EIogqKbBzPWnmD_AnF31nIE";
const SS = SpreadsheetApp.openById(SPREADSHEET_ID);

// ─── GET ────────────────────────────────────────────────────────────────────

/**
 * doGet – dois usos:
 *   ?action=listarMissas          → retorna lista de missas cadastradas (usado pelo admin)
 *   ?nome=<nome>                  → valida login do coroinha e retorna config (missas abertas)
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  // Ação explícita do admin: listar missas para o select/painel
  if (params.action === "listarMissas") {
    return _jsonResponse({ missas: _listarMissas() });
  }

  // Login do coroinha: verifica nome e devolve missas disponíveis
  let existe = false;
  if (params.nome) {
    const nomeBusca = params.nome.trim().toLowerCase();
    const membrosSheet = SS.getSheetByName("Membros");
    const nomes = _coluna(membrosSheet, 1).map(function(n) {
      return n.toString().trim().toLowerCase();
    });
    existe = nomes.indexOf(nomeBusca) !== -1;
  }

  return _jsonResponse({
    existe: existe,
    config: { missas: _listarMissas() }
  });
}

// ─── POST ───────────────────────────────────────────────────────────────────

/**
 * doPost – todas as ações de escrita:
 *   cadastrarMembro       – cadastra novo coroinha em Membros
 *   addMissa              – adiciona missa em Missas com ID único
 *   removerMissa          – remove missa por ID
 *   salvarDisponibilidade – coroinha registra presença disponível
 *   gerarEscala           – sorteia coroinhas para uma missa
 *   limparDisponibilidade – apaga toda a aba Disponibilidade (início de mês)
 */
function doPost(e) {
  if (!e || !e.postData) {
    return _textResponse("Erro: dados não recebidos.");
  }

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return _textResponse("Erro: JSON inválido.");
  }

  // AÇÃO 1: Cadastrar novo coroinha
  if (data.action === "cadastrarMembro") {
    if (!data.nome || !data.cat) return _textResponse("Erro: nome e categoria são obrigatórios.");
    const sheet = SS.getSheetByName("Membros");
    sheet.appendRow([data.nome.trim(), data.cat, 0]);
    return _textResponse("Sucesso");
  }

  // AÇÃO 2: Adicionar missa à programação
  if (data.action === "addMissa") {
    if (!data.data || !data.hora) return _textResponse("Erro: data e hora são obrigatórias.");
    const sheet = SS.getSheetByName("Missas");
    const id = Utilities.getUuid();
    sheet.appendRow([id, data.data, data.hora, data.label || ""]);
    return _textResponse("Sucesso");
  }

  // AÇÃO 3: Remover missa da programação
  if (data.action === "removerMissa") {
    if (!data.id) return _textResponse("Erro: id é obrigatório.");
    const sheet = SS.getSheetByName("Missas");
    const valores = sheet.getDataRange().getValues();
    for (let i = 1; i < valores.length; i++) {
      if (valores[i][0] == data.id) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return _textResponse("Sucesso");
  }

  // AÇÃO 4: Coroinha salva disponibilidade
  if (data.action === "salvarDisponibilidade") {
    if (!data.nome || !Array.isArray(data.selecoes)) {
      return _textResponse("Erro: nome e selecoes são obrigatórios.");
    }
    const sheet = SS.getSheetByName("Disponibilidade");
    const agora = new Date();
    data.selecoes.forEach(function(s) {
      if (s.data && s.hora) {
        sheet.appendRow([s.data, s.hora, data.nome.trim(), agora]);
      }
    });
    return _textResponse("Sucesso");
  }

  // AÇÃO 5: Gerar escala para uma missa
  if (data.action === "gerarEscala") {
    if (!data.missaId) return _jsonResponse({ escala: [], obs: "ID da missa não informado." });

    // Localiza a missa pelo ID
    const missas = _listarMissas();
    let missaSelecionada = null;
    for (let i = 0; i < missas.length; i++) {
      if (missas[i].id === data.missaId) {
        missaSelecionada = missas[i];
        break;
      }
    }
    if (!missaSelecionada) {
      return _jsonResponse({ escala: [], obs: "Missa não encontrada." });
    }

    // Busca membros e disponibilidades
    const membrosSheet = SS.getSheetByName("Membros");
    const dispoSheet   = SS.getSheetByName("Disponibilidade");

    const membros = membrosSheet.getDataRange().getValues().slice(1);
    const dispo   = dispoSheet.getLastRow() > 1
      ? dispoSheet.getDataRange().getValues().slice(1)
      : [];

    // Nomes disponíveis para essa data+hora
    const disponiveisNomes = dispo
      .filter(function(r) { return r[0] == missaSelecionada.data && r[1] == missaSelecionada.hora; })
      .map(function(r) { return r[2]; });

    if (disponiveisNomes.length === 0) {
      return _jsonResponse({ escala: [], obs: "Nenhum coroinha marcou disponibilidade para esta missa." });
    }

    // Cruza com membros cadastrados e ordena por menos serviços
    const candidatos = membros
      .filter(function(m) { return disponiveisNomes.indexOf(m[0]) !== -1; })
      .map(function(m) { return { nome: m[0], cat: m[1], servicos: Number(m[2]) || 0 }; })
      .sort(function(a, b) { return a.servicos - b.servicos; });

    const escolher = function(cat, qtd) {
      return candidatos.filter(function(c) { return c.cat === cat; })
        .slice(0, qtd)
        .map(function(c) { return c.nome; });
    };

    const escala = [
      ...escolher("Acólito", 2),
      ...escolher("Veterano", 2),
      ...escolher("Médio", 2),
      ...escolher("Novato", 2)
    ];

    const obs = escala.length === 0
      ? "Nenhum coroinha cadastrado disponível para esta missa."
      : "";

    return _jsonResponse({ escala: escala, obs: obs });
  }

  // AÇÃO 6: Limpar disponibilidades (início de mês)
  if (data.action === "limparDisponibilidade") {
    const sheet = SS.getSheetByName("Disponibilidade");
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    return _textResponse("Sucesso");
  }

  return _textResponse("Erro: ação desconhecida.");
}

// ─── HELPERS INTERNOS ────────────────────────────────────────────────────────

/**
 * Retorna todas as missas da aba Missas como array de objetos.
 */
function _listarMissas() {
  const sheet = SS.getSheetByName("Missas");
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4)
    .getValues()
    .filter(function(r) { return r[0]; })
    .map(function(r) { return { id: r[0], data: r[1], hora: r[2], label: r[3] }; });
}

/**
 * Retorna os valores de uma coluna a partir da linha 2, filtrando vazios.
 */
function _coluna(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, col, lastRow - 1, 1)
    .getValues()
    .flat()
    .filter(String);
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _textResponse(text) {
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT);
}
